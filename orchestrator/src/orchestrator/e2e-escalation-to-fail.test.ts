import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import YAML from 'js-yaml';
import { SprintStatusManager } from './sprint-status.js';
import { processStoryPipeline } from './pipeline-runner.js';
import { postDispatchNext, evaluateNextLoopAction } from './dispatch-loop-engine.js';
import { MAX_PIPELINE_RETRIES } from './types.js';
import type { StoryEntry, SprintStatus } from './types.js';

/**
 * Escalation → FAIL closed-loop E2E.
 *
 * Exercises the V3.9 failure-closure contract:
 *   1. Burn through MAX_PIPELINE_RETRIES review failures
 *   2. Verify PIPELINE_ESCALATED state + ESCALATED.json manifest + audit log
 *   3. Manually expire the escalation (rewrite escalated_at)
 *   4. Verify evaluateNextLoopAction auto-promotes to FAIL
 *   5. Verify the FAIL state is terminal (processStoryPipeline returns skip)
 *
 * This is the V3.9 plan's deferred P1 test (step 9).
 */
describe('Pipeline E2E — escalation to FAIL closed loop', () => {
  let projectRoot: string;
  let outputDir: string;
  let frameworkRoot: string;
  let state: SprintStatusManager;
  const subKey = 'phase_4_4';

  const story: StoryEntry = {
    track: 'backend',
    order: 1,
    story_id: 'S-E2E-FAIL',
    title: 'E2E escalation story',
    scope_write: ['backend/src/auth.ts'],
    acceptance_check: ['npm test'],
    code_standards_source: [],
  };

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'wdf-e2e-fail-'));
    outputDir = join(projectRoot, '_wdf_output');
    frameworkRoot = projectRoot; // tests don't need real framework root
    mkdirSync(join(outputDir, 'review'), { recursive: true });
    mkdirSync(join(outputDir, '.dispatch', 'pipeline', story.story_id), { recursive: true });

    const trackingPath = join(outputDir, 'sprint-status.yaml');
    const seed: SprintStatus = {
      project: 'e2e-fail',
      workflow_version: '3.9.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      global_state: {
        dev_mode: 'separated',
        task_triage_mode: 'parallel',
        code_standards_source: [],
        overall_status: 'in_progress',
        current_phase: 4,
      },
      phases: {
        phase_4: {
          status: 'IN_PROGRESS',
          substates: {
            [subKey]: {
              status: 'IN_PROGRESS',
              stories: [],
            },
          },
        },
      },
      change_requests: [],
    };
    writeFileSync(trackingPath, YAML.dump(seed));
    state = await SprintStatusManager.load(trackingPath);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('escalates after MAX_PIPELINE_RETRIES then FAILs after hold timeout', () => {
    // 1. Drive pipeline to review stage.
    processStoryPipeline(story, state, outputDir, projectRoot);
    postDispatchNext(state, outputDir, projectRoot, frameworkRoot, story.story_id, 'dev');

    // 2. Burn retry budget: each cycle writes review FAIL, calls
    //    processStoryPipeline (which increments total_retries and resets
    //    to dev), then postDispatchNext (which advances dev→review).
    //    Escalation fires when total_retries >= MAX_PIPELINE_RETRIES,
    //    detected at the *top* of the next processStoryPipeline call.
    let action: any;
    const safetyBound = MAX_PIPELINE_RETRIES * 2 + 4;
    for (let i = 0; i < safetyBound; i++) {
      writeReviewFail();
      action = processStoryPipeline(story, state, outputDir, projectRoot);
      if (action.kind === 'escalation') break;
      // Still in fix loop — simulate dev agent re-running then back to review.
      postDispatchNext(state, outputDir, projectRoot, frameworkRoot, story.story_id, 'dev');
    }

    // 3. Verify escalated.
    expect(action.kind).toBe('escalation');
    const escalated = state.getStories(4, subKey).find(s => s.id === story.story_id);
    expect(escalated?.status).toBe('PIPELINE_ESCALATED');

    const escPath = join(outputDir, '.dispatch', 'pipeline', story.story_id, 'ESCALATED.json');
    expect(existsSync(escPath)).toBe(true);
    const escManifest = JSON.parse(readFileSync(escPath, 'utf8'));
    expect(escManifest.total_attempts).toBeGreaterThan(0);
    expect(escManifest.escalated_at).toBeTruthy();

    // 4. Expire the escalation hold by rewriting escalated_at to 25h ago.
    const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    escManifest.escalated_at = expired;
    writeFileSync(escPath, JSON.stringify(escManifest));

    // 5. Run evaluateNextLoopAction — should sweep stale escalation to FAIL.
    evaluateNextLoopAction(state, outputDir, projectRoot, frameworkRoot);

    const failed = state.getStories(4, subKey).find(s => s.id === story.story_id);
    expect(failed?.status).toBe('FAIL');

    // 6. FAIL is terminal — processStoryPipeline must skip (not recover).
    const postFailAction = processStoryPipeline(story, state, outputDir, projectRoot);
    expect(postFailAction.kind).toBe('skip');
    expect(postFailAction.reason).toContain('FAIL');
  });

  it('does NOT promote a fresh escalation before hold timeout', () => {
    // Set up an escalated story directly.
    processStoryPipeline(story, state, outputDir, projectRoot);
    postDispatchNext(state, outputDir, projectRoot, frameworkRoot, story.story_id, 'dev');
    const safetyBound = MAX_PIPELINE_RETRIES * 2 + 4;
    for (let i = 0; i < safetyBound; i++) {
      writeReviewFail();
      const action = processStoryPipeline(story, state, outputDir, projectRoot);
      if (action.kind === 'escalation') break;
      postDispatchNext(state, outputDir, projectRoot, frameworkRoot, story.story_id, 'dev');
    }

    // ESCALATED.json escalated_at is fresh (just now written) — should NOT auto-FAIL.
    evaluateNextLoopAction(state, outputDir, projectRoot, frameworkRoot);

    const stillEscalated = state.getStories(4, subKey).find(s => s.id === story.story_id);
    expect(stillEscalated?.status).toBe('PIPELINE_ESCALATED');
  });

  function writeReviewFail(): void {
    const path = join(outputDir, 'review', `${story.story_id}-review.json`);
    const body = {
      story_id: story.story_id,
      verdict: 'FAIL',
      score: 3,
      issues: [{ severity: 'error', file: 'x.ts', message: 'broken' }],
    };
    writeFileSync(path, JSON.stringify(body));
  }
});
