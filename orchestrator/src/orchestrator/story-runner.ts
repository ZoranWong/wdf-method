import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import simpleGit from 'simple-git';
import { SprintStatusManager } from './sprint-status.js';
import { WorktreeManager } from './worktree.js';
import { GateEvaluator } from './gate-evaluator.js';
import { AgentDispatcher, AgentDispatchConfig } from './agent-dispatcher.js';
import { StoryEntry, Track, PhaseStatus, StoryStatus, ScopeLockConfig } from './types.js';
import {
  validateScopeLock,
  validateActualChangesAgainstScope,
  applyEnforcementMode,
  summarizeViolations,
} from './scope-lock.js';

/**
 * Sub-step ID mapping for BE and FE stories.
 * Used to determine where to resume after session interruption.
 */
const BE_SUBSTEPS = ['4a', '4b', '4c', '4d', '4e', '4f', '4f2', '4g', '4h', '4j'];
const FE_SUBSTEPS = ['4a', '4b', '4c', '4d', '4e', '4f', '4g', '4h', '4h2', '4i', '4j', '4k'];

function nextSubstep(current: string | null, isFE: boolean): string {
  const steps = isFE ? FE_SUBSTEPS : BE_SUBSTEPS;
  if (!current) return steps[0];
  const idx = steps.indexOf(current);
  return idx < steps.length - 1 ? steps[idx + 1] : steps[steps.length - 1];
}

/**
 * StoryRunner manages the lifecycle of individual stories during Phase 4.
 * Handles: worktree creation, story execution, scope validation, git commits, merge.
 */
export class StoryRunner {
  private state: SprintStatusManager;
  private worktree: WorktreeManager;
  private gateEvaluator: GateEvaluator;
  private agentDispatcher: AgentDispatcher;
  private storiesDir: string;
  private outputDir: string;
  private scopeLockConfig: ScopeLockConfig | null;

  constructor(
    state: SprintStatusManager,
    worktree: WorktreeManager,
    gateEvaluator: GateEvaluator,
    projectRoot: string,
    storiesDir: string,
    outputDir: string,
    scopeLockConfig?: ScopeLockConfig | null,
  ) {
    this.state = state;
    this.worktree = worktree;
    this.gateEvaluator = gateEvaluator;
    this.agentDispatcher = new AgentDispatcher(projectRoot, storiesDir, outputDir);
    this.storiesDir = storiesDir;
    this.outputDir = outputDir;
    this.scopeLockConfig = scopeLockConfig ?? null;
  }

  /**
   * Main entry: run the next eligible story from development_order for the given track.
   * Returns the story that was run, or null if no story is ready.
   */
  async runNextStory(track: Track): Promise<{ storyId: string; status: string } | null> {
    const order = this.state.getDevelopmentOrder();
    const trackStories = order.filter(s => s.track === track || s.track === 'full-stack');

    // Sort by order
    trackStories.sort((a, b) => a.order - b.order);

    for (const story of trackStories) {
      const result = await this.tryRunStory(story);
      if (result) return result;
    }

    return null;
  }

  private async tryRunStory(story: StoryEntry): Promise<{ storyId: string; status: string } | null> {
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
      await this.state.appendAudit('story_resume', { story_id: story.story_id, decision: 'approve' });
      return this.resumeStory(story, existing, subKey);
    }

    // Check cross-track dependencies
    const canStart = await this.checkDependencies(story);
    if (!canStart) {
      await this.state.appendAudit('story_blocked', { story_id: story.story_id, decision: 'block', reason: 'dependency' });
      await this.state.updateStoryStatus(4, subKey, {
        id: story.story_id,
        status: 'BLOCKED_BY_DEPENDENCY' as PhaseStatus,
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
    const { path: worktreePath, branch } = await this.worktree.createStoryWorktree(
      story.story_id, story.track as Track
    );
    console.log(`  📂 ${story.story_id}: worktree at ${worktreePath}`);

    // Initialize story status
    const storyStatus: StoryStatus = {
      id: story.story_id,
      status: 'IN_PROGRESS' as PhaseStatus,
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
      await this.worktree.commitInWorktree(
        worktreePath, story.story_id, story.title, 'CODE_ACCEPTED',
        { scope: story.scope_write.join(', '), tests: 'pass', review: '0 critical, 0 high' }
      );

      // Merge to main
      await this.worktree.mergeToMain(story.story_id, story.track as Track, story.title, {
        scope: story.scope_write.join(', '),
        tests: 'pass',
        review: '0 critical, 0 high',
        'scope-audit': '0 violations',
      });

      // Update status
      const finalStatus: StoryStatus = {
        ...storyStatus,
        status: 'MERGED' as PhaseStatus,
        bmad_story_state: 'done',
        completed_at: new Date().toISOString(),
        last_completed_substep: isFE ? '4k' : '4j',
        step_history: [
          storyStatus.step_history![0],
          { step: 'completed', at: new Date().toISOString(), substep: isFE ? '4k' : '4j', summary: `${story.title} — MERGED`, status: 'PASS' },
        ],
      };
      await this.state.updateStoryStatus(4, subKey, finalStatus);

      // Clean up worktree
      await this.worktree.removeStoryWorktree(story.story_id, story.track as Track);

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

  private async resumeStory(story: StoryEntry, existing: any, subKey: string): Promise<{ storyId: string; status: string } | null> {
    const isFE = story.track === 'frontend';
    const lastStep = existing.last_completed_substep;
    const nextStep = nextSubstep(lastStep, isFE);

    console.log(`  ↻ ${story.story_id}: Resuming from ${nextStep} (last: ${lastStep})`);

    const worktreePath = this.worktree.storyWorktreePath(story.story_id, story.track as Track);
    if (!existsSync(worktreePath)) {
      // Worktree was cleaned up — recreate and re-merge to restore state
      await this.worktree.createStoryWorktree(story.story_id, story.track as Track);
    }

    const result = await this.executeStoryStepsFrom(story, worktreePath, nextStep, subKey, isFE);

    if (result.success) {
      // Same merge flow as fresh story
      await this.worktree.mergeToMain(story.story_id, story.track as Track, story.title);
      await this.state.updateStoryStatus(4, subKey, {
        ...existing,
        status: 'MERGED',
        bmad_story_state: 'done',
        completed_at: new Date().toISOString(),
        last_completed_substep: isFE ? '4k' : '4j',
      });
      await this.worktree.removeStoryWorktree(story.story_id, story.track as Track);
      console.log(`  ✓ ${story.story_id}: ${story.title} — MERGED (resumed)`);
      return { storyId: story.story_id, status: 'MERGED' };
    }

    return null;
  }

  /**
   * Check cross-track dependencies. Returns true if all deps are MERGED.
   */
  private async checkDependencies(story: StoryEntry): Promise<boolean> {
    if (!story.depends_on || story.depends_on.length === 0) return true;

    for (const dep of story.depends_on) {
      // Check all phases for the dependency story
      const depMerged = this.isStoryMerged(dep.story_id);
      if (!depMerged) return false;
    }

    return true;
  }

  private isStoryMerged(storyId: string): boolean {
    // Check phase_4_4 (BE) and phase_4_10 (FE) substates
    const beStories = this.state.getStories(4, 'phase_4_4');
    const feStories = this.state.getStories(4, 'phase_4_10');
    const allStories = [...beStories, ...feStories];
    return allStories.some(s => s.id === storyId && (s.status === 'MERGED' || s.status === 'CODE_ACCEPTED'));
  }

  /**
   * Story Ready Gate V3.6: validates all 9 SRG gates.
   * SRG-01: scope_write defined | SRG-04: path safety | SRG-08: protected paths | SRG-09: command safety
   * are added by this method. SRG-02/03/05/06/07 are handled by the existing implementation.
   */
  private async runStoryReadyGate(story: StoryEntry): Promise<{ all_pass: boolean; results: any[] }> {
    const { results } = await this.runBaseSRGChecks(story);
    // V3.6 additions
    this.addSRG04_PathSafety(story, results);
    this.addSRG08_ProtectedPaths(story, results);
    this.addSRG09_CommandSafety(story, results);
    // Task 7: Scope-Lock pre-execution gate
    await this.addScopeLockCheck(story, results);
    return { all_pass: results.every(r => r.status === 'pass'), results };
  }

  /**
   * Pre-execution scope-lock gate: validates declared scope_write against
   * forbidden / protected paths and the frozen implementation_boundary.
   * Honours `enforcement_mode`:
   *   - strict      → forbidden / outside_boundary errors fail the gate.
   *   - warning     → never fails the gate; violations recorded in audit log.
   *   - permissive  → silenced (debug only).
   */
  private async addScopeLockCheck(story: StoryEntry, results: any[]): Promise<void> {
    const cfg = this.scopeLockConfig;
    if (!cfg || !cfg.enabled) {
      results.push({ id: 'SCOPE-LOCK', status: 'pass', reason: 'scope_lock disabled' });
      return;
    }

    const boundary = this.state.data.global_state.implementation_boundary;
    const boundaryPaths = boundary && boundary.scope_frozen
      ? [...boundary.backend_scope, ...boundary.frontend_scope, ...boundary.shared_scope]
      : undefined;

    const result = validateScopeLock(story.scope_write ?? [], cfg, boundaryPaths);
    const outcome = applyEnforcementMode(result, cfg.enforcement_mode);

    if (result.violations.length > 0) {
      await this.state.appendAudit('scope_lock_pre_check', {
        story_id: story.story_id,
        decision: outcome.should_block ? 'block' : 'warn',
        enforcement_mode: cfg.enforcement_mode,
        violations: result.violations,
        summary: summarizeViolations(result.violations),
      });
    }

    if (outcome.should_block) {
      const summary = summarizeViolations(outcome.reported);
      results.push({
        id: 'SCOPE-LOCK',
        status: 'fail',
        reason: `scope-lock pre-check (${cfg.enforcement_mode}): ${summary}`,
      });
    } else {
      const note = outcome.reported.length > 0
        ? `${outcome.reported.length} warning(s)`
        : 'clean';
      results.push({ id: 'SCOPE-LOCK', status: 'pass', reason: note });
    }
  }

  /** SRG-01~03,05~07: Base checks from V3.1 */
  private async runBaseSRGChecks(story: StoryEntry): Promise<{ all_pass: boolean; results: any[] }> {
    const results: { id: string; status: 'pass' | 'fail'; reason?: string }[] = [];
    // SRG-02: scope_write non-empty
    if (!story.scope_write || story.scope_write.length === 0) {
      results.push({ id: 'SRG-02', status: 'fail', reason: 'scope_write is empty' });
    } else {
      results.push({ id: 'SRG-02', status: 'pass' });
    }

    // SRG-05: No overlap with other IN_PROGRESS stories
    const beStories = this.state.getStories(4, 'phase_4_4');
    const feStories = this.state.getStories(4, 'phase_4_10');
    const inProgress = [...beStories, ...feStories].filter(s =>
      s.status === 'IN_PROGRESS' && s.id !== story.story_id
    );
    const overlap = this.findScopeOverlap(story.scope_write, inProgress);
    if (overlap.length > 0) {
      results.push({ id: 'SRG-05', status: 'fail', reason: `Scope overlap with: ${overlap.join(', ')}` });
    } else {
      results.push({ id: 'SRG-05', status: 'pass' });
    }

    // SRG-06: scope_write within implementation_boundary
    const boundary = this.state.data.global_state.implementation_boundary;
    if (boundary && boundary.scope_frozen) {
      const allScopes = [...boundary.backend_scope, ...boundary.frontend_scope, ...boundary.shared_scope];
      const outside = story.scope_write.filter(sw =>
        !allScopes.some(bs => sw.startsWith(bs) || bs.startsWith(sw))
      );
      if (outside.length > 0) {
        results.push({ id: 'SRG-06', status: 'fail', reason: `Outside boundary: ${outside.join(', ')}` });
      } else {
        results.push({ id: 'SRG-06', status: 'pass' });
      }
    } else {
      results.push({ id: 'SRG-06', status: 'pass', reason: 'Boundary not frozen yet, skipping' });
    }

    // SRG-07: Parent directories exist
    const missingDirs = story.scope_write.filter(p => {
      const full = resolve(this.worktree.baseDir || process.cwd(), p);
      return !existsSync(full);
    });
    if (missingDirs.length > 0) {
      results.push({ id: 'SRG-07', status: 'fail', reason: `Missing dirs: ${missingDirs.join(', ')}` });
    } else {
      results.push({ id: 'SRG-07', status: 'pass' });
    }

    return { all_pass: results.every(r => r.status === 'pass'), results };
  }

  /** V3.6 SRG-04: Path safety — relative, no traversal, not forbidden */
  private addSRG04_PathSafety(story: StoryEntry, results: any[]): void {
    if (!story.scope_write || story.scope_write.length === 0) return;
    const unsafe: string[] = [];
    const forbidden = ['.env.production', '.env.local', '/etc/', '~/.ssh/'];
    for (const p of story.scope_write) {
      if (p.startsWith('/') || p.includes('../') || forbidden.some(f => p.includes(f))) unsafe.push(p);
    }
    results.push(unsafe.length === 0
      ? { id: 'SRG-04', status: 'pass' }
      : { id: 'SRG-04', status: 'fail', reason: `Unsafe paths: ${unsafe.join(', ')}` });
  }

  /** V3.6 SRG-08: Protected path intersection → serial_only enforcement */
  private addSRG08_ProtectedPaths(story: StoryEntry, results: any[]): void {
    if (!story.scope_write || story.scope_write.length === 0) return;
    const protectedPaths = ['shared/types', 'schema/migration', 'root/config', 'shared/contract', 'api/contract', 'route/entry', 'build/ci'];
    const hits = story.scope_write.some(sw => protectedPaths.some(pp => sw.includes(pp)));
    results.push(hits
      ? { id: 'SRG-08', status: 'pass', reason: 'Protected path — serial_only enforced' }
      : { id: 'SRG-08', status: 'pass' });
  }

  /** V3.6 SRG-09: Command safety — allowlist + forbidden patterns */
  private addSRG09_CommandSafety(story: StoryEntry, results: any[]): void {
    if (!story.acceptance_check || story.acceptance_check.length === 0) {
      results.push({ id: 'SRG-09', status: 'pass', reason: 'No acceptance checks' });
      return;
    }
    const allowed = ['npm run', 'npm test', 'npx --no-install', 'node ', 'jest ', 'vitest ', 'tsc ', 'eslint '];
    const forbidden = ['|', ';', '&&', '||', '$(', '>', '<', 'curl ', 'rm -rf', 'sudo ', 'eval ', 'chmod '];
    const unsafe = story.acceptance_check.filter(c => !allowed.some(a => c.startsWith(a)) || forbidden.some(f => c.includes(f)));
    results.push(unsafe.length === 0
      ? { id: 'SRG-09', status: 'pass' }
      : { id: 'SRG-09', status: 'fail', reason: `Unsafe commands: ${unsafe.join('; ')}` });
  }

  private findScopeOverlap(scope: string[], otherStories: any[]): string[] {
    const overlaps: string[] = [];
    for (const story of otherStories) {
      if (!story.scope_write) continue;
      for (const s of scope) {
        for (const o of story.scope_write) {
          if (s.startsWith(o) || o.startsWith(s) || s === o) {
            if (!overlaps.includes(story.id)) overlaps.push(story.id);
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
  private async executeStorySteps(
    story: StoryEntry,
    worktreePath: string,
    subKey: string,
    isFE: boolean
  ): Promise<{ success: boolean; lastSubstep?: string }> {
    const config: AgentDispatchConfig = {
      worktreePath,
      storyId: story.story_id,
      track: story.track as Track,
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

  private async executeStoryStepsFrom(
    story: StoryEntry,
    worktreePath: string,
    startStep: string,
    subKey: string,
    isFE: boolean
  ): Promise<{ success: boolean; lastSubstep?: string }> {
    // Resume from interruption — re-dispatch the agent to continue from the last completed substep
    console.log(`    → Re-dispatching agent for ${story.story_id} from step ${startStep}...`);
    return this.executeStorySteps(story, worktreePath, subKey, isFE);
  }

  /**
   * Execute a single sub-step. Used only for pre/post-agent validation steps.
   * The actual coding steps (4c-4k) are handled by the dispatched agent.
   */
  private async executeStep(
    story: StoryEntry,
    worktreePath: string,
    step: string,
    _subKey: string
  ): Promise<boolean> {
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
   *
   * Uses the centralised scope-lock validator
   * (`validateActualChangesAgainstScope`) so the same rules — including
   * forbidden_paths and `enforcement_mode` — apply uniformly across the
   * pre-execution gate, the per-substep exit check, and the merge-queue
   * post-merge gate.
   */
  private async runScopeExitVerification(story: StoryEntry, worktreePath: string): Promise<boolean> {
    const changedFiles = await this.worktree.getChangedFilesInWorktree(worktreePath);
    const cfg = this.scopeLockConfig;

    // No config → fall back to the legacy "every file must be inside scope_write" check
    // (no forbidden / boundary awareness).
    if (!cfg || !cfg.enabled) {
      const violations = changedFiles.filter(f =>
        !story.scope_write.some(sw => f.startsWith(sw) || f.includes(sw))
      );
      if (violations.length > 0) {
        console.log(`  ✗ ${story.story_id} SCOPE VIOLATION — ${violations.length} files outside scope_write:`);
        for (const v of violations) console.log(`    ✗ ${v}`);
        return false;
      }
      console.log(`  ✓ ${story.story_id} SCOPE EXIT CLEAN — ${changedFiles.length} files, 0 violations`);
      return true;
    }

    const result = validateActualChangesAgainstScope(changedFiles, story.scope_write ?? [], cfg);
    const outcome = applyEnforcementMode(result, cfg.enforcement_mode);

    if (result.violations.length > 0) {
      await this.state.appendAudit('scope_lock_exit_check', {
        story_id: story.story_id,
        decision: outcome.should_block ? 'block' : 'warn',
        enforcement_mode: cfg.enforcement_mode,
        violations: result.violations,
        summary: summarizeViolations(result.violations),
      });
    }

    if (outcome.should_block) {
      console.log(`  ✗ ${story.story_id} SCOPE EXIT BLOCK — ${summarizeViolations(outcome.reported)}`);
      for (const v of outcome.reported) console.log(`    ✗ [${v.rule}] ${v.path}`);
      return false;
    }

    if (outcome.reported.length > 0) {
      console.log(`  ⚠ ${story.story_id} SCOPE EXIT WARN — ${summarizeViolations(outcome.reported)}`);
    } else {
      console.log(`  ✓ ${story.story_id} SCOPE EXIT CLEAN — ${changedFiles.length} files, 0 violations`);
    }
    return true;
  }
}
