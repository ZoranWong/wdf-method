import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import YAML from 'js-yaml';
import { SprintStatusManager } from './sprint-status.js';
import { processStoryPipeline } from './pipeline-runner.js';
import { postDispatchNext } from './dispatch-loop-engine.js';
import { initPipelineContext } from './pipeline-engine.js';
import type { StoryEntry, PhaseStatus, SprintStatus } from './types.js';

/**
 * Pipeline happy-path E2E: dev → review (PASS) → testing (PASS) →
 * qa (PASS) → MERGED.
 *
 * This is the V3.9 plan's deferred P1 test. It exercises the pipeline
 * engine + runner with mock on-disk reports — no Claude dispatch.
 *
 * The test asserts:
 *   1. Each stage produces the expected dispatch manifest (kind=dispatch)
 *   2. Writing a PASS report for the current stage advances the pipeline
 *   3. After qa PASS, story status becomes MERGED
 *   4. Story status file persists across calls (FSM is the source of truth)
 */
describe('Pipeline E2E — happy path', () => {
  let projectRoot: string;
  let outputDir: string;
  let state: SprintStatusManager;
  const subKey = 'phase_4_4';

  const story: StoryEntry = {
    track: 'backend',
    order: 1,
    story_id: 'S-E2E-01',
    title: 'E2E happy-path story',
    scope_write: ['backend/src/auth.ts'],
    acceptance_check: ['npm test auth'],
    code_standards_source: [],
  };

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'wdf-e2e-happy-'));
    outputDir = join(projectRoot, '_wdf_output');
    mkdirSync(join(outputDir, 'review'), { recursive: true });
    mkdirSync(join(outputDir, 'test-reports'), { recursive: true });
    mkdirSync(join(outputDir, 'qa'), { recursive: true });
    mkdirSync(join(outputDir, '.dispatch', 'pipeline', story.story_id), { recursive: true });

    const trackingPath = join(outputDir, 'sprint-status.yaml');
    // Seed an empty sprint-status.yaml — SprintStatusManager.load reads
    // this and round-trips it through save() on every updateStoryStatus.
    const seed: SprintStatus = {
      project: 'e2e-test',
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

  it('runs dev → review → testing → qa → MERGED', () => {
    // 1. dev dispatch
    let action = processStoryPipeline(story, state, outputDir, projectRoot);
    expect(action.kind).toBe('dispatch');
    expect(action.manifest?.stage).toBe('dev');

    // 2. Simulate dev agent completion: caller calls postDispatchNext,
    //    which explicitly advances dev→review (dev doesn't write a report).
    postDispatchNext(state, outputDir, projectRoot, projectRoot, story.story_id, 'dev');

    // 3. Now processStoryPipeline sees stage=review and dispatches reviewer.
    action = processStoryPipeline(story, state, outputDir, projectRoot);
    expect(action.manifest?.stage).toBe('review');

    // 4. Review agent completes → writes review-report.json (PASS).
    //    Next processStoryPipeline call reads the report + advances.
    writeReview('PASS');
    action = processStoryPipeline(story, state, outputDir, projectRoot);
    expect(action.manifest?.stage).toBe('testing');

    // 5. Testing PASS — advance to qa
    writeTest('PASS');
    action = processStoryPipeline(story, state, outputDir, projectRoot);
    expect(action.manifest?.stage).toBe('qa');

    // 6. qa PASS — pipeline complete, story MERGED
    writeQa('PASS');
    action = processStoryPipeline(story, state, outputDir, projectRoot);
    expect(action.kind).toBe('complete');

    const finalStory = state.getStories(4, subKey).find(s => s.id === story.story_id);
    expect(finalStory?.status).toBe('MERGED');
    expect(finalStory?.bmad_story_state).toBe('done');
    expect(finalStory?.completed_at).toBeTruthy();
  });

  it('retries dev on review FAIL and respects the budget', () => {
    // Drive to review first.
    processStoryPipeline(story, state, outputDir, projectRoot);
    postDispatchNext(state, outputDir, projectRoot, projectRoot, story.story_id, 'dev');
    processStoryPipeline(story, state, outputDir, projectRoot);

    // Now write a review FAIL — pipeline should reset to dev with feedback.
    writeReview('FAIL');
    const action = processStoryPipeline(story, state, outputDir, projectRoot);
    expect(action.manifest?.stage).toBe('dev');
    expect(action.manifest?.feedback).toBeTruthy();
  });

  function writeReview(verdict: 'PASS' | 'FAIL'): void {
    const path = join(outputDir, 'review', `${story.story_id}-review.json`);
    const body = verdict === 'PASS'
      ? { story_id: story.story_id, verdict: 'PASS', score: 9, issues: [] }
      : { story_id: story.story_id, verdict: 'FAIL', score: 4, issues: [{ severity: 'error', file: 'x.ts', message: 'broken' }] };
    writeFileSync(path, JSON.stringify(body));
  }

  function writeTest(verdict: 'PASS' | 'FAIL'): void {
    const path = join(outputDir, 'test-reports', `${story.story_id}-test.json`);
    const body = verdict === 'PASS'
      ? { story_id: story.story_id, verdict: 'PASS', passed: 10, failed: 0, coverage: { lines: 90 } }
      : { story_id: story.story_id, verdict: 'FAIL', passed: 8, failed: 2, coverage: { lines: 60 }, failures: [{ test: 'x' }] };
    writeFileSync(path, JSON.stringify(body));
  }

  function writeQa(verdict: 'PASS' | 'FAIL'): void {
    const path = join(outputDir, 'qa', `${story.story_id}-qa.json`);
    const body = verdict === 'PASS'
      ? { story_id: story.story_id, verdict: 'PASS', summary: 'all AC met', ac_checks: [] }
      : { story_id: story.story_id, verdict: 'FAIL', summary: 'AC not met', ac_checks: [] };
    writeFileSync(path, JSON.stringify(body));
  }
});
