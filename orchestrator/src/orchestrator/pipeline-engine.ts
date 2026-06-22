/**
 * Pipeline Engine — core state machine for the per-story
 * dev → review → testing → QA pipeline.
 *
 * This module is the pure-logic layer: it knows how to:
 *   - Initialize a pipeline context
 *   - Advance a pipeline through stages (PASS/FAIL)
 *   - Detect escalation (retry budget exhausted)
 *   - Build & write dispatch manifests
 *   - Read stage reports (review / test / QA) from disk
 *
 * It does NOT dispatch agents — that is the parent Claude session's job.
 * pipeline-runner.ts composes these primitives with SprintStatusManager.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type {
  StoryEntry,
  PipelineStage,
  PipelineContext,
  PipelineDispatchManifest,
  PipelineEscalation,
} from './types.js';
import { PIPELINE_STAGES, MAX_PIPELINE_RETRIES } from './types.js';

// ── Pipeline Context Management ────────────────────────────

/**
 * Create a fresh pipeline context at the dev stage, attempt 1.
 */
export function initPipelineContext(): PipelineContext {
  return {
    stage: 'dev',
    attempt: 1,
    total_retries: 0,
    max_retries: MAX_PIPELINE_RETRIES,
  };
}

/**
 * Advance the pipeline one step.
 *
 * On PASS: move to the next stage (dev → review → testing → qa → done).
 * On FAIL: always go back to dev (fix loop) and increment retries.
 *
 * Returns the updated context. The caller is responsible for persisting it.
 */
export function advancePipeline(ctx: PipelineContext, pass: boolean): PipelineContext {
  if (pass) {
    const currentIdx = PIPELINE_STAGES.indexOf(ctx.stage);
    if (currentIdx < PIPELINE_STAGES.length - 1) {
      // Move to next stage
      return {
        ...ctx,
        stage: PIPELINE_STAGES[currentIdx + 1],
        attempt: 1, // attempt resets on each new stage
        feedback: undefined,
      };
    }
    // Already at last stage (qa) and passed — pipeline complete.
    // Return as-is; the caller (pipeline-runner) handles the "complete" case.
    return ctx;
  }

  // FAIL: go back to dev for a fix iteration
  const newTotalRetries = ctx.total_retries + 1;
  return {
    ...ctx,
    stage: 'dev',
    attempt: ctx.attempt + 1,
    total_retries: newTotalRetries,
  };
}

/**
 * Check if the pipeline has exceeded its retry budget.
 */
export function isPipelineEscalated(ctx: PipelineContext): boolean {
  return ctx.total_retries >= ctx.max_retries;
}

// ── Manifest Building ──────────────────────────────────────

/**
 * Build a dispatch manifest for the current pipeline stage.
 *
 * The manifest is the contract between the orchestrator CLI and the parent
 * Claude session. It tells the parent session:
 *   - Which story to dispatch
 *   - Which agent role to use (encoded in the prompt)
 *   - What files the agent can modify (scope_write)
 *   - What commands the agent must run (acceptance_check)
 *   - What feedback to include (from prior stage failures)
 *   - What permissions to inject
 */
export function buildPipelineManifest(
  story: StoryEntry,
  stage: PipelineStage,
  pipeline: PipelineContext,
  worktreePath?: string,
  feedback?: string,
  previousOutput?: PipelineDispatchManifest['previous_output'],
): PipelineDispatchManifest {
  const role = stageToRole(story.track, stage);

  const prompt = buildDispatchPrompt(story, stage, pipeline, feedback, previousOutput);

  return {
    type: 'pipeline_dispatch',
    story_id: story.story_id,
    title: story.title,
    track: story.track,
    stage,
    attempt: pipeline.attempt,
    max_retries: pipeline.max_retries,
    scope_write: story.scope_write,
    acceptance_check: story.acceptance_check,
    worktree_path: worktreePath,
    feedback,
    prompt,
    previous_output: previousOutput,
    permissions: inferPermissions(story, stage),
  };
}

/**
 * Write a dispatch manifest to disk.
 * Returns the path it was written to.
 */
export function writePipelineManifest(
  manifest: PipelineDispatchManifest,
  outputDir: string,
): string {
  const dir = join(outputDir, '.dispatch', 'pipeline', manifest.story_id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${manifest.stage}.json`);
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return path;
}

// ── Report Readers ─────────────────────────────────────────

/**
 * Read a review report for a story. Returns null if not found or invalid.
 */
export function readReviewReport(storyId: string, reportDir: string): any | null {
  return readReportJson(join(reportDir, 'review', `${storyId}-review.json`));
}

/**
 * Read a test report for a story. Returns null if not found or invalid.
 */
export function readTestReport(storyId: string, reportDir: string): any | null {
  return readReportJson(join(reportDir, 'test-reports', `${storyId}-test.json`));
}

/**
 * Read a QA report for a story. Returns null if not found or invalid.
 */
export function readQaReport(storyId: string, reportDir: string): any | null {
  return readReportJson(join(reportDir, 'qa', `${storyId}-qa.json`));
}

/**
 * Write an escalation manifest and return it.
 */
export function writeEscalationManifest(
  story: StoryEntry,
  stage: PipelineStage,
  reason: string,
  outputDir: string,
): PipelineEscalation {
  const dir = join(outputDir, '.dispatch', 'pipeline', story.story_id);
  mkdirSync(dir, { recursive: true });

  const escalation: PipelineEscalation = {
    type: 'pipeline_escalation',
    story_id: story.story_id,
    title: story.title,
    track: story.track,
    failed_stage: stage,
    total_attempts: 0, // caller should set from pipeline context
    reason,
    recommendation: `Story "${story.story_id}" failed at stage "${stage}" after exhausting retry budget. Review the failure reports and either fix manually or skip.`,
    manifest_path: join(dir, 'ESCALATED.json'),
    created_at: new Date().toISOString(),
  };

  writeFileSync(escalation.manifest_path, JSON.stringify(escalation, null, 2));
  return escalation;
}

// ── Internal Helpers ───────────────────────────────────────

function readReportJson(path: string): any | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function stageToRole(track: string, stage: PipelineStage): string {
  switch (stage) {
    case 'dev':
      return track === 'frontend' ? 'frontend-developer' : 'backend-developer';
    case 'review':
      return 'code-reviewer';
    case 'testing':
      return 'code-reviewer'; // testing stage uses code-reviewer with testing focus
    case 'qa':
      return 'qa-verifier';
    default:
      return 'backend-developer';
  }
}

function buildDispatchPrompt(
  story: StoryEntry,
  stage: PipelineStage,
  pipeline: PipelineContext,
  feedback?: string,
  previousOutput?: PipelineDispatchManifest['previous_output'],
): string {
  const role = stageToRole(story.track, stage);
  const lines: string[] = [];

  lines.push(`# Pipeline Dispatch: ${story.story_id} — ${stage}`);
  lines.push('');
  lines.push(`**Role:** ${role}`);
  lines.push(`**Track:** ${story.track}`);
  lines.push(`**Stage:** ${stage} (attempt ${pipeline.attempt}/${pipeline.max_retries})`);
  lines.push(`**Total retries:** ${pipeline.total_retries}`);
  lines.push('');

  if (feedback) {
    lines.push('## Feedback from Prior Stage');
    lines.push('');
    lines.push(feedback);
    lines.push('');
  }

  lines.push('## Scope (scope_write)');
  lines.push('');
  for (const f of story.scope_write) {
    lines.push(`- \`${f}\``);
  }
  lines.push('');

  lines.push('## Acceptance Checks');
  lines.push('');
  for (const cmd of story.acceptance_check) {
    lines.push(`\`\`\`bash\n${cmd}\n\`\`\``);
  }
  lines.push('');

  if (previousOutput) {
    lines.push('## Previous Output');
    lines.push('');
    if (previousOutput.review_notes) lines.push(`- Review notes: ${previousOutput.review_notes}`);
    if (previousOutput.test_files) lines.push(`- Test files: ${previousOutput.test_files.join(', ')}`);
    if (previousOutput.qa_report) lines.push(`- QA report: ${previousOutput.qa_report}`);
    if (previousOutput.code_files) lines.push(`- Code files: ${previousOutput.code_files.join(', ')}`);
    lines.push('');
  }

  lines.push('## Instructions');
  lines.push('');

  switch (stage) {
    case 'dev':
      lines.push(`Implement the story "${story.story_id}: ${story.title}".`);
      lines.push('Follow TDD: write tests first, then implementation.');
      lines.push('All acceptance checks must pass.');
      if (feedback) {
        lines.push('');
        lines.push('**This is a fix iteration.** Address the feedback above before proceeding.');
      }
      break;
    case 'review':
      lines.push(`Perform an adversarial code review for "${story.story_id}: ${story.title}".`);
      lines.push('Check: correctness, security, error handling, code standards compliance.');
      lines.push('Write a review report to `_wdf_output/review/<story_id>-review.json`.');
      break;
    case 'testing':
      lines.push(`Verify test coverage for "${story.story_id}: ${story.title}".`);
      lines.push('Run all tests and verify coverage >= 80%.');
      lines.push('Write a test report to `_wdf_output/test-reports/<story_id>-test.json`.');
      break;
    case 'qa':
      lines.push(`QA acceptance for "${story.story_id}: ${story.title}".`);
      lines.push('Verify all acceptance criteria pass. Check end-to-end behavior.');
      lines.push('Write a QA report to `_wdf_output/qa/<story_id>-qa.json`.');
      break;
  }

  return lines.join('\n');
}

function inferPermissions(
  story: StoryEntry,
  stage: PipelineStage,
): PipelineDispatchManifest['permissions'] {
  const bash_allow: string[] = [];
  const bash_deny: string[] = ['git push', 'rm -rf', 'docker push'];

  // Derive bash permissions from acceptance_check
  for (const cmd of story.acceptance_check) {
    const prefix = cmd.split(/\s+/)[0];
    if (prefix) {
      bash_allow.push(`${prefix}`);
    }
  }

  // Stage-specific widening
  switch (stage) {
    case 'dev':
      bash_allow.push('npx tsc', 'npx vitest', 'npm test', 'npm run');
      break;
    case 'review':
      bash_allow.push('npx tsc', 'npx eslint');
      break;
    case 'testing':
      bash_allow.push('npx vitest', 'npm test', 'npx c8');
      break;
    case 'qa':
      bash_allow.push('npm test', 'npx playwright');
      break;
  }

  return {
    bash_allow: [...new Set(bash_allow)],
    bash_deny,
    scope_read: ['_wdf_output/**'],
  };
}
