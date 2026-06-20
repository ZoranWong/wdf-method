import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GateEvaluator } from './gate-evaluator.js';
import { SprintStatusManager } from './sprint-status.js';
import type { GateCard, GateCheck } from './types.js';

/**
 * Build an in-memory SprintStatusManager for tests. We use the public `load`
 * factory with a path that does not exist on disk; that returns a manager
 * primed with the default skeleton, which we then mutate via `state.data`.
 *
 * No write paths are exercised in these tests — the gate evaluator only
 * reads.
 */
async function freshState(filePath: string): Promise<SprintStatusManager> {
  return SprintStatusManager.load(filePath);
}

function buildGate(check: GateCheck): GateCard {
  return { checks: [check], all_pass: false };
}

describe('GateEvaluator (fail-closed)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'wdf-gate-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('fails when the check type is unknown', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'X-01',
      type: 'totally_made_up_type',
      description: 'unknown check',
    });

    const result = await ev.evaluate(card, state);

    expect(result.all_pass).toBe(false);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/Unknown check type: totally_made_up_type/);
  });

  it('user_confirmation: fail-closed by default (no auth record)', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));
    const card = buildGate({
      id: 'U-01',
      type: 'user_confirmation',
      description: 'interactive gate',
    });
    const result = await ev.evaluate(card, state);
    expect(result.all_pass).toBe(false);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/User confirmation required/);
  });

  it('user_confirmation: auto-passes when allow_auto_degrade=true and executionMode=auto', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));
    const card = buildGate({
      id: 'U-02',
      type: 'user_confirmation',
      description: 'auto-degradable gate',
      allow_auto_degrade: true,
    });
    const result = await ev.evaluate(card, state, { executionMode: 'auto' });
    expect(result.all_pass).toBe(true);
    expect(result.results[0].status).toBe('pass');
    expect(result.results[0].reason).toMatch(/Auto-degraded/);
  });

  it('user_confirmation: stays fail-closed in auto mode when allow_auto_degrade is false', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));
    const card = buildGate({
      id: 'U-03',
      type: 'user_confirmation',
      description: 'critical gate',
      // allow_auto_degrade intentionally omitted → defaults to fail-closed
    });
    const result = await ev.evaluate(card, state, { executionMode: 'auto' });
    expect(result.all_pass).toBe(false);
    expect(result.results[0].reason).toMatch(/not marked allow_auto_degrade/);
  });

  it('fails when dependency_status references an unimplemented field', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'D-01',
      type: 'dependency_status',
      description: 'unsupported field',
      source: '{sprint_tracking}',
      field: 'phases.phase_2.substates.phase_2_10.status',
      operator: 'eq',
      expected: 'LOCKED',
    });

    const result = await ev.evaluate(card, state);

    expect(result.all_pass).toBe(false);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/dependency_status: field "phases\.phase_2\.substates\.phase_2_10\.status".*not implemented/);
  });

  it('fails for an unsupported operator on a supported field', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    // phase_3.status field is supported, but only with expected="LOCKED".
    // Using an arbitrary expected value should fail-closed (no silent eq pass).
    const card = buildGate({
      id: 'D-02',
      type: 'dependency_status',
      description: 'eq with unsupported expected value',
      source: '{sprint_tracking}',
      field: 'phases.phase_3.status',
      operator: 'eq',
      expected: 'APPROVED',
    });

    const result = await ev.evaluate(card, state);

    expect(result.all_pass).toBe(false);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/unsupported expected value/);
  });

  it('fails for an unsupported operator with no field-specific branch (eq)', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'D-03',
      type: 'dependency_status',
      description: 'eq on completely unknown field',
      source: '{sprint_tracking}',
      field: 'global_state.code_standards_source',
      operator: 'eq',
      expected: ['AGENTS.md'],
    });

    const result = await ev.evaluate(card, state);

    expect(result.all_pass).toBe(false);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/not implemented/);
  });

  it('passes phase_3.status=LOCKED when phase 3 is LOCKED, fails otherwise', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'D-04',
      type: 'dependency_status',
      description: 'phase 3 locked',
      source: '{sprint_tracking}',
      field: 'phases.phase_3.status',
      operator: 'eq',
      expected: 'LOCKED',
    });

    // Default state — phase_3 is NOT_STARTED → fail.
    let result = await ev.evaluate(card, state);
    expect(result.all_pass).toBe(false);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/Phase 3 status is "NOT_STARTED"/);

    // Flip phase 3 to LOCKED → pass.
    state.data.phases.phase_3.status = 'LOCKED';
    result = await ev.evaluate(card, state);
    expect(result.all_pass).toBe(true);
    expect(result.results[0].status).toBe('pass');
  });

  it('passes development_order_frozen_at presence check when set, fails when missing', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'D-05',
      type: 'dependency_status',
      description: 'dev order frozen',
      source: '{sprint_tracking}',
      field: 'global_state.development_order_frozen_at',
      operator: 'neq',
      expected: null,
    });

    // Default: not frozen → fail.
    let result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/Development order not frozen/);

    state.data.global_state.development_order_frozen_at = '2026-01-01T00:00:00Z';
    result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('pass');
  });

  it('passes requirements_frozen_at presence check when set, fails when missing', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'D-06',
      type: 'dependency_status',
      description: 'requirements frozen',
      source: '{sprint_tracking}',
      field: 'global_state.requirements_frozen_at',
      operator: 'neq',
      expected: null,
    });

    let result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');

    state.data.global_state.requirements_frozen_at = '2026-01-02T00:00:00Z';
    result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('pass');
  });

  it('passes phase_3_9 LOCKED check when phase 3.9 is LOCKED', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'D-07',
      type: 'dependency_status',
      description: 'phase 3.9 locked',
      source: '{sprint_tracking}',
      field: 'phases.phase_3.substates.phase_3_9.status',
      operator: 'eq',
      expected: 'LOCKED',
    });

    let result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');

    state.data.phases.phase_3.substates = {
      phase_3_9: { status: 'LOCKED' },
    };
    result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('pass');
  });

  it('user_confirmation defaults to fail (no silent pass, no auto-mode wired here)', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'U-01',
      type: 'user_confirmation',
      description: 'human approval required',
    });

    const result = await ev.evaluate(card, state);

    expect(result.all_pass).toBe(false);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/User confirmation required/);
  });

  it('field_exists fails when the field is missing from the source artifact', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    // Write a story-like YAML file with frontmatter that lacks the field.
    const storyPath = join(tmpRoot, 'story-1.md');
    writeFileSync(
      storyPath,
      ['---', 'story_id: ST-1', 'title: Demo', '---', '', 'body'].join('\n'),
      'utf-8'
    );

    const card = buildGate({
      id: 'SRG-01',
      type: 'field_exists',
      description: 'scope_write must exist',
      source: 'story-1.md',
      field: 'scope_write',
    });

    const result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/scope_write missing/);
  });

  it('field_exists passes when the field is present and non-empty', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const storyPath = join(tmpRoot, 'story-2.md');
    writeFileSync(
      storyPath,
      [
        '---',
        'story_id: ST-2',
        'scope_write:',
        '  - src/foo.ts',
        '---',
        '',
        'body',
      ].join('\n'),
      'utf-8'
    );

    const card = buildGate({
      id: 'SRG-02',
      type: 'field_exists',
      description: 'scope_write must exist',
      source: 'story-2.md',
      field: 'scope_write',
    });

    const result = await ev.evaluate(card, state);
    expect(result.all_pass).toBe(true);
    expect(result.results[0].status).toBe('pass');
  });

  it('artifact_exists fails when the file is missing', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'A-01',
      type: 'artifact_exists',
      description: 'check missing artifact',
      target: 'docs/missing.md',
    });

    const result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/Artifact not found/);
  });

  it('artifact_exists passes when the file is present', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    mkdirSync(join(tmpRoot, 'docs'), { recursive: true });
    writeFileSync(join(tmpRoot, 'docs', 'present.md'), 'hello\n', 'utf-8');

    const card = buildGate({
      id: 'A-02',
      type: 'artifact_exists',
      description: 'present artifact',
      target: 'docs/present.md',
    });

    const result = await ev.evaluate(card, state);
    expect(result.all_pass).toBe(true);
    expect(result.results[0].status).toBe('pass');
  });

  it('scope_boundary fails when implementation boundary is not frozen', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'B-01',
      type: 'scope_boundary',
      description: 'boundary frozen',
    });

    const result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/boundary not frozen/i);
  });

  it('artifact_checksum fails when file is missing', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'CHK-01',
      type: 'artifact_checksum',
      description: 'verify file integrity',
      target: 'missing-file.txt',
      expected: 'abc123',
    });

    const result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/file not found/);
  });

  it('artifact_checksum fails when hash does not match', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    writeFileSync(join(tmpRoot, 'test.txt'), 'hello world', 'utf-8');

    const card = buildGate({
      id: 'CHK-02',
      type: 'artifact_checksum',
      description: 'verify file integrity',
      target: 'test.txt',
      expected: 'wronghash',
      algorithm: 'sha256',
    });

    const result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/hash mismatch/);
  });

  it('artifact_checksum passes when hash matches', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const content = 'hello world';
    writeFileSync(join(tmpRoot, 'test.txt'), content, 'utf-8');

    // Calculate expected sha256 hash
    const expected = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';

    const card = buildGate({
      id: 'CHK-03',
      type: 'artifact_checksum',
      description: 'verify file integrity',
      target: 'test.txt',
      expected,
      algorithm: 'sha256',
    });

    const result = await ev.evaluate(card, state);
    expect(result.all_pass).toBe(true);
    expect(result.results[0].status).toBe('pass');
  });

  it('artifact_checksum supports multiple algorithms', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const content = 'test content';
    writeFileSync(join(tmpRoot, 'test.txt'), content, 'utf-8');

    // MD5: '9473fdd0d880a43c21b7778d34872157' for 'test content'
    const cardMd5 = buildGate({
      id: 'CHK-04',
      type: 'artifact_checksum',
      description: 'verify MD5 checksum',
      target: 'test.txt',
      expected: '9473fdd0d880a43c21b7778d34872157',
      algorithm: 'md5',
    });

    const result = await ev.evaluate(cardMd5, state);
    expect(result.all_pass).toBe(true);
    expect(result.results[0].status).toBe('pass');
  });

  it('artifact_checksum fails with invalid algorithm', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    writeFileSync(join(tmpRoot, 'test.txt'), 'hello', 'utf-8');

    const card = buildGate({
      id: 'CHK-05',
      type: 'artifact_checksum',
      description: 'test invalid algorithm',
      target: 'test.txt',
      expected: 'abc',
      algorithm: 'invalid-algo',
    });

    const result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/unsupported algorithm/);
  });

  it('quality_threshold fails when metric is missing', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    const card = buildGate({
      id: 'Q-01',
      type: 'quality_threshold',
      description: 'test coverage check',
      metric: 'test_coverage',
      threshold: 80,
      operator: 'gte',
    });

    const result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/metric "test_coverage" not found/);
  });

  it('quality_threshold passes when gte threshold met', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    // Set quality metrics in state
    state.data.global_state.quality_metrics = {
      test_coverage: 85,
    };

    const card = buildGate({
      id: 'Q-02',
      type: 'quality_threshold',
      description: 'test coverage >= 80%',
      metric: 'test_coverage',
      threshold: 80,
      operator: 'gte',
    });

    const result = await ev.evaluate(card, state);
    expect(result.all_pass).toBe(true);
    expect(result.results[0].status).toBe('pass');
  });

  it('quality_threshold fails when gte threshold not met', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    state.data.global_state.quality_metrics = {
      test_coverage: 75,
    };

    const card = buildGate({
      id: 'Q-03',
      type: 'quality_threshold',
      description: 'test coverage >= 80%',
      metric: 'test_coverage',
      threshold: 80,
      operator: 'gte',
    });

    const result = await ev.evaluate(card, state);
    expect(result.all_pass).toBe(false);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/test_coverage = 75 gte 80 failed/);
  });

  it('quality_threshold supports all comparison operators', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    state.data.global_state.quality_metrics = {
      coverage: 85,
      lint_issues: 3,
      bundle_size: 450,
    };

    // gt (greater than)
    const cardGt = buildGate({
      id: 'Q-04',
      type: 'quality_threshold',
      description: 'coverage gt check',
      metric: 'coverage',
      threshold: 80,
      operator: 'gt',
    });
    const resultGt = await ev.evaluate(cardGt, state);
    expect(resultGt.results[0].status).toBe('pass');

    // lte (less than or equal)
    const cardLte = buildGate({
      id: 'Q-05',
      type: 'quality_threshold',
      description: 'lint issues lte check',
      metric: 'lint_issues',
      threshold: 5,
      operator: 'lte',
    });
    const resultLte = await ev.evaluate(cardLte, state);
    expect(resultLte.results[0].status).toBe('pass');

    // lt (less than)
    const cardLt = buildGate({
      id: 'Q-06',
      type: 'quality_threshold',
      description: 'bundle size lt check',
      metric: 'bundle_size',
      threshold: 500,
      operator: 'lt',
    });
    const resultLt = await ev.evaluate(cardLt, state);
    expect(resultLt.results[0].status).toBe('pass');

    // eq (equal)
    const cardEq = buildGate({
      id: 'Q-07',
      type: 'quality_threshold',
      description: 'lint issues eq check',
      metric: 'lint_issues',
      threshold: 3,
      operator: 'eq',
    });
    const resultEq = await ev.evaluate(cardEq, state);
    expect(resultEq.results[0].status).toBe('pass');

    // neq (not equal)
    const cardNeq = buildGate({
      id: 'Q-08',
      type: 'quality_threshold',
      description: 'lint issues neq check',
      metric: 'lint_issues',
      threshold: 0,
      operator: 'neq',
    });
    const resultNeq = await ev.evaluate(cardNeq, state);
    expect(resultNeq.results[0].status).toBe('pass');
  });

  it('quality_threshold fails with invalid operator', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    state.data.global_state.quality_metrics = { coverage: 85 };

    const card = buildGate({
      id: 'Q-09',
      type: 'quality_threshold',
      description: 'invalid operator test',
      metric: 'coverage',
      threshold: 80,
      operator: 'invalid-op',
    });

    const result = await ev.evaluate(card, state);
    expect(result.results[0].status).toBe('fail');
    expect(result.results[0].reason).toMatch(/unsupported operator/);
  });

  it('quality_threshold can read metrics from source file', async () => {
    const ev = new GateEvaluator(tmpRoot);
    const state = await freshState(join(tmpRoot, 'no-such.yaml'));

    writeFileSync(
      join(tmpRoot, 'metrics.json'),
      JSON.stringify({ test_coverage: 90, lint_issues: 2 }),
      'utf-8'
    );

    const card = buildGate({
      id: 'Q-10',
      type: 'quality_threshold',
      description: 'test coverage from file',
      source: 'metrics.json',
      metric: 'test_coverage',
      threshold: 85,
      operator: 'gte',
    });

    const result = await ev.evaluate(card, state);
    expect(result.all_pass).toBe(true);
    expect(result.results[0].status).toBe('pass');
  });
});
