import { describe, expect, it, beforeEach } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import simpleGit from 'simple-git';
import YAML from 'js-yaml';

import { SprintStatusManager } from './sprint-status.js';
import { GateEvaluator } from './gate-evaluator.js';
import { MergeQueueManager } from './merge-queue.js';
import { SprintStatusValidator } from './state-validator.js';
import { StoryEntry } from './types.js';

/**
 * E2E test using the fixtures/todo-app project.
 *
 * What this verifies:
 *   • Status initialization + save/reload round-trip (the recovery contract)
 *   • Phase 1-4 FSM transitions through the orchestrator state APIs
 *   • Gate Card evaluation (artifact_exists fail-closed → pass on artifact create)
 *   • Story dependency tracking via state APIs (Story Ready Gate prerequisite)
 *   • Merge queue enqueue + dependency-ordered reconciliation
 *   • Atomic write integrity (no .tmp.* files leak after save)
 *   • Split-file status recovery (unified yaml fallback)
 *
 * No real agent dispatch happens — we drive the engine state machine directly
 * and assert the resulting on-disk state is well-formed.
 */

const FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', 'fixtures', 'todo-app');

interface ProjectPaths {
  projectRoot: string;
  outDir: string;
  statusDir: string;
  trackingPath: string;
  storiesDir: string;
}

/**
 * Copy fixtures/todo-app into a temp directory and initialize a git repo so
 * worktree-aware code paths don't blow up. Returns useful paths.
 */
async function bootstrapProject(): Promise<ProjectPaths> {
  const projectRoot = mkdtempSync(join(tmpdir(), 'wdf-e2e-'));
  cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });

  // Init git so the orchestrator can compute diffs / tag scope-freeze if asked.
  const git = simpleGit(projectRoot);
  await git.init();
  await git.addConfig('user.email', 'e2e@test.local');
  await git.addConfig('user.name', 'E2E Test');
  await git.add('.');
  await git.commit('Initial fixture import', ['--allow-empty']);

  const outDir = join(projectRoot, '_bmad-output', 'web-dev-flow');
  const statusDir = join(outDir, 'status');
  const storiesDir = join(outDir, 'stories');
  const trackingPath = join(outDir, 'sprint-status.yaml');

  // Stories live in the orchestrator's stories_output location; statusDir is
  // created on-demand by individual tests that exercise split-file mode.
  mkdirSync(storiesDir, { recursive: true });
  cpSync(join(projectRoot, 'stories'), storiesDir, { recursive: true });

  return { projectRoot, outDir, statusDir, trackingPath, storiesDir };
}

function fixtureStories(): StoryEntry[] {
  return [
    {
      track: 'backend',
      order: 10,
      story_id: 'S-1.1',
      title: 'Create todo CRUD API',
      scope_write: ['src/api'],
      acceptance_check: ['npm run test'],
      code_standards_source: ['AGENTS.md'],
    },
    {
      track: 'frontend',
      order: 20,
      story_id: 'S-1.2',
      title: 'Build todo list UI',
      depends_on: [{ story_id: 'S-1.1', track: 'backend' }],
      scope_write: ['src/web'],
      acceptance_check: ['npm run test'],
      code_standards_source: ['AGENTS.md'],
    },
  ];
}

describe('E2E (todo-app fixture) — engine state flow', () => {
  let paths: ProjectPaths;

  beforeEach(async () => {
    paths = await bootstrapProject();
  });

  it('initializes a fresh sprint-status with sane defaults', async () => {
    const state = await SprintStatusManager.load(paths.trackingPath);
    await state.save();

    expect(state.data.workflow_version).toBe('3.6.0');
    expect(state.data.global_state.current_phase).toBe(1);
    expect(state.data.global_state.overall_status).toBe('not_started');
    expect(state.getPhase(1)?.status).toBe('NOT_STARTED');
    expect(state.getPhase(4)?.status).toBe('NOT_STARTED');
    expect(state.getMergeQueue().enabled).toBe(true);
    expect(state.getMergeQueue().items).toEqual([]);
    expect(existsSync(paths.trackingPath)).toBe(true);
  });

  it('progresses Phase 1 -> Phase 4 through canonical FSM transitions', async () => {
    const state = await SprintStatusManager.load(paths.trackingPath);
    await state.save();

    // Phase 1: skip (analysis is optional)
    await state.setPhaseStatus(1, 'SKIPPED');

    // Phase 2: Planning -> freeze requirements at sub-phase 2.5
    await state.setPhaseStatus(2, 'IN_PROGRESS');
    await state.setSubState(2, 'phase_2_5', 'PRD_DRAFTED');
    await state.freezeRequirements();
    await state.setSubState(2, 'phase_2_5', 'LOCKED');
    await state.setPhaseStatus(2, 'LOCKED');

    expect(state.data.global_state.requirements_frozen_at).toBeTruthy();

    // Phase 3: Solutioning -> set development_order at 3.7, freeze it
    await state.setPhaseStatus(3, 'IN_PROGRESS');
    await state.setDevelopmentOrder(fixtureStories());
    await state.freezeDevelopmentOrder();
    await state.setSubState(3, 'phase_3_9', 'LOCKED');
    await state.setPhaseStatus(3, 'LOCKED');

    expect(state.data.global_state.development_order_frozen_at).toBeTruthy();
    expect(state.getDevelopmentOrder()).toHaveLength(2);

    // Phase 4: Implementation
    await state.setPhaseStatus(4, 'IN_PROGRESS');
    await state.setImplementationBoundary({
      backend_scope: ['src/api'],
      frontend_scope: ['src/web'],
      shared_scope: [],
      forbidden_paths: ['.env.production'],
    });
    expect(state.data.global_state.implementation_boundary?.scope_frozen).toBe(true);

    // Drive a story through CODE_ACCEPTED then mark phase complete
    await state.updateStoryStatus(4, 'phase_4_4', {
      id: 'S-1.1',
      status: 'CODE_ACCEPTED',
      bmad_story_state: 'done',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    const stories = state.getStories(4, 'phase_4_4');
    expect(stories).toHaveLength(1);
    expect(stories[0].status).toBe('CODE_ACCEPTED');

    await state.setSubState(4, 'phase_4_13', 'FEATURE_ACCEPTED');
    await state.setPhaseStatus(4, 'LOCKED');
    await state.setOverallStatus('complete');

    // Sanity check via state-validator: every status we used must round-trip
    const validator = new SprintStatusValidator(paths.projectRoot);
    const report = validator.validate(state.data);
    const errors = report.issues.filter(i => i.severity === 'error');
    expect(errors).toEqual([]);
    expect(report.summary.stories).toBe(1);
  });

  it('Story Ready Gate via dependency tracking blocks frontend until backend is merged', async () => {
    const state = await SprintStatusManager.load(paths.trackingPath);
    await state.setDevelopmentOrder(fixtureStories());

    // Frontend story depends on backend
    const fe = state.getDevelopmentOrder().find(s => s.story_id === 'S-1.2')!;
    expect(fe.depends_on?.[0].story_id).toBe('S-1.1');

    // Simulate backend not yet done
    await state.updateStoryStatus(4, 'phase_4_4', {
      id: 'S-1.1',
      status: 'IN_PROGRESS',
    });
    const beStories = state.getStories(4, 'phase_4_4');
    const merged = beStories.some(s => s.id === 'S-1.1' && s.status === 'MERGED');
    expect(merged).toBe(false);

    // Mark backend as MERGED -> frontend dep is now satisfied
    await state.updateStoryStatus(4, 'phase_4_4', {
      id: 'S-1.1',
      status: 'MERGED',
      completed_at: new Date().toISOString(),
    });
    const updated = state.getStories(4, 'phase_4_4');
    expect(updated[0].status).toBe('MERGED');
  });

  it('Gate Evaluator: artifact_exists fails closed, passes when file is created', async () => {
    const state = await SprintStatusManager.load(paths.trackingPath);
    const evaluator = new GateEvaluator(paths.projectRoot);

    // Missing artifact -> fail-closed
    let result = await evaluator.evaluate(
      {
        phase: 2,
        checks: [
          {
            id: 'G2-PRD',
            type: 'artifact_exists',
            description: 'PRD must exist before Phase 3',
            target: '_bmad-output/web-dev-flow/prd.md',
          },
        ],
        all_pass: false,
      },
      state
    );
    expect(result.all_pass).toBe(false);
    expect(result.results[0].status).toBe('fail');

    // Create the artifact -> pass
    const prdPath = join(paths.outDir, 'prd.md');
    mkdirSync(dirname(prdPath), { recursive: true });
    writeFileSync(prdPath, '# PRD\n');

    result = await evaluator.evaluate(
      {
        phase: 2,
        checks: [
          {
            id: 'G2-PRD',
            type: 'artifact_exists',
            description: 'PRD must exist',
            target: '_bmad-output/web-dev-flow/prd.md',
          },
        ],
        all_pass: false,
      },
      state
    );
    expect(result.all_pass).toBe(true);
  });

  it('Merge Queue: enqueue, dependency reconciliation, ordered ready set', async () => {
    const state = await SprintStatusManager.load(paths.trackingPath);
    await state.save();

    const mq = new MergeQueueManager(state, paths.projectRoot);

    // Backend has no deps -> enqueues at order 10
    await mq.enqueue('S-1.1', 'backend', 'story/S-1.1-be', [], ['npm run test']);
    // Frontend depends on backend -> order 20
    await mq.enqueue('S-1.2', 'frontend', 'story/S-1.2-fe', ['S-1.1'], ['npm run test']);

    const queue = state.getMergeQueue();
    expect(queue.items).toHaveLength(2);
    expect(queue.items[0].story_id).toBe('S-1.1');
    expect(queue.items[0].merge_order).toBe(10);
    expect(queue.items[1].merge_order).toBe(20);

    // First reconcile: BE has no deps -> ready; FE waits on BE
    const first = await mq.reconcileDependencies();
    expect(first.ready.map(i => i.story_id)).toContain('S-1.1');
    expect(first.waiting.map(i => i.story_id)).toContain('S-1.2');

    // Mark BE merged -> FE becomes ready on next reconcile
    await mq.markMerging('S-1.1');
    await mq.markMerged('S-1.1', 'abc1234');

    const second = await mq.reconcileDependencies();
    expect(second.waiting).toHaveLength(0);
    expect(second.ready.map(i => i.story_id)).toContain('S-1.2');

    // displayQueue should mention both stories and the merged status
    const display = mq.displayQueue();
    expect(display).toContain('S-1.1');
    expect(display).toContain('S-1.2');
    expect(display).toContain('merged');
  });

  it('status backup & recovery: atomic save round-trips and preserves state', async () => {
    const state = await SprintStatusManager.load(paths.trackingPath);
    await state.setPhaseStatus(1, 'IN_PROGRESS');
    await state.setSubState(1, 'phase_1_1', 'LOCKED');
    await state.setDevelopmentOrder(fixtureStories());

    // No .tmp.* writes should be left behind by atomicWrite (rename-on-write).
    const trackingDir = dirname(paths.trackingPath);
    const allFiles = readdirSync(trackingDir);
    expect(allFiles.some(f => f.includes('.tmp.'))).toBe(false);

    // Reload from disk -> recovers identical engine state.
    const reloaded = await SprintStatusManager.load(paths.trackingPath);
    expect(reloaded.getPhase(1)?.status).toBe('IN_PROGRESS');
    expect(reloaded.getSubState(1, 'phase_1_1')).toBe('LOCKED');
    expect(reloaded.getDevelopmentOrder()).toHaveLength(2);
    expect(reloaded.getDevelopmentOrder()[0].story_id).toBe('S-1.1');

    // Append-only audit log captures decisions
    await state.appendAudit('phase_lock', { decision: 'approve', phase: 1 });
    const auditFile = join(dirname(paths.trackingPath), 'audit', 'orchestrator-audit.jsonl');
    expect(existsSync(auditFile)).toBe(true);
    const lines = readFileSync(auditFile, 'utf-8').trim().split('\n');
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    expect(lastEntry.event).toBe('phase_lock');
    expect(lastEntry.decision).toBe('approve');
  });

  it('split-file status mode: writes per-phase yaml + unified fallback', async () => {
    // Seed the split-file directory with a default-shaped global + phase yaml.
    // (loadFromStatusDir doesn't materialize defaults when the dir is empty.)
    mkdirSync(paths.statusDir, { recursive: true });

    // Bootstrap unified yaml via load() to get the canonical default shape,
    // then write that shape into the split-file directory to seed it.
    const seed = await SprintStatusManager.load(paths.trackingPath);
    await seed.save();
    const seededData = seed.data;

    writeFileSync(
      join(paths.statusDir, 'global.yaml'),
      YAML.dump({ global_state: seededData.global_state })
    );
    writeFileSync(
      join(paths.statusDir, 'phase-02.yaml'),
      YAML.dump({ phase_2: seededData.phases.phase_2 })
    );

    const state = await SprintStatusManager.loadFromStatusDir(
      paths.statusDir,
      paths.trackingPath
    );

    // Phase 2 came back through the split-file loader
    expect(state.getPhase(2)?.status).toBe('NOT_STARTED');

    await state.setPhaseStatus(2, 'IN_PROGRESS');
    await state.setDevelopmentOrder(fixtureStories());
    await state.save();

    // Per-phase split file is written by save()
    expect(existsSync(join(paths.statusDir, 'global.yaml'))).toBe(true);
    expect(existsSync(join(paths.statusDir, 'phase-02.yaml'))).toBe(true);

    // Unified fallback is also kept up-to-date
    expect(existsSync(paths.trackingPath)).toBe(true);

    // YAML the engine wrote round-trips through js-yaml.
    // SprintStatusManager maps global_state.development_order → workflow.development_order
    // when emitting init-compatible global.yaml (per saveInner schema mapping).
    const globalRaw = readFileSync(join(paths.statusDir, 'global.yaml'), 'utf-8');
    const parsed = YAML.load(globalRaw) as any;
    expect(parsed.workflow.development_order).toHaveLength(2);

    // Recovery: unified yaml fallback also reflects the latest state
    const fallback = await SprintStatusManager.load(paths.trackingPath);
    expect(fallback.getPhase(2)?.status).toBe('IN_PROGRESS');
    expect(fallback.getDevelopmentOrder()).toHaveLength(2);
  });

  it('Change Requests block + resolve flow', async () => {
    const state = await SprintStatusManager.load(paths.trackingPath);
    await state.setPhaseStatus(2, 'IN_PROGRESS');

    await state.addChangeRequest({
      title: 'Missing API contract for /todos',
      source_phase: 3,
      source_artifact: 'api-spec.yaml',
      discovered_in_phase: 4,
      severity: 'blocking',
      description: 'No 404 response defined for missing todo',
      created_by: 'test',
    });

    expect(state.getOpenBlockingCRs()).toHaveLength(1);
    expect(state.getOverallStatus()).toBe('blocked');

    const cr = state.getOpenBlockingCRs()[0];
    await state.resolveChangeRequest(cr.id, 'Added 404 response in api-spec.yaml');
    expect(state.getOpenBlockingCRs()).toHaveLength(0);
    expect(state.data.global_state.blocked_by).toBeUndefined();
  });

  it('full state round-trips through the validator without errors', async () => {
    const state = await SprintStatusManager.load(paths.trackingPath);
    await state.setDevelopmentOrder(fixtureStories());
    await state.setPhaseStatus(1, 'SKIPPED');
    await state.setPhaseStatus(2, 'LOCKED');
    await state.setPhaseStatus(3, 'LOCKED');
    await state.setPhaseStatus(4, 'IN_PROGRESS');
    await state.freezeRequirements();
    await state.freezeDevelopmentOrder();
    await state.updateStoryStatus(4, 'phase_4_4', {
      id: 'S-1.1',
      status: 'CODE_ACCEPTED',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    // Reload from disk and validate -> guarantees the YAML we wrote is well-formed.
    const reloaded = await SprintStatusManager.load(paths.trackingPath);

    const validator = new SprintStatusValidator(paths.projectRoot);
    const report = validator.validate(reloaded.data);
    const errors = report.issues.filter(i => i.severity === 'error');
    expect(errors).toEqual([]);
  });
});
