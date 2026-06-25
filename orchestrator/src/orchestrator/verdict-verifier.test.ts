import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import YAML from 'js-yaml';
import { SprintStatusManager } from './sprint-status.js';
import { verifyPendingVerdicts } from './verdict-verifier.js';
import { processStoryPipeline } from './pipeline-runner.js';
import { testReportPath, qaReportPath } from './pipeline-engine.js';
import type { StoryEntry, SprintStatus, PipelineStage } from './types.js';

/**
 * Verdict-verifier closes the Phase 4 trust gap: the FSM trusts an agent's
 * on-disk PASS verdict, so the CLI must independently re-run the story's
 * acceptance_check before that PASS is allowed to advance the pipeline.
 *
 * Commands use `node -e process.exit(N)` so exit codes are deterministic and
 * shell-free (the acceptance-runner spawns without a shell).
 */
describe('verdict-verifier', () => {
  let projectRoot: string;
  let outputDir: string;
  let state: SprintStatusManager;
  const subKey = 'phase_4_4';

  function makeStory(acceptance_check: string[]): StoryEntry {
    return {
      track: 'backend',
      order: 1,
      story_id: 'S-VV-01',
      title: 'Verdict verifier story',
      scope_write: ['backend/src/x.ts'],
      acceptance_check,
      code_standards_source: [],
    };
  }

  async function seed(story: StoryEntry, stage: PipelineStage): Promise<void> {
    await state.setDevelopmentOrder([story]);
    await state.updateStoryStatus(4, subKey, {
      id: story.story_id,
      status: 'IN_REVIEW',
      pipeline: { stage, attempt: 1, total_retries: 0, max_retries: 5 },
    });
  }

  function writeTestPass(): void {
    writeFileSync(
      testReportPath('S-VV-01', outputDir),
      JSON.stringify({ story_id: 'S-VV-01', verdict: 'PASS', passed: 10, failed: 0, coverage: { lines: 90 } }),
    );
  }
  function writeQaPass(): void {
    writeFileSync(
      qaReportPath('S-VV-01', outputDir),
      JSON.stringify({ story_id: 'S-VV-01', verdict: 'PASS', summary: 'all AC met', ac_checks: [] }),
    );
  }

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'wdf-vv-'));
    outputDir = join(projectRoot, '_wdf_output');
    mkdirSync(join(outputDir, 'review'), { recursive: true });
    mkdirSync(join(outputDir, 'test-reports'), { recursive: true });
    mkdirSync(join(outputDir, 'qa'), { recursive: true });

    const trackingPath = join(outputDir, 'sprint-status.yaml');
    const seedStatus: SprintStatus = {
      project: 'vv-test',
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
          substates: { [subKey]: { status: 'IN_PROGRESS', stories: [] } },
        },
      },
      change_requests: [],
    };
    writeFileSync(trackingPath, YAML.dump(seedStatus));
    state = await SprintStatusManager.load(trackingPath);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('overrides an agent PASS to FAIL when acceptance checks actually fail', async () => {
    const story = makeStory(['node -e process.exit(1)']);
    await seed(story, 'testing');
    writeTestPass();

    const results = await verifyPendingVerdicts(state, outputDir, projectRoot);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      story_id: 'S-VV-01',
      stage: 'testing',
      cli_passed: false,
      overridden: true,
      no_checks: false,
    });
    expect(results[0].failures.length).toBeGreaterThanOrEqual(1);

    // The on-disk report must now read FAIL so the FSM routes back to dev.
    const report = JSON.parse(readFileSync(testReportPath('S-VV-01', outputDir), 'utf-8'));
    expect(report.verdict).toBe('FAIL');
    expect(report.cli_override).toBe(true);
    expect(report.cli_verified).toBe(true);
    expect(report.failed).toBeGreaterThanOrEqual(1);

    // And the pipeline FSM, reading the rewritten report, sends it back to dev.
    const action = processStoryPipeline(story, state, outputDir, projectRoot);
    expect(action.manifest?.stage).toBe('dev');
    expect(action.manifest?.feedback).toBeTruthy();
  });

  it('stamps (does not override) an agent PASS when acceptance checks really pass', async () => {
    const story = makeStory(['node -e process.exit(0)']);
    await seed(story, 'qa');
    writeQaPass();

    const results = await verifyPendingVerdicts(state, outputDir, projectRoot);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ cli_passed: true, overridden: false, no_checks: false });

    const report = JSON.parse(readFileSync(qaReportPath('S-VV-01', outputDir), 'utf-8'));
    expect(report.verdict).toBe('PASS');
    expect(report.cli_verified).toBe(true);
    expect(report.cli_passed).toBe(true);

    // QA PASS that the CLI confirmed → pipeline completes, story MERGED.
    const action = processStoryPipeline(story, state, outputDir, projectRoot);
    expect(action.kind).toBe('complete');
    expect(state.getStories(4, subKey).find(s => s.id === 'S-VV-01')?.status).toBe('MERGED');
  });

  it('accepts a PASS without override when the story declares no acceptance_check', async () => {
    const story = makeStory([]);
    await seed(story, 'testing');
    writeTestPass();

    const results = await verifyPendingVerdicts(state, outputDir, projectRoot);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ no_checks: true, overridden: false, cli_passed: true });

    const report = JSON.parse(readFileSync(testReportPath('S-VV-01', outputDir), 'utf-8'));
    expect(report.verdict).toBe('PASS');
    expect(report.cli_no_checks).toBe(true);
  });

  it('does not re-run an already cli_verified report (idempotent)', async () => {
    const story = makeStory(['node -e process.exit(1)']);
    await seed(story, 'testing');
    // Pre-stamp the report as already verified — the verifier must skip it.
    writeFileSync(
      testReportPath('S-VV-01', outputDir),
      JSON.stringify({ story_id: 'S-VV-01', verdict: 'PASS', cli_verified: true, cli_passed: true }),
    );

    const results = await verifyPendingVerdicts(state, outputDir, projectRoot);
    expect(results).toHaveLength(0);
  });

  it('ignores stages other than testing/qa', async () => {
    const story = makeStory(['node -e process.exit(1)']);
    await seed(story, 'review');
    // A review report PASS exists but review is not a CLI-verified stage.
    writeFileSync(
      join(outputDir, 'review', 'S-VV-01-review.json'),
      JSON.stringify({ story_id: 'S-VV-01', verdict: 'PASS', score: 9, issues: [] }),
    );

    const results = await verifyPendingVerdicts(state, outputDir, projectRoot);
    expect(results).toHaveLength(0);
  });
});
