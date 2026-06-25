/**
 * Dispatch Loop Engine — the automatic dispatch protocol for Phase 4.
 *
 * Currently, the main dispatch loop requires the parent Claude session to:
 *   1. Run `wdf start`
 *   2. Read the manifest
 *   3. Dispatch Agent tool
 *   4. Wait for result
 *   5. Run `wdf start` again
 *   6. Repeat
 *
 * This engine automates the "what should I do next?" question by scanning
 * ALL stories' pipeline states and returning a single, structured
 * "next action" for the parent session. The parent session can then:
 *   - Execute the action (dispatch agent / handle escalation)
 *   - Call `wdf loop --next` again
 *   - Until all stories are complete or an escalation requires human input
 *
 * This is the "半自动 → 全自动" switch: instead of the parent session
 * manually driving the loop, it can enter a tight dispatch-next loop.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { SprintStatusManager } from './sprint-status.js';
import {
  type StoryEntry,
  type PipelineStage,
  type PipelineDispatchManifest,
  type PipelineEscalation,
  type PipelineContext,
} from './types.js';
import {
  processStoryPipeline,
  type PipelineAction,
} from './pipeline-runner.js';
import { stageToRole, advancePipeline, writeEscalationManifest } from './pipeline-engine.js';
import { classifyDispatch, type DispatchRecommendation } from './dispatch-classifier.js';
import {
  applyRolePermissions,
  revokePermissions,
} from './permission-injector.js';
import { appendAudit } from './audit-logger.js';
import { loadConfig } from './config.js';

// ── Types ──────────────────────────────────────────────────

export type LoopAction =
  | {
      kind: 'dispatch';
      story_id: string;
      title: string;
      track: string;
      stage: PipelineStage;
      attempt: number;
      max_retries: number;
      role: string;
      manifest: PipelineDispatchManifest;
      manifest_path: string;
      /** Number of stories still pending after this one */
      remaining: number;
      /** Whether this is a fix-retry (stage went backwards) */
      is_retry: boolean;
      /** Feedback from prior stage failure (if fix-retry) */
      feedback?: string;
      /** Permissions already applied to settings.local.json */
      permissions_applied: boolean;
    }
  | {
      kind: 'escalation';
      story_id: string;
      escalation: PipelineEscalation;
      /** Stories still pending (other than the escalated one) */
      remaining: number;
    }
  | {
      kind: 'complete';
      /** All stories are done (merged or skipped) */
      summary: LoopCompleteSummary;
    }
  | {
      kind: 'blocked';
      story_id: string;
      reason: string;
      /** What needs to happen before this story can proceed */
      blocked_by: string[];
    };

export interface LoopCompleteSummary {
  total_stories: number;
  merged: number;
  skipped: number;
  escalated: number;
  blocked: number;
  completed_at: string;
}

export interface LoopNextResult {
  action: LoopAction;
  /**
   * Phase C (V3.10.3): explicit dispatch recommendation. When `action.kind`
   * is 'dispatch', this carries the agent role, manifest path, reason, and
   * auto-eligibility flag derived from the classifier — so the main session
   * reads one field instead of inferring from action shape. Undefined when
   * there is nothing to dispatch (skip / complete / escalation).
   */
  next_dispatch?: DispatchRecommendation;
  /** Full pipeline state snapshot for observability */
  pipeline_snapshot: StoryPipelineSnapshot[];
  /** Timestamp of this evaluation */
  evaluated_at: string;
}

export interface StoryPipelineSnapshot {
  story_id: string;
  title: string;
  track: string;
  status: string;
  stage: PipelineStage;
  attempt: number;
  /** Whether this story is the next action target */
  is_next: boolean;
}

// ── Core Engine ────────────────────────────────────────────

/**
 * Promote PIPELINE_ESCALATED stories to FAIL when their hold window expires.
 *
 * The hold window is configurable via `[pipeline] escalation_hold_hours` in
 * customize.toml (default 24h). Set `[pipeline] auto_fail_on_hold_timeout = false`
 * to disable auto-promotion — the story will stay ESCALATED indefinitely,
 * forcing the user to resolve it via `wdf escalate --resolve|--reject`.
 *
 * Escalation timestamp resolution (most → least reliable):
 *   1. `escalated_at` field in ESCALATED.json (V3.9+)
 *   2. `created_at` field in ESCALATED.json (legacy alias)
 *   3. File mtime (last resort — implies the JSON was rewritten)
 *
 * Conservative bias: when in doubt, keep waiting. We only FAIL when we have
 * a reliable timestamp AND it's clearly past the window.
 */
function sweepStaleEscalations(
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
  frameworkRoot: string,
): { swept: string[]; skipped: string[] } {
  // Load config — tolerate failures by falling back to defaults rather
  // than aborting the dispatch loop.
  let holdHours = 24;
  let autoFail = true;
  try {
    const { config } = loadConfig(projectRoot, { skillRoot: frameworkRoot });
    const pipeline = (config as any).pipeline;
    if (pipeline?.escalation_hold_hours !== undefined) {
      holdHours = Number(pipeline.escalation_hold_hours);
      if (!Number.isFinite(holdHours) || holdHours < 0) holdHours = 24;
    }
    if (pipeline?.auto_fail_on_hold_timeout === false) {
      autoFail = false;
    }
  } catch {
    // Use defaults
  }

  if (!autoFail) return { swept: [], skipped: [] };

  const holdMs = holdHours * 3600 * 1000;
  const now = Date.now();
  const swept: string[] = [];
  const skipped: string[] = [];

  for (const subKey of ['phase_4_4', 'phase_4_10'] as const) {
    const stories = state.getStories(4, subKey);
    for (const story of stories) {
      if (story.status !== 'PIPELINE_ESCALATED') continue;

      const escPath = join(outputDir, '.dispatch', 'pipeline', story.id, 'ESCALATED.json');
      if (!existsSync(escPath)) {
        skipped.push(story.id);
        continue;
      }

      let escalatedAt: Date | null = null;
      try {
        const raw = JSON.parse(readFileSync(escPath, 'utf-8'));
        const ts = raw.escalated_at ?? raw.created_at;
        if (ts) {
          escalatedAt = new Date(ts);
        } else {
          escalatedAt = new Date(statSync(escPath).mtimeMs);
        }
      } catch {
        skipped.push(story.id);
        continue;
      }

      if (!escalatedAt || Number.isNaN(escalatedAt.getTime())) {
        skipped.push(story.id);
        continue;
      }

      const elapsedMs = now - escalatedAt.getTime();
      if (elapsedMs < holdMs) {
        skipped.push(story.id);
        continue;
      }

      // Promote to FAIL — terminal, recoverable only via `wdf reset --force`
      state.updateStoryStatus(4, subKey, {
        ...story,
        status: 'FAIL',
        completed_at: new Date().toISOString(),
      });

      appendAudit(projectRoot, 'pipeline_fail', {
        story_id: story.id,
        status: 'fail',
        message: `Escalation hold timeout after ${Math.round(elapsedMs / 3600000)}h (limit ${holdHours}h) — auto-promoted PIPELINE_ESCALATED → FAIL`,
        details: {
          hold_hours_elapsed: Math.round(elapsedMs / 3600000),
          hold_limit_hours: holdHours,
          escalated_at: escalatedAt.toISOString(),
          sub_key: subKey,
          recovery: 'Run `wdf reset --force --story=' + story.id + '` to recover',
        },
      });

      swept.push(story.id);
    }
  }

  return { swept, skipped };
}

/**
 * Evaluate all stories and return the next action for the parent session.
 *
 * Priority order:
 *   1. Escalated stories (need human attention)
 *   2. Stories ready to dispatch (highest merge_order first for dependency safety)
 *   3. All done → 'complete'
 */
export function evaluateNextLoopAction(
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
  frameworkRoot: string,
): LoopNextResult {
  // ── Sweep stale escalations ──
  // PIPELINE_ESCALATED is the "awaiting human review" state. If the human
  // never shows up (default 24h), promote to FAIL. This is the only
  // automatic path from ESCALATED → FAIL; the other path is
  // `wdf escalate --reject` (manual).
  //
  // Why poll here instead of a background timer: the wdf CLI is a short-
  // lived process invoked by the parent Claude session — there is no
  // daemon. The dispatch loop IS the heartbeat. If the parent session
  // stops calling, nothing should auto-fail; if it keeps calling, the
  // sweep catches up on every tick.
  sweepStaleEscalations(state, outputDir, projectRoot, frameworkRoot);

  const devOrder = state.data.global_state.development_order ?? [];
  if (devOrder.length === 0) {
    return {
      action: {
        kind: 'complete',
        summary: {
          total_stories: 0,
          merged: 0,
          skipped: 0,
          escalated: 0,
          blocked: 0,
          completed_at: new Date().toISOString(),
        },
      },
      pipeline_snapshot: [],
      evaluated_at: new Date().toISOString(),
    };
  }

  // Process all stories to get their pipeline actions
  const actions: { story: StoryEntry; action: PipelineAction }[] = [];
  for (const story of devOrder) {
    const action = processStoryPipeline(story, state, outputDir, projectRoot, frameworkRoot);
    actions.push({ story, action });
  }

  // Build pipeline snapshots
  const snapshots: StoryPipelineSnapshot[] = [];
  const subKey = (track: string) =>
    track === 'frontend' ? 'phase_4_10' :
    track === 'backend' ? 'phase_4_4' : 'phase_4_4';

  for (const { story } of actions) {
    const existing = state.getStories(4, subKey(story.track))
      .find(s => s.id === story.story_id);
    const pipeline = existing?.pipeline;
    snapshots.push({
      story_id: story.story_id,
      title: story.title,
      track: story.track,
      status: existing?.status ?? 'NOT_STARTED',
      stage: pipeline?.stage ?? 'dev',
      attempt: pipeline?.attempt ?? 0,
      is_next: false,
    });
  }

  // ── Priority 1: Escalations ──
  const escalated = actions.find(a => a.action.kind === 'escalation');
  if (escalated && escalated.action.kind === 'escalation') {
    const remaining = actions.filter(
      a => a.action.kind !== 'skip' && a.action.kind !== 'complete' && a.story.story_id !== escalated.story.story_id
    ).length;

    const action: LoopAction = {
      kind: 'escalation',
      story_id: escalated.story.story_id,
      escalation: escalated.action.escalation!,
      remaining,
    };

    // Mark the snapshot
    const snap = snapshots.find(s => s.story_id === escalated.story.story_id);
    if (snap) snap.is_next = true;

    return { action, pipeline_snapshot: snapshots, evaluated_at: new Date().toISOString() };
  }

  // ── Priority 2: Dispatch-ready stories (dependency-safe) ──
  // Sort by merge_order / dependency: dispatch stories whose dependencies
  // are all MERGED first.
  const dispatchable = actions
    .filter(a => a.action.kind === 'dispatch')
    .filter(a => areDependenciesMet(a.story, state));

  if (dispatchable.length > 0) {
    // Pick the first dispatchable story (lowest merge_order = earliest dependency)
    const next = dispatchable[0];
    const remaining = actions.filter(
      a => a.action.kind !== 'skip' && a.action.kind !== 'complete'
    ).length - 1; // -1 for the one we're about to dispatch

    const manifest = next.action.manifest!;
    const manifestPath = next.action.manifest_path!;
    const isRetry = (next.action.manifest?.attempt ?? 1) > 1;
    const role = stageToRole(next.story.track, next.action.manifest!.stage);

    // Apply V3 three-layer permissions
    let permissionsApplied = false;
    try {
      applyRolePermissions(role, next.story.story_id, next.action.manifest!.stage, projectRoot, frameworkRoot);
      permissionsApplied = true;
    } catch {
      // Non-fatal — permission injection failure shouldn't block dispatch
    }

    const action: LoopAction = {
      kind: 'dispatch',
      story_id: next.story.story_id,
      title: next.story.title,
      track: next.story.track,
      stage: next.action.manifest!.stage,
      attempt: next.action.manifest!.attempt,
      max_retries: next.action.manifest!.max_retries,
      role,
      manifest,
      manifest_path: manifestPath,
      remaining,
      is_retry: isRetry,
      feedback: next.action.manifest!.feedback,
      permissions_applied: permissionsApplied,
    };

    // Phase C (V3.10.3): derive an explicit dispatch recommendation so
    // the main session reads one field instead of inferring from action
    // shape. The classifier is a pure function over (stage, pipeline,
    // story) — no filesystem I/O. Pipeline state comes from sprint-status
    // (single source of truth) rather than the manifest, which only
    // carries stage/attempt.
    const existingStatus = state.getStories(4, subKey(next.story.track))
      .find(s => s.id === next.story.story_id);
    const next_dispatch = classifyDispatch({
      stage: next.action.manifest!.stage,
      pipeline: existingStatus?.pipeline ?? { stage: next.action.manifest!.stage, attempt: 1, total_retries: 0, max_retries: 5 } as PipelineContext,
      story: next.story,
      manifestPath,
    }) ?? undefined;

    const snap = snapshots.find(s => s.story_id === next.story.story_id);
    if (snap) snap.is_next = true;

    return { action, next_dispatch, pipeline_snapshot: snapshots, evaluated_at: new Date().toISOString() };
  }

  // ── Priority 3: Blocked stories (with dependency-wait timeout) ──
  // A story is "blocked" when its depends_on are not all MERGED. The
  // first time we detect this, we stamp blocked_since on the story
  // status. If the block persists past dependency_wait_timeout_minutes
  // (default 15), we auto-escalate — otherwise the system would wait
  // forever for a dependency that may never complete.
  const blocked = actions
    .filter(a => a.action.kind !== 'skip' && a.action.kind !== 'complete')
    .filter(a => !areDependenciesMet(a.story, state));

  if (blocked.length > 0) {
    const first = blocked[0];
    const unmetDeps = getUnmetDependencies(first.story, state);

    // Check timeout: if this story has been blocked too long, escalate.
    const timeoutEscalation = checkDependencyTimeout(
      first.story,
      unmetDeps,
      state,
      outputDir,
      projectRoot,
      frameworkRoot,
    );
    if (timeoutEscalation) {
      const remaining = actions.filter(
        a => a.action.kind !== 'skip' && a.action.kind !== 'complete'
          && a.story.story_id !== first.story.story_id
      ).length;
      const action: LoopAction = {
        kind: 'escalation',
        story_id: first.story.story_id,
        escalation: timeoutEscalation,
        remaining,
      };
      const snap = snapshots.find(s => s.story_id === first.story.story_id);
      if (snap) snap.is_next = true;
      return { action, pipeline_snapshot: snapshots, evaluated_at: new Date().toISOString() };
    }

    const action: LoopAction = {
      kind: 'blocked',
      story_id: first.story.story_id,
      reason: `Dependencies not met: ${unmetDeps.join(', ')}`,
      blocked_by: unmetDeps,
    };
    return { action, pipeline_snapshot: snapshots, evaluated_at: new Date().toISOString() };
  }

  // ── Priority 4: All done ──
  const merged = actions.filter(a => a.action.kind === 'skip' || a.action.kind === 'complete').length;
  const escalatedCount = actions.filter(a => a.action.kind === 'escalation').length;
  const action: LoopAction = {
    kind: 'complete',
    summary: {
      total_stories: devOrder.length,
      merged,
      skipped: 0,
      escalated: escalatedCount,
      blocked: 0,
      completed_at: new Date().toISOString(),
    },
  };

  return { action, pipeline_snapshot: snapshots, evaluated_at: new Date().toISOString() };
}

// ── Post-dispatch Processing ───────────────────────────────

/**
 * After a sub-agent completes, call this to:
 *   1. Advance the pipeline for the completed stage (dev→review is the only
 *      explicit advance — other stages are advanced by report processing
 *      inside processStoryPipeline).
 *   2. Revoke permissions for the completed story+stage.
 *   3. Return the next action.
 *
 * This is the "one-call" post-dispatch handler.
 *
 * Why dev→review needs an explicit advance: the dev stage has no on-disk
 * report to indicate completion (the dev agent just writes code). So
 * processStoryPipeline cannot detect "dev done" on its own — it would
 * either never advance (stuck) or always advance (skipping dev, the
 * original bug). The parent session signals completion by calling this
 * function, which advances the pipeline explicitly.
 */
export function postDispatchNext(
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
  frameworkRoot: string,
  completedStoryId: string,
  completedStage: PipelineStage,
): LoopNextResult {
  // Step 1: explicitly advance the pipeline for the completed story+stage.
  // Only dev→review is needed here; review/testing/qa advances are driven
  // by their report files via processStoryPipeline.
  advanceCompletedStage(state, completedStoryId, completedStage);

  // Step 2: revoke permissions for the completed dispatch
  try {
    revokePermissions(completedStoryId, completedStage, projectRoot);
  } catch {
    // Non-fatal — cleanup failure shouldn't block next dispatch
  }

  return evaluateNextLoopAction(state, outputDir, projectRoot, frameworkRoot);
}

/**
 * Advance the pipeline for a story after its dispatched agent completes.
 *
 * For dev: advance dev→review. The dev agent doesn't write a report, so
 *   the only way to know dev is "done" is the parent session calling
 *   postDispatchNext after the dev agent returns.
 *
 * For review/testing/qa: no explicit advance here. Their reports drive
 *   advancement inside processStoryPipeline on the next loop call.
 */
function advanceCompletedStage(
  state: SprintStatusManager,
  storyId: string,
  completedStage: PipelineStage,
): void {
  if (completedStage !== 'dev') return;

  // Search both tracks for the story
  for (const subKey of ['phase_4_4', 'phase_4_10']) {
    const stories = state.getStories(4, subKey);
    const existing = stories.find(s => s.id === storyId);
    if (!existing?.pipeline) continue;
    if (existing.pipeline.stage !== 'dev') continue; // already advanced

    const advanced = advancePipeline(existing.pipeline, true);
    state.updateStoryStatus(4, subKey, {
      ...existing,
      status: 'IN_REVIEW',
      pipeline: advanced,
    });
    break;
  }
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Check if all dependencies of a story are MET (i.e. their stories are MERGED).
 */
function areDependenciesMet(
  story: StoryEntry,
  state: SprintStatusManager,
): boolean {
  if (!story.depends_on || story.depends_on.length === 0) return true;

  for (const dep of story.depends_on) {
    const subKey = dep.track === 'frontend' ? 'phase_4_10' :
                   dep.track === 'backend' ? 'phase_4_4' : 'phase_4_4';
    const depStory = state.getStories(4, subKey).find(s => s.id === dep.story_id);
    if (!depStory || depStory.status !== 'MERGED') {
      return false;
    }
  }
  return true;
}

/**
 * Return the list of unmet dependency story IDs for a story.
 */
function getUnmetDependencies(
  story: StoryEntry,
  state: SprintStatusManager,
): string[] {
  if (!story.depends_on) return [];
  const unmet: string[] = [];
  for (const dep of story.depends_on) {
    const subKey = dep.track === 'frontend' ? 'phase_4_10' :
                   dep.track === 'backend' ? 'phase_4_4' : 'phase_4_4';
    const depStory = state.getStories(4, subKey).find(s => s.id === dep.story_id);
    if (!depStory || depStory.status !== 'MERGED') {
      unmet.push(dep.story_id);
    }
  }
  return unmet;
}

/**
 * Read dependency_wait_timeout_minutes from config. Falls back to 15min
 * if config is unreadable or the key is missing. Mirrors the tolerance
 * pattern used by sweepStaleEscalations.
 */
function getDependencyTimeoutMinutes(frameworkRoot: string, projectRoot: string): number {
  try {
    const { config } = loadConfig(projectRoot, { skillRoot: frameworkRoot });
    const concurrency = (config as any)?.auto_run?.concurrency;
    const raw = concurrency?.dependency_wait_timeout_minutes;
    if (typeof raw === 'number' && raw > 0) return raw;
  } catch {
    // Use default
  }
  return 15;
}

/**
 * Check whether a blocked story has exceeded its dependency wait window.
 *
 * Returns an escalation manifest if the story should be promoted to
 * PIPELINE_ESCALATED; returns null otherwise.
 *
 * Side effects on timeout:
 *   - Writes ESCALATED.json manifest via writeEscalationManifest
 *   - Updates story status to PIPELINE_ESCALATED with blocked_since preserved
 *   - Emits pipeline_escalation audit entry (via writeEscalationManifest)
 *
 * Side effects on first detection (no timeout yet):
 *   - Stamps blocked_since on the story status for future timeout checks
 */
function checkDependencyTimeout(
  story: StoryEntry,
  unmetDeps: string[],
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
  frameworkRoot: string,
): PipelineEscalation | null {
  if (unmetDeps.length === 0) return null;

  // Locate the story status in either BE or FE track
  const subKey = story.track === 'frontend' ? 'phase_4_10' : 'phase_4_4';
  const stories = state.getStories(4, subKey);
  const existing = stories.find(s => s.id === story.story_id);
  if (!existing) return null;

  // Already escalated/failed — nothing to do
  if (existing.status === 'PIPELINE_ESCALATED' || existing.status === 'FAIL') {
    return null;
  }

  const now = Date.now();
  const timeoutMinutes = getDependencyTimeoutMinutes(frameworkRoot, projectRoot);
  const timeoutMs = timeoutMinutes * 60 * 1000;

  // First detection: stamp blocked_since and return null
  if (!existing.blocked_since) {
    state.updateStoryStatus(4, subKey, {
      ...existing,
      blocked_since: new Date(now).toISOString(),
    });
    return null;
  }

  const blockedAt = new Date(existing.blocked_since).getTime();
  if (Number.isNaN(blockedAt)) return null;

  const elapsed = now - blockedAt;
  if (elapsed < timeoutMs) return null;

  // Timeout exceeded — escalate
  const escalation = writeEscalationManifest(
    story,
    existing.pipeline?.stage ?? 'dev',
    `Dependency wait timeout after ${Math.round(elapsed / 60000)}min (limit ${timeoutMinutes}min). Unmet: ${unmetDeps.join(', ')}`,
    outputDir,
    {
      totalAttempts: existing.pipeline?.total_retries ?? 0,
      projectRoot,
      failedStages: existing.pipeline ? [existing.pipeline.stage] : ['dev'],
      lastFeedback: `Dependencies never completed: ${unmetDeps.join(', ')}`,
    },
  );

  state.updateStoryStatus(4, subKey, {
    ...existing,
    status: 'PIPELINE_ESCALATED',
  });

  appendAudit(projectRoot, 'pipeline_escalation', {
    story_id: story.story_id,
    status: 'fail',
    message: `Dependency timeout after ${Math.round(elapsed / 60000)}min waiting on: ${unmetDeps.join(', ')}`,
    details: {
      blocked_since: existing.blocked_since,
      timeout_minutes: timeoutMinutes,
      unmet_dependencies: unmetDeps,
      sub_key: subKey,
      recovery: 'Run `wdf reset --force --story=' + story.story_id + '` after resolving dependencies',
    },
  });

  return escalation;
}

/**
 * Map track → agent role name (matches references/agents/*.md filenames).
 *
 * @deprecated Use stageToRole() from pipeline-engine.js instead — it correctly
 * considers BOTH track and stage (review/testing stages use code-reviewer,
 * qa uses qa-verifier). This track-only mapper returns the wrong role for
 * non-dev stages and is kept only for backward compatibility with any
 * external callers.
 */
function inferRoleFromTrack(track: string): string {
  switch (track) {
    case 'backend': return 'backend-developer';
    case 'frontend': return 'frontend-developer';
    case 'full-stack': return 'backend-developer'; // fallback
    default: return 'backend-developer';
  }
}
