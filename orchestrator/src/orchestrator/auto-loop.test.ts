import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PhaseOrchestrator, type AutoLoopResult } from './orchestrator.js';

function setupRoot(): string {
  return mkdtempSync(join(tmpdir(), 'wdf-autorun-'));
}

function init(): { orch: PhaseOrchestrator; root: string } {
  const root = setupRoot();
  writeFileSync(join(root, 'customize.toml'), [
    '[workflow]',
    'version = "3.7.0"',
    'dev_mode = "full_stack"',
    '',
    '[auto_run]',
    'enabled = true',
    'auto_progress_phases = true',
    'auto_skip_optional_sub_phases = true',
    'halt_on_gate_failure = true',
    'halt_on_acceptance_failure = true',
    'max_story_retries = 2',
    'cross_story_validation = false',
    '',
    '[auto_run.merge_queue]',
    'auto_process = false',
    '',
    '[auto_run.concurrency]',
    'max_concurrent_stories = 1',
    'story_agent_timeout_minutes = 30',
    'dependency_wait_timeout_minutes = 15',
    '',
    '[change_request]',
    'delta_required = false',
    '',
    '[acceptance_gates.code_acceptance]',
    'coverage = 80',
    'lint_required = false',
    'type_check_required = false',
  ].join('\n'), 'utf8');

  mkdirSync(join(root, '_wdf_output', 'status'), { recursive: true });

  const orch = new PhaseOrchestrator(root);
  return { orch, root };
}

/**
 * Give phases 1-3 a single sub-phase each so `startPhase` has work to lock.
 * The default in-memory status (SprintStatusManager.defaultStatus) intentionally
 * has NO substates — a substate-less phase never reaches LOCKED, because locking
 * an empty phase would let runAutoLoop report success on an uninitialised project.
 * Real projects always carry substates (written by `wdf init`); seeding them here
 * exercises the same locking path without depending on on-disk status files.
 */
function seedSubstates(orch: PhaseOrchestrator, phases: number[]): void {
  for (const p of phases) {
    (orch as any).state.data.phases[`phase_${p}`].substates = {
      [`phase_${p}_1`]: { status: 'NOT_STARTED', label: `Sub ${p}.1` },
    };
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('runAutoLoop', () => {
  it('completes phases 1→3 successfully (no story deps)', async () => {
    const { orch } = init();
    await orch.initialize();
    seedSubstates(orch, [1, 2, 3]);
    const result = await orch.runAutoLoop({
      verbose: false, maxIterations: 20, startPhase: 1, endPhase: 3,
    });
    expect(result.phases_executed).toBe(3);
    expect(result.timeline.map(e => e.status)).toEqual(['locked', 'locked', 'locked']);
    expect(result.paused).toBe(false);
  }, 30000);

  it('stops on maxIterations', async () => {
    const { orch } = init();
    await orch.initialize();
    const result = await orch.runAutoLoop({
      verbose: false, maxIterations: 1, startPhase: 1, endPhase: 3,
    });
    expect(result.iterations).toBe(1);
  }, 30000);

  it('respects startPhase and endPhase', async () => {
    const { orch } = init();
    await orch.initialize();
    const result = await orch.runAutoLoop({ startPhase: 2, endPhase: 2, verbose: false });
    expect(result.total_phases).toBe(1);
    expect(result.timeline[0].phase).toBe(2);
  }, 30000);

  it('detectCurrentPhase returns 1 for fresh project', async () => {
    const { orch } = init();
    await orch.initialize();
    expect(orch['detectCurrentPhase']()).toBe(1);
  });

  it('detectCurrentPhase returns 3 when 1+2 LOCKED', async () => {
    const { orch } = init();
    await orch.initialize();
    await orch['state'].setPhaseStatus(1, 'LOCKED');
    await orch['state'].setPhaseStatus(2, 'LOCKED');
    expect(orch['detectCurrentPhase']()).toBe(3);
  });

  it('returns meaningful timeline on gate failure', async () => {
    const { orch } = init();
    await orch.initialize();
    // GateEvaluator expects gate_card = { checks: [...] }. For objects,
    // evaluatePhaseGate's .length check passes because undefined !== 0.
    (orch as any).state.data.phases['phase_2'].gate_card = {
      checks: [{ gate_check_id: 'broken', type: 'artifact_exists', path: 'does/not/exist.md' }],
    };
    const result = await orch.runAutoLoop({ startPhase: 2, endPhase: 2, verbose: false });
    const p2 = result.timeline[0];
    expect(p2.status).toBe('gate_failed');
    expect(result.phases_executed).toBe(0);
  }, 30000);
});
