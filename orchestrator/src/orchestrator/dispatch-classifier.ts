/**
 * dispatch-classifier.ts — Phase C (V3.10.3) dispatch recommendation engine.
 *
 * Pure function `(stage, lastResult, attempt, story) → DispatchRecommendation`.
 *
 * The loop engine calls this in `postDispatchNext()` to populate the
 * `next_dispatch` field on `LoopNextResult`. The main Claude session then
 * reads `next_dispatch` directly — no more inferring agent role from action
 * kind, parsing feedback strings, or hand-routing escalations.
 *
 * Decision matrix (per stage):
 *
 *   dev (fresh)         → backend/frontend-developer (per story.track)
 *   dev (fix loop)      → same dev role, with feedback attached
 *   review              → code-reviewer (adversarial)
 *   testing             → code-reviewer (test-coverage focus)
 *   qa                  → qa-verifier
 *   review FAIL         → dev role with review feedback
 *   testing FAIL        → dev role with test feedback
 *   qa FAIL             → dev role with QA feedback
 *   budget exhausted    → no recommendation (escalation only)
 *
 * `auto_dispatch_eligible` flags stages where the dispatch manifest can be
 * built without a human picking the scope (i.e. all post-dev stages whose
 * inputs are mechanically derivable from upstream artifacts). Dev stages
 * always need the human to confirm scope before kicking off.
 */

import {
  type PipelineStage,
  type PipelineContext,
  type StoryEntry,
} from './types.js';

export type AgentRole = 'backend-developer' | 'frontend-developer' | 'code-reviewer' | 'qa-verifier';

export interface DispatchRecommendation {
  agent_role: AgentRole;
  manifest_path?: string;
  reason: string;
  auto_dispatch_eligible: boolean;
  /** When true, a prior stage failed and this dispatch carries feedback. */
  is_fix_loop: boolean;
  /** Where the recommendation came from — useful for telemetry / debug. */
  decision_rule: string;
}

export interface ClassifierInput {
  stage: PipelineStage;
  pipeline: PipelineContext;
  story: StoryEntry;
  /** Path to the manifest that processStoryPipeline() just wrote, if any. */
  manifestPath?: string;
}

/**
 * Pick the agent role + rationale for the next dispatch.
 *
 * The classifier never reads the filesystem — callers pass the resolved
 * manifest path so the function stays pure and unit-testable.
 */
export function classifyDispatch(input: ClassifierInput): DispatchRecommendation | null {
  const { stage, pipeline, story, manifestPath } = input;

  // Budget exhausted — escalation territory, not dispatch territory.
  if (pipeline.total_retries >= pipeline.max_retries) {
    return null;
  }

  const devRole: AgentRole = story.track === 'frontend' ? 'frontend-developer' : 'backend-developer';
  const inFixLoop = (pipeline.last_failure?.stage ?? null) !== null && stage === 'dev';

  switch (stage) {
    case 'dev': {
      if (inFixLoop && pipeline.last_failure) {
        return {
          agent_role: devRole,
          manifest_path: manifestPath,
          reason: `Fix loop: previous ${pipeline.last_failure.stage} failed (${pipeline.last_failure.error}). Re-implement with attached feedback.`,
          auto_dispatch_eligible: false,
          is_fix_loop: true,
          decision_rule: `dev:fix-loop:${pipeline.last_failure.stage}`,
        };
      }
      return {
        agent_role: devRole,
        manifest_path: manifestPath,
        reason: `Fresh dev dispatch — ${devRole} implements story ${story.story_id} per scope_write.`,
        auto_dispatch_eligible: false, // dev always wants human eyes on scope
        is_fix_loop: false,
        decision_rule: 'dev:fresh',
      };
    }

    case 'review': {
      return {
        agent_role: 'code-reviewer',
        manifest_path: manifestPath,
        reason: `Adversarial code review for ${story.story_id}. Reviewer reads the diff, flags issues, writes review-report.json.`,
        auto_dispatch_eligible: true, // scope = story.scope_write (mechanical)
        is_fix_loop: false,
        decision_rule: 'review:adversarial',
      };
    }

    case 'testing': {
      return {
        agent_role: 'code-reviewer',
        manifest_path: manifestPath,
        reason: `Test-coverage review for ${story.story_id}. Reviewer runs acceptance_check commands, writes test-report.json with pass/fail per check.`,
        auto_dispatch_eligible: true, // scope = story.acceptance_check
        is_fix_loop: false,
        decision_rule: 'testing:coverage',
      };
    }

    case 'qa': {
      return {
        agent_role: 'qa-verifier',
        manifest_path: manifestPath,
        reason: `QA verification for ${story.story_id}. Verifier re-runs AC checks end-to-end and writes qa-report.json.`,
        auto_dispatch_eligible: true,
        is_fix_loop: false,
        decision_rule: 'qa:final-acceptance',
      };
    }

    default: {
      return null;
    }
  }
}

/**
 * Format a recommendation as a one-liner for status displays.
 */
export function formatRecommendation(r: DispatchRecommendation): string {
  const tag = r.is_fix_loop ? '[fix]' : '[ok]';
  const auto = r.auto_dispatch_eligible ? ' (auto)' : '';
  return `${tag} ${r.agent_role}${auto} — ${r.reason}`;
}
