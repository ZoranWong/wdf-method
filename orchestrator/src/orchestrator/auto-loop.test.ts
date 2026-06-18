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

  mkdirSync(join(root, '_bmad-output', 'web-dev-flow'), { recursive: true });
  writeFileSync(join(root, '_bmad-output', 'web-dev-flow', 'sprint-status.yaml'), [
    'version: "3.7.0"',
    'project_id: test-project',
    'global_state:',
    '  mode: auto',
    '  requirements_frozen_at: null',
    '  development_order_frozen_at: null',
    'phases:',
    '  phase_1:',
    '    status: NOT_STARTED',
    '    label: Analysis',
    '    gate_card: []',
    '    substates:',
    '      phase_1_1: { status: NOT_STARTED, label: "Impact Mapping" }',
    '  phase_2:',
    '    status: NOT_STARTED',
    '    label: Planning',
    '    gate_card: []',
    '    substates:',
    '      phase_2_1: { status: NOT_STARTED, label: "Product Brief" }',
    '  phase_3:',
    '    status: NOT_STARTED',
    '    label: Solutioning',
    '    gate_card: []',
    '    substates:',
    '      phase_3_1: { status: NOT_STARTED, label: "System Context" }',
    '  phase_4:',
    '    status: NOT_STARTED',
    '    label: Implementation',
    '    gate_card: []',
    '    substates:',
    '      phase_4_1: { status: NOT_STARTED, label: "Sprint Planning" }',
    'change_requests: []',
    'stories: []',
  ].join('\n'), 'utf8');

  // The orchestrator's loadConfig reads customize.toml for project
  // structure. The sprint-status.yaml above is the "unified" format;
  // the load path depends on customize config.
  writeFileSync(join(root, '.wdf'), 'project_root: true\n', 'utf8');

  const orch = new PhaseOrchestrator(root);
  return { orch, root };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('runAutoLoop', () => {
  it('completes phases 1→3 successfully (no story deps)', async () => {
    const { orch } = init();
    await orch.initialize();
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
