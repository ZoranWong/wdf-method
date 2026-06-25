/**
 * Pipeline Runner — executes the per-story dev→review→testing→QA flow
 * by reading dispatch manifests and escalation notices, then providing
 * the instructions for the parent Claude session to dispatch via Agent tool.
 *
 * This file is the "operating manual" for the parent session. It reads the
 * filesystem state and tells the parent session what Agent tool calls to make.
 * The orchestrator CLI itself never spawns agents.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SprintStatusManager } from './sprint-status.js';
import {
  type StoryEntry,
  type PipelineStage,
  type PipelineContext,
  type PipelineDispatchManifest,
  type PipelineEscalation,
  MAX_PIPELINE_RETRIES,
} from './types.js';
import {
  buildPipelineManifest,
  writePipelineManifest,
  readReviewReport,
  readTestReport,
  readQaReport,
  writeEscalationManifest,
  initPipelineContext,
  advancePipeline,
  isPipelineEscalated,
  selectActiveUnit,
} from './pipeline-engine.js';
import { l2WorktreeRollback } from './error-handling.js';
import { evaluatePhase4ExitGate, formatPhase4ExitGate } from './phase4-exit-gate.js';
import { appendAudit } from './audit-logger.js';

// Re-export for downstream callers
export { initPipelineContext };

export interface PipelineAction {
  kind: 'dispatch' | 'escalation' | 'skip' | 'complete';
  story_id: string;
  manifest?: PipelineDispatchManifest;
  manifest_path?: string;
  escalation?: PipelineEscalation;
  reason?: string;
}

/**
 * Process ONE story through the pipeline. This is called by the parent
 * session's Agent tool dispatch loop.
 *
 * Returns the action the parent session should take: dispatch a new agent,
 * escalate to human review, skip (already done), or mark complete.
 */
export function processStoryPipeline(
  story: StoryEntry,
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
  frameworkRoot?: string,
): PipelineAction {
  const subKey = story.track === 'frontend' ? 'phase_4_10' :
                 story.track === 'backend' ? 'phase_4_4' : 'phase_4_4';

  // Check if already merged
  const existingStories = state.getStories(4, subKey);
  const existing = existingStories.find(s => s.id === story.story_id);
  if (existing?.status === 'MERGED') {
    return { kind: 'skip', story_id: story.story_id, reason: 'already merged' };
  }

  // FAIL is terminal — never auto-recover. Return skip so the dispatch loop
  // ignores this story until the user runs `wdf reset --force`.
  if (existing?.status === 'FAIL') {
    return {
      kind: 'skip',
      story_id: story.story_id,
      reason: 'story is in FAIL state — run `wdf reset --force --story=' + story.story_id + '` to recover',
    };
  }

  // Check if escalated
  if (existing?.status === 'PIPELINE_ESCALATED') {
    const escPath = join(outputDir, '.dispatch', 'pipeline', story.story_id, 'ESCALATED.json');
    if (existsSync(escPath)) {
      const escalation = JSON.parse(readFileSync(escPath, 'utf-8')) as PipelineEscalation;
      return { kind: 'escalation', story_id: story.story_id, escalation };
    }
  }

  // Get or init pipeline context
  let pipeline: PipelineContext = existing?.pipeline
    ? { ...existing.pipeline }
    : initPipelineContext();

  // Check if already escalated by budget
  if (isPipelineEscalated(pipeline)) {
    const escalation = writeEscalationManifest(
      story, pipeline.stage,
      `Exceeded ${pipeline.max_retries} total retries at stage "${pipeline.stage}". Last failure: ${pipeline.last_failure?.error ?? 'unknown'}`,
      outputDir,
      {
        totalAttempts: pipeline.total_retries,
        projectRoot,
        lastFeedback: pipeline.feedback,
      },
    );
    // L2: clear the worktree so the human reviewer starts from a clean state.
    // Non-fatal — rollback failure must not block the escalation manifest
    // (the human can always clean up manually). The snapshot created inside
    // l2WorktreeRollback preserves the failed work for inspection.
    try {
      const worktreePath = join(projectRoot, '.wdf-story-workspaces', story.story_id);
      l2WorktreeRollback(
        story.story_id,
        story.scope_write,
        existsSync(worktreePath) ? worktreePath : undefined,
        { projectRoot, dryRun: false },
      );
    } catch {
      // Swallow — L2 already wrote its own audit on failure
    }
    state.updateStoryStatus(4, subKey, {
      ...existing ?? { id: story.story_id, status: 'PIPELINE_ESCALATED' },
      status: 'PIPELINE_ESCALATED',
      pipeline,
    });
    return { kind: 'escalation', story_id: story.story_id, escalation };
  }

  // Determine what to do based on current stage.
  // Loop because advancing one stage may reveal a report for the next
  // stage (e.g. dev→review + existing review PASS → advance to testing
  // in a single invocation). We stop when the stage stops changing OR
  // when we hit a FAIL (which resets to dev and needs a new agent dispatch).
  const reportDir = join(outputDir);
  let prevStage: PipelineStage | null = null;
  let handled = false;
  while (pipeline.stage !== prevStage && !handled) {
    prevStage = pipeline.stage;
    const stage: PipelineStage = pipeline.stage;

    // Check gate reports from previous stage
    switch (stage) {
      case 'review': {
        const review = readReviewReport(story.story_id, reportDir);
        if (review) {
          if (review.verdict === 'PASS') {
            pipeline = advancePipeline(pipeline, true);
          } else {
            pipeline = advancePipeline(pipeline, false);
            pipeline.last_failure = { stage: 'review', error: review.issues?.map((i: any) => i.message).join('; ') ?? 'review failed', at: new Date().toISOString() };
            pipeline.feedback = formatReviewFeedback(review);
            pipeline.stage = 'dev'; // fix loop: back to dev on failure
            handled = true; // stop loop — need new dispatch
          }
        } else {
          handled = true; // no report yet — keep at review, need dispatch
        }
        break;
      }
      case 'testing': {
        const test = readTestReport(story.story_id, reportDir);
        if (test) {
          if (test.verdict === 'PASS') {
            pipeline = advancePipeline(pipeline, true);
          } else {
            pipeline = advancePipeline(pipeline, false);
            pipeline.last_failure = { stage: 'testing', error: `${test.failed ?? 0} test(s) failed`, at: new Date().toISOString() };
            pipeline.feedback = formatTestFeedback(test);
            pipeline.stage = 'dev'; // fix loop: back to dev on failure
            handled = true; // stop loop — need new dispatch
          }
        } else {
          handled = true; // no report yet — keep at testing, need dispatch
        }
        break;
      }
      case 'qa': {
        const qa = readQaReport(story.story_id, reportDir);
        if (qa) {
          if (qa.verdict === 'PASS') {
            // Phase 4 EXIT gate — the test side of the traceability chain
            // (AC→TEST) is enforced HERE, not at entry. A story can pass QA
            // and still have ACs with no bound test or unspec'd routes; that
            // must not silently reach MERGED. Treat it as testing-stage
            // incomplete and bounce back through the normal failure loop so
            // the agent adds the missing tests (reusing the retry/escalation
            // budget guards against an infinite loop).
            const exit = evaluatePhase4ExitGate(projectRoot, { storyId: story.story_id });
            if (exit.enabled && !exit.ok) {
              pipeline = advancePipeline(pipeline, false);
              pipeline.last_failure = {
                stage: 'qa',
                error: `Phase 4 exit gate blocked — ${exit.gaps.length} test/drift gap(s)`,
                at: new Date().toISOString(),
              };
              pipeline.feedback = formatPhase4ExitGate(exit);
              pipeline.stage = 'testing'; // bounce to testing to author missing tests
              appendAudit(projectRoot, 'phase4_exit_blocked', {
                actor: 'system',
                story_id: story.story_id,
                status: 'fail',
                message: `QA passed but exit gate blocked merge — ${exit.gaps.length} gap(s)`,
                details: {
                  gaps: exit.gaps.length,
                  test_binding: exit.totals.test_binding,
                  traceability: exit.totals.traceability,
                  drift: exit.totals.drift,
                },
              });
              handled = true; // stop loop — need new dispatch to add tests
              break;
            }
            pipeline = advancePipeline(pipeline, true);
            // Pipeline complete! Mark as MERGED
            state.updateStoryStatus(4, subKey, {
              ...existing ?? { id: story.story_id, status: 'MERGED' },
              status: 'MERGED',
              pipeline,
              bmad_story_state: 'done',
              completed_at: new Date().toISOString(),
            });
            return { kind: 'complete', story_id: story.story_id, reason: 'all pipeline stages passed' };
          } else {
            pipeline = advancePipeline(pipeline, false);
            pipeline.last_failure = { stage: 'qa', error: qa.summary ?? 'QA failed', at: new Date().toISOString() };
            pipeline.feedback = formatQaFeedback(qa);
            pipeline.stage = 'dev'; // fix loop: back to dev on failure
            handled = true; // stop loop — need new dispatch
          }
        } else {
          handled = true; // no report yet — keep at qa, need dispatch
        }
        break;
      }
      case 'dev': {
        // Dev stage never auto-advances. The pipeline only moves dev→review
        // via postDispatchNext() after the dev agent actually completes.
        // Auto-advancing here would skip the dev dispatch entirely on the
        // next loop call (the original bug).
        //
        // The fix-iteration case (existing.stage !== 'dev') is already handled
        // upstream: review/testing/qa FAIL branches above set stage='dev' and
        // handled=true, exiting this loop before we reach here. So by the time
        // we reach this case with existing.stage !== 'dev', the upstream FAIL
        // branch didn't fire — which means we should just dispatch dev.
        if (existing?.pipeline?.stage && existing.pipeline.stage !== 'dev') {
          pipeline.stage = 'dev';
          pipeline.attempt += 1;
        }
        handled = true; // always stop here — dev needs a real dispatch
        break;
      }
    }
  }

  // Save updated pipeline state
  state.updateStoryStatus(4, subKey, {
    ...existing ?? { id: story.story_id, status: 'IN_PROGRESS' },
    status: pipeline.stage === 'dev' ? 'IN_PROGRESS' : 'IN_REVIEW',
    pipeline,
  });

  // Build manifest for current stage
  const worktreePath = join(projectRoot, '.wdf-story-workspaces', story.story_id);
  const previousOutput = collectPreviousOutput(story.story_id, pipeline.stage, projectRoot);

  // Story Pack v1.0: when a story declares execution_units, scope the
  // dispatch to the first unit that still needs work. This produces
  // tighter prompts, smaller scope_write windows, and lets large stories
  // progress unit-by-unit rather than as one monolithic dispatch.
  const activeUnitId = selectActiveUnit(story, existing?.units);

  const manifest = buildPipelineManifest(
    story,
    pipeline.stage,
    pipeline,
    existsSync(worktreePath) ? worktreePath : undefined,
    pipeline.feedback,
    previousOutput,
    projectRoot,
    activeUnitId ?? undefined,
  );

  const manifestPath = writePipelineManifest(manifest, outputDir, frameworkRoot);

  return {
    kind: 'dispatch',
    story_id: story.story_id,
    manifest,
    manifest_path: manifestPath,
  };
}

/**
 * Build the `previous_output` payload for the current pipeline stage by
 * reading the on-disk artifacts of prior stages.
 *
 * Stage-specific conventions:
 *   - dev (first attempt): nothing to forward.
 *   - dev (fix loop after review/testing/qa FAIL): forward the failure
 *     report so the dev agent has structured context for what to fix.
 *   - review: forward `code_files` (== story.scope_write) so the reviewer
 *     knows what to look at without re-reading the story.
 *   - testing: forward `code_files` + `review_notes`.
 *   - qa: forward `code_files` + `review_notes` + `test_files`.
 *
 * Missing files are silently skipped — the parent session still gets a
 * partial pointer list rather than failing the whole dispatch.
 */
function collectPreviousOutput(
  storyId: string,
  stage: PipelineStage,
  projectRoot: string,
): PipelineDispatchManifest['previous_output'] {
  const out: NonNullable<PipelineDispatchManifest['previous_output']> = {};
  const resolveStory = (entry?: { story_id?: string } | null): entry is { story_id: string } =>
    !!entry && entry.story_id === storyId;

  // code_files: scope_write is already on the manifest, but reviewers/testers
  // benefit from an explicit pointer list. We populate it for any stage that
  // runs AFTER dev (i.e. not the first dev attempt).
  if (stage !== 'dev') {
    // scope_write is on the manifest itself; we surface code_files only when
    // there is something extra to add. Keep this slot reserved for an
    // explicit file list read from a dev artifact if/when one exists.
  }

  // review_notes: forward when past review stage.
  if (stage === 'testing' || stage === 'qa') {
    const reviewPath = join(projectRoot, '_wdf_output', 'review', `${storyId}-review.json`);
    if (existsSync(reviewPath)) {
      try {
        const parsed = JSON.parse(readFileSync(reviewPath, 'utf-8'));
        if (resolveStory(parsed)) {
          out.review_notes = reviewPath;
        }
      } catch { /* corrupt review file — skip */ }
    }
  }

  // test_files: forward to QA so the QA agent can re-run failing tests.
  if (stage === 'qa') {
    const testReportPath = join(projectRoot, '_wdf_output', 'test-reports', `${storyId}-test.json`);
    if (existsSync(testReportPath)) {
      try {
        const parsed = JSON.parse(readFileSync(testReportPath, 'utf-8'));
        if (resolveStory(parsed)) {
          out.test_files = [testReportPath];
        }
      } catch { /* corrupt — skip */ }
    }
  }

  // dev fix loop: surface the failure report that triggered the re-dispatch.
  // The pipeline.feedback string already carries a human-readable summary,
  // but pointing at the structured JSON helps the agent program against it.
  if (stage === 'dev') {
    for (const dir of ['review', 'test-reports', 'qa']) {
      const candidate = join(projectRoot, '_wdf_output', dir, `${storyId}-${dir === 'review' ? 'review' : dir === 'test-reports' ? 'test' : 'qa'}.json`);
      if (!existsSync(candidate)) continue;
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf-8'));
        if (resolveStory(parsed) && (parsed as { verdict?: string }).verdict === 'FAIL') {
          if (dir === 'review') out.review_notes = candidate;
          if (dir === 'test-reports') out.test_files = [candidate];
          if (dir === 'qa') out.qa_report = candidate;
        }
      } catch { /* skip */ }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Process ALL pending stories and return the actions the parent session
 * should take via Agent tool dispatch.
 */
export function processAllStoriesPipeline(
  stories: StoryEntry[],
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
): PipelineAction[] {
  const actions: PipelineAction[] = [];
  for (const story of stories) {
    const action = processStoryPipeline(story, state, outputDir, projectRoot);
    actions.push(action);
  }
  return actions;
}

/**
 * Get the next story that needs pipeline processing.
 * Used by wdf start to generate the prompt for the parent session.
 */
export function getNextPipelineStory(
  stories: StoryEntry[],
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
): PipelineAction | null {
  for (const story of stories) {
    const action = processStoryPipeline(story, state, outputDir, projectRoot);
    if (action.kind === 'dispatch' || action.kind === 'escalation') {
      return action;
    }
  }
  return null;
}

// ── Feedback formatters ──────────────────────────────────────

function formatReviewFeedback(review: any): string {
  if (!review?.issues || review.issues.length === 0) return 'Review failed — no specific issues reported';
  return [
    'CODE REVIEW FAILED. Fix the following issues:',
    ...review.issues.map((i: any, idx: number) => `  ${idx + 1}. [${i.severity ?? 'info'}] ${i.file ?? ''}: ${i.message ?? JSON.stringify(i)}`),
    `Overall score: ${review.score ?? 'N/A'}/10. Re-implement and re-run review.`,
  ].join('\n');
}

function formatTestFeedback(test: any): string {
  const failures = test?.failures ?? [];
  return [
    `TESTS FAILED: ${test.passed} passed, ${test.failed} failed.`,
    `Coverage: ${test.coverage ? JSON.stringify(test.coverage) : 'N/A'}.`,
    ...(failures.length > 0 ? ['Failure details:'] : []),
    ...failures.slice(0, 5).map((f: any, idx: number) => `  ${idx + 1}. ${f.test ?? f.command ?? JSON.stringify(f)}`),
    'Fix the failing tests and re-run. Target: all tests pass, coverage >= 80%.',
  ].join('\n');
}

function formatQaFeedback(qa: any): string {
  return [
    'QA ACCEPTANCE FAILED.',
    `Summary: ${qa.summary ?? 'No summary provided'}.`,
    qa.ac_checks ? `Acceptance checks: ${JSON.stringify(qa.ac_checks)}.` : '',
    'Fix the identified issues and re-submit. All AC must pass.',
  ].filter(Boolean).join('\n');
}
