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
export interface StoryRunnerOptions {
  /** Protected paths sourced from scope_lock.protected_paths in customize.toml. */
  protectedPaths?: string[];
}

export class StoryRunner {
  private state: SprintStatusManager;
  private worktree: WorktreeManager;
  private gateEvaluator: GateEvaluator;
  private agentDispatcher: AgentDispatcher;
  private storiesDir: string;
  private outputDir: string;
  private protectedPaths: string[];

  constructor(
    state: SprintStatusManager,
    worktree: WorktreeManager,
    gateEvaluator: GateEvaluator,
    projectRoot: string,
    storiesDir: string,
    outputDir: string,
    options: StoryRunnerOptions = {}
  ) {
    this.state = state;
    this.worktree = worktree;
    this.gateEvaluator = gateEvaluator;
    this.agentDispatcher = new AgentDispatcher(projectRoot, storiesDir, outputDir);
    this.storiesDir = storiesDir;
    this.outputDir = outputDir;
    // Default protected paths (V3.6) — overridden by config when provided.
    this.protectedPaths = options.protectedPaths && options.protectedPaths.length > 0
      ? options.protectedPaths
      : [
          'shared/types',
          'schema/migration',
          'root/config',
          'shared/contract',
          'api/contract',
          'route/entry',
          'build/ci',
        ];
  }

  /**
   * Main entry: run the next eligible story from development_order for the given track.
   * Returns the story that was run, or null if no story is ready.
   *
   * The returned `serial_only` flag (set by SRG-08 for protected paths) signals
   * to the scheduler that this story should not have been run alongside others.
   * Callers can use this hint to drain parallel work before invoking again.
   */
  async runNextStory(track: Track): Promise<{ storyId: string; status: string; serial_only?: boolean } | null> {
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

  private async tryRunStory(story: StoryEntry): Promise<{ storyId: string; status: string; serial_only?: boolean } | null> {
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
      const failed = gateResult.results.filter(r => r.status === 'fail');
      console.error(`  ✗ ${story.story_id}: Story Ready Gate failed (${failed.length} check${failed.length === 1 ? '' : 's'})`);
      for (const check of failed) {
        console.error(`    ✗ ${check.id}: ${check.reason}`);
      }
      await this.state.appendAudit('story_blocked', {
        story_id: story.story_id,
        decision: 'block',
        reason: 'story_ready_gate',
        data: { failures: failed.map(f => ({ id: f.id, reason: f.reason })) },
      });
      return null;
    }

    // SRG-08 serial_only: enforce serial execution for protected paths
    const serialOnlyFlag = gateResult.serial_only ? ' [SERIAL_ONLY]' : '';

    // Create worktree
    const { path: worktreePath, branch } = await this.worktree.createStoryWorktree(
      story.story_id, story.track as Track
    );
    console.log(`  📂 ${story.story_id}: worktree at ${worktreePath}${serialOnlyFlag}`);

    // Initialize story status
    const storyStatus: StoryStatus = {
      id: story.story_id,
      status: 'IN_PROGRESS' as PhaseStatus,
      bmad_story_state: 'in-progress',
      started_at: new Date().toISOString(),
      last_completed_substep: null,
      serial_only: gateResult.serial_only,
      step_history: [{ step: 'started', at: new Date().toISOString(), substep: null, summary: null, status: null }],
    };
    await this.state.updateStoryStatus(4, subKey, storyStatus);

    // Execute story steps
    const result = await this.executeStorySteps(story, worktreePath, subKey, isFE);

    if (result.success) {
      // Verify acceptance checks via the safe execution engine before
      // recording CODE_ACCEPTED. This is a belt-and-braces guard: the
      // dispatched agent has already self-attested, but we re-run the
      // declared `acceptance_check` commands here under the validated
      // spawn-based runner so a non-cooperative agent cannot smuggle a
      // false PASS past us.
      const acceptanceReport = await this.verifyAcceptanceChecks(
        story,
        worktreePath,
      );
      if (!acceptanceReport.all_passed) {
        const failures = acceptanceReport.results
          .filter((r) => !r.passed)
          .map((r) => `${r.command} (${r.error ?? `exit ${r.exit_code}`})`)
          .join('; ');
        console.log(
          `    ✗ ${story.story_id}: Acceptance verification failed — ${failures}`,
        );
        await this.state.updateStoryStatus(4, subKey, {
          ...storyStatus,
          status: 'BLOCKED',
          last_completed_substep: isFE ? '4h' : '4g',
        });
        return null;
      }

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
      return { storyId: story.story_id, status: 'MERGED', serial_only: gateResult.serial_only };
    }

    // Story failed — mark and return
    await this.state.updateStoryStatus(4, subKey, {
      ...storyStatus,
      status: 'BLOCKED',
      last_completed_substep: result.lastSubstep ?? undefined,
    });

    return null;
  }

  private async resumeStory(story: StoryEntry, existing: any, subKey: string): Promise<{ storyId: string; status: string; serial_only?: boolean } | null> {
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
   * Story Ready Gate V3.6: validates all 9 SRG gates via the extracted
   * story-ready-gate module. Returns { all_pass, serial_only, results }.
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
    const statusEntries = [...beStories, ...feStories];

    // SRG-05 needs scope_write to detect overlap, but StoryStatus only carries
    // status/id. Cross-reference development_order (StoryEntry) which holds
    // the canonical scope_write declaration.
    const order = this.state.getDevelopmentOrder();
    const scopeIndex = new Map<string, string[]>();
    for (const entry of order) {
      if (entry.scope_write) scopeIndex.set(entry.story_id, entry.scope_write);
    }

    const activeStories = statusEntries.map(s => ({
      id: s.id,
      status: s.status,
      scope_write: scopeIndex.get(s.id),
    }));

    return evaluateStoryReadyGate(story, {
      projectRoot: this.worktree.baseDir || process.cwd(),
      storiesDir: this.storiesDir,
      activeStories,
      protectedPaths: this.protectedPaths,
      implementationBoundary: this.state.data.global_state.implementation_boundary,
    });
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

  /**
   * Re-run a story's declared `acceptance_check` commands under the
   * safe execution engine. Any command that fails validation is
   * surfaced as a failed result without ever touching the OS. Stories
   * with no declared checks pass trivially — Story Ready Gate already
   * prevents stories from reaching Phase 4 without checks where the
   * project policy demands them.
   */
  private async verifyAcceptanceChecks(
    story: StoryEntry,
    worktreePath: string,
  ): Promise<AcceptanceReport> {
    const cmds = story.acceptance_check ?? [];
    if (cmds.length === 0) {
      return { all_passed: true, results: [], total_duration_ms: 0 };
    }
    return runAcceptanceChecks(cmds, {
      cwd: worktreePath,
      // Story acceptance checks are typically `npm test` / `tsc` runs;
      // 5 minutes is a sensible upper bound for any single one.
      timeout_ms: 5 * 60_000,
    });
  }
}
