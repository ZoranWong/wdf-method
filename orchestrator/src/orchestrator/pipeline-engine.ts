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
  Track,
  ExecutionUnit,
  PipelineStage,
  PipelineContext,
  PipelineDispatchManifest,
  PipelineEscalation,
} from './types.js';
import { PIPELINE_STAGES, MAX_PIPELINE_RETRIES } from './types.js';
import { appendAudit } from './audit-logger.js';
import { distillContext, renderDistilledContext } from './context-distiller.js';

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
  unitId?: string,
): PipelineDispatchManifest {
  const role = stageToRole(story.track, stage);

  // Load project constitution rules for injection into the dispatch prompt
  const constitutionRules = projectRoot
    ? loadConstitutionRules(projectRoot, story.track, stage)
    : [];

  // When unitId is provided AND the story declares execution_units, scope
  // the manifest to that unit. Falls through to story-level scoping when
  // the unit is unknown or the story has no units (legacy format).
  const activeUnit = unitId && story.execution_units ? story.execution_units[unitId] : undefined;
  const effectiveScope = activeUnit ? activeUnit.scope_write : story.scope_write;
  const effectiveAcceptance = activeUnit ? activeUnit.acceptance_check : story.acceptance_check;

  const unitContext = activeUnit && unitId ? { unitId, unit: activeUnit } : undefined;

  // Graph-driven distillation: pre-compute the spec slice this story touches
  // so the agent doesn't have to read all of _wdf_output/. Best-effort — a
  // missing graph or story node yields an empty block that is simply omitted.
  let distilledMarkdown = '';
  if (projectRoot) {
    try {
      distilledMarkdown = renderDistilledContext(
        distillContext(story.story_id, projectRoot),
      );
    } catch {
      distilledMarkdown = '';
    }
  }

  const prompt = buildDispatchPrompt(
    story,
    stage,
    pipeline,
    feedback,
    previousOutput,
    constitutionRules,
    unitContext,
    distilledMarkdown,
  );

  return {
    type: 'pipeline_dispatch',
    story_id: story.story_id,
    title: story.title,
    track: story.track,
    stage,
    attempt: pipeline.attempt,
    max_retries: pipeline.max_retries,
    scope_write: effectiveScope,
    acceptance_check: effectiveAcceptance,
    worktree_path: worktreePath,
    feedback,
    prompt,
    previous_output: previousOutput,
    permissions: inferPermissions({ ...story, scope_write: effectiveScope, acceptance_check: effectiveAcceptance }, stage),
    constitution_rules: constitutionRules.length > 0 ? constitutionRules : undefined,
  };
}

/**
 * Phase C (V3.10.3): build a manifest for a downstream stage (review /
 * testing / qa) with auto-injected upstream artifacts.
 *
 * When `auto_dispatch = true` in customize.toml, the loop engine calls
 * this instead of the plain buildPipelineManifest so that:
 *
 *   - review stage:   the prompt auto-includes the dev agent's files_changed
 *                     list as the review scope, plus the dev dispatch
 *                     manifest path for diff lookup.
 *   - testing stage:  the prompt auto-includes the acceptance_check list
 *                     as a numbered "must-run" set.
 *   - qa stage:       the prompt auto-includes all prior reports
 *                     (review-report.json, test-report.json) as re-run
 *                     context.
 *
 * Returns the manifest with previous_output enriched. Pure function —
 * no I/O. Caller is responsible for actually writing the manifest.
 */
export function buildAutoDispatchManifest(
  story: StoryEntry,
  stage: PipelineStage,
  pipeline: PipelineContext,
  opts: {
    worktreePath?: string;
    feedback?: string;
    previousOutput?: PipelineDispatchManifest['previous_output'];
    projectRoot?: string;
    unitId?: string;
    /**
     * Path to the prior stage's dispatch manifest (e.g. the dev manifest
     * when building a review manifest). Used to populate the review scope.
     */
    priorManifestPath?: string;
    /**
     * List of files the prior dev stage modified. Surfaced as review scope.
     */
    devFilesChanged?: string[];
    /**
     * Path to review/test reports — forwarded to qa as re-run context.
     */
    reviewReportPath?: string;
    testReportPath?: string;
  } = {},
): PipelineDispatchManifest {
  const enrichedPrevious: NonNullable<PipelineDispatchManifest['previous_output']> = {
    ...(opts.previousOutput ?? {}),
  };

  if (stage === 'review' && opts.devFilesChanged && opts.devFilesChanged.length > 0) {
    enrichedPrevious.code_files = opts.devFilesChanged;
  }
  if (stage === 'testing') {
    // acceptance_check is already on the manifest; surface it explicitly
    // in previous_output so the testing-focused reviewer sees a numbered
    // checklist without re-parsing the story frontmatter.
    enrichedPrevious.code_files = opts.devFilesChanged ?? enrichedPrevious.code_files;
  }
  if (stage === 'qa') {
    if (opts.reviewReportPath) enrichedPrevious.review_notes = opts.reviewReportPath;
    if (opts.testReportPath) enrichedPrevious.test_files = [opts.testReportPath];
  }

  return buildPipelineManifest(
    story,
    stage,
    pipeline,
    opts.worktreePath,
    opts.feedback,
    Object.keys(enrichedPrevious).length > 0 ? enrichedPrevious : undefined,
    opts.projectRoot,
    opts.unitId,
  );
}

/**
 * Write a dispatch manifest to disk.
 * Returns the path it was written to.
 *
 * When `frameworkRoot` is provided AND the manifest is for the dev stage,
 * starter handoff.md/self-check.md files are also written to
 * `_wdf_output/handoff/{story_id}/`. The dev agent fills these in; the
 * pipeline validates required sections before advancing dev→review.
 * Idempotent — existing files are preserved.
 */
export function writePipelineManifest(
  manifest: PipelineDispatchManifest,
  outputDir: string,
  frameworkRoot?: string,
): string {
  const dir = join(outputDir, '.dispatch', 'pipeline', manifest.story_id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${manifest.stage}.json`);
  writeFileSync(path, JSON.stringify(manifest, null, 2));

  if (frameworkRoot && manifest.stage === 'dev') {
    writeStarterHandoffForManifest(manifest, outputDir, frameworkRoot);
  }

  return path;
}

/**
 * Lazy import + call to writeStarterHandoffFiles. Kept in a separate
 * function to avoid a circular import (handoff-writer imports types,
 * pipeline-engine imports types — keeping the dep one-directional).
 */
function writeStarterHandoffForManifest(
  manifest: PipelineDispatchManifest,
  outputDir: string,
  frameworkRoot: string,
): void {
  try {
    // Inline require to avoid circular import at module load time.
    const { writeStarterHandoffFiles } = require('./handoff-writer.js') as typeof import('./handoff-writer.js');
    const story: StoryEntry = {
      story_id: manifest.story_id,
      title: manifest.title,
      track: manifest.track as Track,
      order: 0,
      scope_write: manifest.scope_write,
      acceptance_check: manifest.acceptance_check,
      code_standards_source: [],
    };
    writeStarterHandoffFiles(story, outputDir, frameworkRoot);
  } catch {
    // Non-fatal — handoff files are a convenience, not a correctness gate.
    // Pipeline still works if templates are missing.
  }
}

// ── Report Readers ─────────────────────────────────────────

/**
 * Path of a story's review report on disk. Single source of truth shared by
 * the readers below and by verdict-verifier (which rewrites the file).
 */
export function reviewReportPath(storyId: string, reportDir: string): string {
  return join(reportDir, 'review', `${storyId}-review.json`);
}

/** Path of a story's test report on disk. */
export function testReportPath(storyId: string, reportDir: string): string {
  return join(reportDir, 'test-reports', `${storyId}-test.json`);
}

/** Path of a story's QA report on disk. */
export function qaReportPath(storyId: string, reportDir: string): string {
  return join(reportDir, 'qa', `${storyId}-qa.json`);
}

/**
 * Read a review report for a story. Returns null if not found or invalid.
 */
export function readReviewReport(storyId: string, reportDir: string): any | null {
  return readReportJson(reviewReportPath(storyId, reportDir));
}

/**
 * Read a test report for a story. Returns null if not found or invalid.
 */
export function readTestReport(storyId: string, reportDir: string): any | null {
  return readReportJson(testReportPath(storyId, reportDir));
}

/**
 * Read a QA report for a story. Returns null if not found or invalid.
 */
export function readQaReport(storyId: string, reportDir: string): any | null {
  return readReportJson(qaReportPath(storyId, reportDir));
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

/**
 * Select the next execution unit to dispatch for a Story Pack v1.0 story.
 *
 * Strategy: return the first unit (by insertion order) whose code_acceptance
 * has not yet passed. When every unit has passed, return null — the story
 * is ready for story-level review/testing/QA.
 *
 * For stories WITHOUT execution_units (legacy format), returns null
 * unconditionally — the caller should fall back to story-level dispatch.
 *
 * @param story         The story to inspect.
 * @param unitStatuses  Per-unit status map from StoryStatus.units. May be
 *                      undefined for stories that have never been dispatched.
 * @returns unitId of the next unit needing work, or null.
 */
export function selectActiveUnit(
  story: StoryEntry,
  unitStatuses?: Record<string, { status?: string; code_acceptance?: { review_passed?: boolean } }>,
): string | null {
  if (!story.execution_units) return null;
  const unitIds = Object.keys(story.execution_units);
  if (unitIds.length === 0) return null;

  for (const unitId of unitIds) {
    const status = unitStatuses?.[unitId];
    const codeAccepted = status?.code_acceptance?.review_passed === true
      || status?.status === 'CODE_ACCEPTED';
    if (!codeAccepted) {
      return unitId;
    }
  }
  return null;
}

function buildDispatchPrompt(
  story: StoryEntry,
  stage: PipelineStage,
  pipeline: PipelineContext,
  feedback?: string,
  previousOutput?: PipelineDispatchManifest['previous_output'],
  constitutionRules: string[] = [],
  unitContext?: { unitId: string; unit: ExecutionUnit },
  distilledMarkdown = '',
): string {
  const role = stageToRole(story.track, stage);
  const lines: string[] = [];

  lines.push(`# Pipeline Dispatch: ${story.story_id} — ${stage}`);
  lines.push('');
  lines.push(`**Role:** ${role}`);
  lines.push(`**Track:** ${story.track}`);
  lines.push(`**Stage:** ${stage} (attempt ${pipeline.attempt}/${pipeline.max_retries})`);
  lines.push(`**Total retries:** ${pipeline.total_retries}`);
  if (unitContext) {
    lines.push(`**Execution Unit:** \`${unitContext.unitId}\``);
  }
  lines.push('');

  if (unitContext) {
    lines.push(`## Execution Unit Focus — ${unitContext.unitId}`);
    lines.push('');
    lines.push(`This story uses Story Pack v1.0 with multiple execution units. You are dispatched for unit **${unitContext.unitId}** only.`);
    if (story.execution_units) {
      const allUnits = Object.keys(story.execution_units);
      if (allUnits.length > 1) {
        lines.push(`Other units in this story (handled by separate dispatches): ${allUnits.filter(u => u !== unitContext.unitId).join(', ')}`);
      }
    }
    lines.push('');
  }

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

  // Distilled spec slice (graph-driven) — placed before scope so the agent
  // reads the relevant requirements/endpoints/entities before touching files.
  if (distilledMarkdown) {
    lines.push(distilledMarkdown);
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
