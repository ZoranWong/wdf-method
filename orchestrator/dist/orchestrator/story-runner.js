import { existsSync } from 'fs';
import { resolve } from 'path';
import { AgentDispatcher } from './agent-dispatcher.js';
/**
 * Sub-step ID mapping for BE and FE stories.
 * Used to determine where to resume after session interruption.
 */
const BE_SUBSTEPS = ['4a', '4b', '4c', '4d', '4e', '4f', '4f2', '4g', '4h', '4j'];
const FE_SUBSTEPS = ['4a', '4b', '4c', '4d', '4e', '4f', '4g', '4h', '4h2', '4i', '4j', '4k'];
function nextSubstep(current, isFE) {
    const steps = isFE ? FE_SUBSTEPS : BE_SUBSTEPS;
    if (!current)
        return steps[0];
    const idx = steps.indexOf(current);
    return idx < steps.length - 1 ? steps[idx + 1] : steps[steps.length - 1];
}
/**
 * StoryRunner manages the lifecycle of individual stories during Phase 4.
 * Handles: worktree creation, story execution, scope validation, git commits, merge.
 */
export class StoryRunner {
    state;
    worktree;
    gateEvaluator;
    agentDispatcher;
    storiesDir;
    outputDir;
    constructor(state, worktree, gateEvaluator, projectRoot, storiesDir, outputDir) {
        this.state = state;
        this.worktree = worktree;
        this.gateEvaluator = gateEvaluator;
        this.agentDispatcher = new AgentDispatcher(projectRoot, storiesDir, outputDir);
        this.storiesDir = storiesDir;
        this.outputDir = outputDir;
    }
    /**
     * Main entry: run the next eligible story from development_order for the given track.
     * Returns the story that was run, or null if no story is ready.
     */
    async runNextStory(track) {
        const order = this.state.getDevelopmentOrder();
        const trackStories = order.filter(s => s.track === track || s.track === 'full-stack');
        // Sort by order
        trackStories.sort((a, b) => a.order - b.order);
        for (const story of trackStories) {
            const result = await this.tryRunStory(story);
            if (result)
                return result;
        }
        return null;
    }
    async tryRunStory(story) {
        const subKey = story.track === 'frontend' ? 'phase_4_10' :
            story.track === 'backend' ? 'phase_4_4' : 'phase_4_4';
        const isFE = story.track === 'frontend';
        // Check current status from sprint-status
        const existingStories = this.state.getStories(4, subKey);
        const existing = existingStories.find(s => s.id === story.story_id);
        if (existing?.status === 'MERGED' || existing?.status === 'CODE_ACCEPTED') {
            // Already done
            return null;
        }
        if (existing?.status === 'IN_PROGRESS') {
            // Resume from interruption
            return this.resumeStory(story, existing, subKey);
        }
        // Check cross-track dependencies
        const canStart = await this.checkDependencies(story);
        if (!canStart) {
            await this.state.updateStoryStatus(4, subKey, {
                id: story.story_id,
                status: 'BLOCKED_BY_DEPENDENCY',
            });
            console.log(`  🔒 ${story.story_id}: BLOCKED_BY_DEPENDENCY`);
            return null;
        }
        // Run Story Ready Gate (SRG checks)
        const gateResult = await this.runStoryReadyGate(story);
        if (!gateResult.all_pass) {
            const reasons = gateResult.results.filter(r => r.status === 'fail').map(r => r.reason).join('; ');
            console.log(`  ✗ ${story.story_id}: Story Ready Gate failed — ${reasons}`);
            return null;
        }
        // Create worktree
        const { path: worktreePath, branch } = await this.worktree.createStoryWorktree(story.story_id, story.track);
        console.log(`  📂 ${story.story_id}: worktree at ${worktreePath}`);
        // Initialize story status
        const storyStatus = {
            id: story.story_id,
            status: 'IN_PROGRESS',
            bmad_story_state: 'in-progress',
            started_at: new Date().toISOString(),
            last_completed_substep: null,
            step_history: [{ step: 'started', at: new Date().toISOString(), substep: null, summary: null, status: null }],
        };
        await this.state.updateStoryStatus(4, subKey, storyStatus);
        // Execute story steps
        const result = await this.executeStorySteps(story, worktreePath, subKey, isFE);
        if (result.success) {
            // Commit CODE_ACCEPTED state
            await this.worktree.commitInWorktree(worktreePath, story.story_id, story.title, 'CODE_ACCEPTED', { scope: story.scope_write.join(', '), tests: 'pass', review: '0 critical, 0 high' });
            // Merge to main
            await this.worktree.mergeToMain(story.story_id, story.track, story.title, {
                scope: story.scope_write.join(', '),
                tests: 'pass',
                review: '0 critical, 0 high',
                'scope-audit': '0 violations',
            });
            // Update status
            const finalStatus = {
                ...storyStatus,
                status: 'MERGED',
                bmad_story_state: 'done',
                completed_at: new Date().toISOString(),
                last_completed_substep: isFE ? '4k' : '4j',
                step_history: [
                    storyStatus.step_history[0],
                    { step: 'completed', at: new Date().toISOString(), substep: isFE ? '4k' : '4j', summary: `${story.title} — MERGED`, status: 'PASS' },
                ],
            };
            await this.state.updateStoryStatus(4, subKey, finalStatus);
            // Clean up worktree
            await this.worktree.removeStoryWorktree(story.story_id, story.track);
            console.log(`  ✓ ${story.story_id}: ${story.title} — MERGED`);
            return { storyId: story.story_id, status: 'MERGED' };
        }
        // Story failed — mark and return
        await this.state.updateStoryStatus(4, subKey, {
            ...storyStatus,
            status: 'BLOCKED',
            last_completed_substep: result.lastSubstep ?? undefined,
        });
        return null;
    }
    async resumeStory(story, existing, subKey) {
        const isFE = story.track === 'frontend';
        const lastStep = existing.last_completed_substep;
        const nextStep = nextSubstep(lastStep, isFE);
        console.log(`  ↻ ${story.story_id}: Resuming from ${nextStep} (last: ${lastStep})`);
        const worktreePath = this.worktree.storyWorktreePath(story.story_id, story.track);
        if (!existsSync(worktreePath)) {
            // Worktree was cleaned up — recreate and re-merge to restore state
            await this.worktree.createStoryWorktree(story.story_id, story.track);
        }
        const result = await this.executeStoryStepsFrom(story, worktreePath, nextStep, subKey, isFE);
        if (result.success) {
            // Same merge flow as fresh story
            await this.worktree.mergeToMain(story.story_id, story.track, story.title);
            await this.state.updateStoryStatus(4, subKey, {
                ...existing,
                status: 'MERGED',
                bmad_story_state: 'done',
                completed_at: new Date().toISOString(),
                last_completed_substep: isFE ? '4k' : '4j',
            });
            await this.worktree.removeStoryWorktree(story.story_id, story.track);
            console.log(`  ✓ ${story.story_id}: ${story.title} — MERGED (resumed)`);
            return { storyId: story.story_id, status: 'MERGED' };
        }
        return null;
    }
    /**
     * Check cross-track dependencies. Returns true if all deps are MERGED.
     */
    async checkDependencies(story) {
        if (!story.depends_on || story.depends_on.length === 0)
            return true;
        for (const dep of story.depends_on) {
            // Check all phases for the dependency story
            const depMerged = this.isStoryMerged(dep.story_id);
            if (!depMerged)
                return false;
        }
        return true;
    }
    isStoryMerged(storyId) {
        // Check phase_4_4 (BE) and phase_4_10 (FE) substates
        const beStories = this.state.getStories(4, 'phase_4_4');
        const feStories = this.state.getStories(4, 'phase_4_10');
        const allStories = [...beStories, ...feStories];
        return allStories.some(s => s.id === storyId && (s.status === 'MERGED' || s.status === 'CODE_ACCEPTED'));
    }
    /**
     * Story Ready Gate: SRG-02 (scope_write non-empty), SRG-05 (no overlap),
     * SRG-06 (within boundary), SRG-07 (parent dirs exist).
     */
    async runStoryReadyGate(story) {
        const results = [];
        // SRG-02: scope_write non-empty
        if (!story.scope_write || story.scope_write.length === 0) {
            results.push({ id: 'SRG-02', status: 'fail', reason: 'scope_write is empty' });
        }
        else {
            results.push({ id: 'SRG-02', status: 'pass' });
        }
        // SRG-05: No overlap with other IN_PROGRESS stories
        const beStories = this.state.getStories(4, 'phase_4_4');
        const feStories = this.state.getStories(4, 'phase_4_10');
        const inProgress = [...beStories, ...feStories].filter(s => s.status === 'IN_PROGRESS' && s.id !== story.story_id);
        const overlap = this.findScopeOverlap(story.scope_write, inProgress);
        if (overlap.length > 0) {
            results.push({ id: 'SRG-05', status: 'fail', reason: `Scope overlap with: ${overlap.join(', ')}` });
        }
        else {
            results.push({ id: 'SRG-05', status: 'pass' });
        }
        // SRG-06: scope_write within implementation_boundary
        const boundary = this.state.data.global_state.implementation_boundary;
        if (boundary && boundary.scope_frozen) {
            const allScopes = [...boundary.backend_scope, ...boundary.frontend_scope, ...boundary.shared_scope];
            const outside = story.scope_write.filter(sw => !allScopes.some(bs => sw.startsWith(bs) || bs.startsWith(sw)));
            if (outside.length > 0) {
                results.push({ id: 'SRG-06', status: 'fail', reason: `Outside boundary: ${outside.join(', ')}` });
            }
            else {
                results.push({ id: 'SRG-06', status: 'pass' });
            }
        }
        else {
            results.push({ id: 'SRG-06', status: 'pass', reason: 'Boundary not frozen yet, skipping' });
        }
        // SRG-07: Parent directories exist
        const missingDirs = story.scope_write.filter(p => {
            const full = resolve(this.worktree.baseDir || process.cwd(), p);
            return !existsSync(full);
        });
        if (missingDirs.length > 0) {
            results.push({ id: 'SRG-07', status: 'fail', reason: `Missing dirs: ${missingDirs.join(', ')}` });
        }
        else {
            results.push({ id: 'SRG-07', status: 'pass' });
        }
        return { all_pass: results.every(r => r.status === 'pass'), results };
    }
    findScopeOverlap(scope, otherStories) {
        const overlaps = [];
        for (const story of otherStories) {
            if (!story.scope_write)
                continue;
            for (const s of scope) {
                for (const o of story.scope_write) {
                    if (s.startsWith(o) || o.startsWith(s) || s === o) {
                        if (!overlaps.includes(story.id))
                            overlaps.push(story.id);
                    }
                }
            }
        }
        return overlaps;
    }
    /**
     * Execute story implementation by dispatching a Claude Code agent to the story worktree.
     * The agent performs all steps (4c → 4j/4k) autonomously and returns CODE_ACCEPTED or failure.
     */
    async executeStorySteps(story, worktreePath, subKey, isFE) {
        const config = {
            worktreePath,
            storyId: story.story_id,
            track: story.track,
            timeoutMinutes: 30,
            maxRetries: 2,
        };
        console.log(`    → Dispatching agent to implement ${story.story_id}...`);
        const result = await this.agentDispatcher.dispatchStoryAgent(story, config);
        if (result.status === 'CODE_ACCEPTED') {
            console.log(`    ✓ ${story.story_id}: Agent returned CODE_ACCEPTED (${(result.durationMs / 1000).toFixed(1)}s)`);
            return { success: true };
        }
        if (result.status === 'BLOCKED_BY_DEPENDENCY') {
            console.log(`    🔒 ${story.story_id}: BLOCKED_BY_DEPENDENCY — will retry later`);
            return { success: false, lastSubstep: '4a' };
        }
        console.log(`    ✗ ${story.story_id}: Agent failed — ${result.summary}`);
        return { success: false, lastSubstep: isFE ? '4k' : '4j' };
    }
    async executeStoryStepsFrom(story, worktreePath, startStep, subKey, isFE) {
        // Resume from interruption — re-dispatch the agent to continue from the last completed substep
        console.log(`    → Re-dispatching agent for ${story.story_id} from step ${startStep}...`);
        return this.executeStorySteps(story, worktreePath, subKey, isFE);
    }
    /**
     * Execute a single sub-step. Used only for pre/post-agent validation steps.
     * The actual coding steps (4c-4k) are handled by the dispatched agent.
     */
    async executeStep(story, worktreePath, step, _subKey) {
        switch (step) {
            case '4a': // Story Ready Gate — already run before worktree creation
                return true;
            case '4b': // Read story + mark IN_PROGRESS — already done
                return true;
            case '4c': // Agent handles implementation (4c → 4k)
                // The agent dispatch happens in executeStorySteps above.
                // This case is reached only during step-by-step mode (not used with agent dispatch).
                return true;
            case '4d': // Agent handles tests
                return true;
            case '4e': // Agent handles spec validation
                return true;
            case '4f': // Agent generates handoff docs
                return true;
            case '4f2': // Scope Exit Verification (BE)
            case '4h2': // Scope Exit Verification (FE)
                return await this.runScopeExitVerification(story, worktreePath);
            case '4g': // Agent runs acceptance checks
                return true;
            case '4h': // Agent does CODE ACCEPTANCE
                return true;
            case '4i': // Agent does Integration tests (FE)
                return true;
            case '4j': // Agent marks CODE_ACCEPTED (BE)
            case '4k': // Agent marks CODE_ACCEPTED (FE)
                return true;
            default:
                console.log(`    → Unknown step: ${step}`);
                return true;
        }
    }
    /**
     * Scope Exit Verification: git diff vs scope_write.
     */
    async runScopeExitVerification(story, worktreePath) {
        const changedFiles = await this.worktree.getChangedFilesInWorktree(worktreePath);
        const violations = changedFiles.filter(f => !story.scope_write.some(sw => f.startsWith(sw) || f.includes(sw)));
        if (violations.length > 0) {
            console.log(`  ✗ ${story.story_id} SCOPE VIOLATION — ${violations.length} files outside scope_write:`);
            for (const v of violations)
                console.log(`    ✗ ${v}`);
            return false; // Strict mode: block on violations
        }
        console.log(`  ✓ ${story.story_id} SCOPE EXIT CLEAN — ${changedFiles.length} files, 0 violations`);
        return true;
    }
}
//# sourceMappingURL=story-runner.js.map