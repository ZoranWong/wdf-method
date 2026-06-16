import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GateEvaluator } from './gate-evaluator.js';
import { SprintStatusManager } from './sprint-status.js';
/**
 * Build an in-memory SprintStatusManager for tests. We use the public `load`
 * factory with a path that does not exist on disk; that returns a manager
 * primed with the default skeleton, which we then mutate via `state.data`.
 *
 * No write paths are exercised in these tests — the gate evaluator only
 * reads.
 */
async function freshState(filePath) {
    return SprintStatusManager.load(filePath);
}
function buildGate(check) {
    return { checks: [check], all_pass: false };
}
describe('GateEvaluator (fail-closed)', () => {
    let tmpRoot;
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
        writeFileSync(storyPath, ['---', 'story_id: ST-1', 'title: Demo', '---', '', 'body'].join('\n'), 'utf-8');
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
        writeFileSync(storyPath, [
            '---',
            'story_id: ST-2',
            'scope_write:',
            '  - src/foo.ts',
            '---',
            '',
            'body',
        ].join('\n'), 'utf-8');
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
});
//# sourceMappingURL=gate-evaluator.test.js.map