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
import { load as yamlLoad } from 'js-yaml';
import type {
  StoryEntry,
  PipelineStage,
  PipelineContext,
  PipelineDispatchManifest,
  PipelineEscalation,
} from './types.js';
import { PIPELINE_STAGES, MAX_PIPELINE_RETRIES } from './types.js';
import { appendAudit } from './audit-logger.js';

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
  projectRoot?: string,
): PipelineDispatchManifest {
  const role = stageToRole(story.track, stage);

  // Load project constitution rules for injection into the dispatch prompt
  const constitutionRules = projectRoot
    ? loadConstitutionRules(projectRoot, story.track, stage)
    : [];

  const prompt = buildDispatchPrompt(story, stage, pipeline, feedback, previousOutput, constitutionRules);

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
    constitution_rules: constitutionRules.length > 0 ? constitutionRules : undefined,
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
 *
 * The manifest doubles as the audit source: callers MUST pass the live
 * `totalAttempts` and `projectRoot` so the JSON on disk and the audit log
 * entry stay consistent. The previous signature left `total_attempts: 0`
 * hardcoded — that bug made every escalation look like a first attempt.
 *
 * `failedStages` accumulates across the pipeline life (dev/review/testing/qa
 * where retries burned) so a human reviewer can see at a glance which stages
 * were problematic. `escalated_at` is the hold-time baseline used by
 * `dispatch-loop-engine` to auto-promote stale escalations to FAIL.
 */
export function writeEscalationManifest(
  story: StoryEntry,
  stage: PipelineStage,
  reason: string,
  outputDir: string,
  options: {
    totalAttempts: number;
    projectRoot: string;
    failedStages?: PipelineStage[];
    lastFeedback?: string;
  },
): PipelineEscalation {
  const dir = join(outputDir, '.dispatch', 'pipeline', story.story_id);
  mkdirSync(dir, { recursive: true });

  const escalatedAt = new Date().toISOString();
  const failedStages = options.failedStages && options.failedStages.length > 0
    ? options.failedStages
    : [stage];

  const escalation: PipelineEscalation = {
    type: 'pipeline_escalation',
    story_id: story.story_id,
    title: story.title,
    track: story.track,
    failed_stage: stage,
    failed_stages: failedStages,
    total_attempts: options.totalAttempts,
    reason,
    recommendation: `Story "${story.story_id}" failed at stage "${stage}" after exhausting retry budget (${options.totalAttempts} attempts). Review the failure reports and either fix manually, run \`wdf escalate --resolve\`, or accept failure with \`wdf escalate --reject\`.`,
    manifest_path: join(dir, 'ESCALATED.json'),
    escalated_at: escalatedAt,
    last_feedback: options.lastFeedback,
    created_at: escalatedAt, // legacy alias — back-compat for old readers
  };

  writeFileSync(escalation.manifest_path, JSON.stringify(escalation, null, 2));

  // Audit: pipeline_escalation fires the moment the manifest is written.
  // Without this, escalation was invisible — pipeline 三件套 had 0 audit calls.
  appendAudit(options.projectRoot, 'pipeline_escalation', {
    story_id: story.story_id,
    status: 'fail',
    message: `Pipeline escalated at stage "${stage}" after ${options.totalAttempts} attempts: ${reason}`,
    details: {
      failed_stage: stage,
      failed_stages: failedStages,
      total_attempts: options.totalAttempts,
      escalated_at: escalatedAt,
      manifest_path: escalation.manifest_path,
      track: story.track,
    },
  });

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
  constitutionRules: string[] = [],
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

  // Inject constitution rules before scope so they are always visible
  if (constitutionRules.length > 0) {
    lines.push('## Project Constitution (non-negotiable)');
    lines.push('');
    lines.push('These rules MUST be followed. Violations will fail review and QA.');
    lines.push('');
    for (const rule of constitutionRules) {
      lines.push(`- ${rule}`);
    }
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

/**
 * Load constitution rules from the project's constitution.yaml file.
 *
 * Searches in:
 *   1. <projectRoot>/_wdf_output/constitution.yaml
 *   2. <projectRoot>/constitution.yaml
 *
 * Returns an array of human-readable rule strings, filtered by track and stage.
 * For dev stage: includes general rules + track-specific rules.
 * For review/testing/qa: includes quality gates and testing requirements.
 */
function loadConstitutionRules(
  projectRoot: string,
  track: string,
  stage: PipelineStage,
): string[] {
  const rules: string[] = [];

  // Try to find constitution.yaml
  let constitutionPath = join(projectRoot, '_wdf_output', 'constitution.yaml');
  if (!existsSync(constitutionPath)) {
    constitutionPath = join(projectRoot, 'constitution.yaml');
    if (!existsSync(constitutionPath)) {
      return rules; // No constitution found
    }
  }

  try {
    const content = readFileSync(constitutionPath, 'utf-8');
    const constitution = yamlLoad(content) as any;

    if (!constitution) return rules;

    // Extract quality gates
    if (constitution.quality_gates) {
      const qg = constitution.quality_gates;

      if (qg.test_coverage) {
        const backendMin = qg.test_coverage.backend_min_pct;
        const frontendMin = qg.test_coverage.frontend_min_pct;
        if (backendMin || frontendMin) {
          rules.push(`Test coverage: backend >= ${backendMin ?? 'N/A'}%, frontend >= ${frontendMin ?? 'N/A'}%`);
        }
      }

      if (qg.type_safety?.strict_mode) {
        rules.push('TypeScript strict mode required (no implicit any)');
      }

      if (qg.security?.input_validation_all_endpoints) {
        rules.push('All endpoints must have input validation (Zod/Joi/class-validator)');
      }

      if (qg.security?.no_shell_injection) {
        rules.push('No shell injection vulnerabilities — use parameterized queries');
      }
    }

    // Extract coding standards
    if (constitution.coding_standards?.rules) {
      for (const rule of constitution.coding_standards.rules) {
        rules.push(rule);
      }
    }

    // Add track-specific rules
    if (constitution.coding_standards) {
      const cs = constitution.coding_standards;

      if (track === 'frontend' && cs.frontend_rules) {
        for (const rule of cs.frontend_rules) {
          rules.push(`[frontend] ${rule}`);
        }
      }

      if (track === 'backend' && cs.backend_rules) {
        for (const rule of cs.backend_rules) {
          rules.push(`[backend] ${rule}`);
        }
      }

      if (cs.database_rules && (track === 'backend' || track === 'full-stack')) {
        for (const rule of cs.database_rules) {
          rules.push(`[database] ${rule}`);
        }
      }

      if (cs.auth_rules && (track === 'backend' || track === 'full-stack')) {
        for (const rule of cs.auth_rules) {
          rules.push(`[auth] ${rule}`);
        }
      }
    }

    // Add testing requirements for dev stage
    if (stage === 'dev' && constitution.testing_requirements) {
      const tr = constitution.testing_requirements;
      if (tr.unit?.required) {
        rules.push(`Unit tests required: minimum ${tr.unit.per_story_min ?? 1} per story`);
      }
      if (tr.integration?.required) {
        rules.push(`Integration tests required: minimum ${tr.integration.per_api_endpoint_min ?? 1} per endpoint`);
      }
    }

  } catch (err) {
    // Constitution load failure is non-fatal — just skip injection
    console.warn(`[pipeline-engine] Failed to load constitution: ${err}`);
  }

  return rules;
}
