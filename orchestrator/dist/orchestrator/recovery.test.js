import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { recoverStatus } from './recovery.js';
describe('recovery', () => {
    it('rebuilds corrupted derived sprint-status from split files', () => {
        const root = mkdtempSync(join(tmpdir(), 'wdf-recover-'));
        const out = join(root, '_bmad-output', 'wdf-method');
        const status = join(out, 'status');
        mkdirSync(status, { recursive: true });
        writeFileSync(join(status, 'global.yaml'), 'global_state:\n  project: test\n  workflow_version: 3.7.0\n');
        writeFileSync(join(status, 'phase-01.yaml'), 'phase_1:\n  status: LOCKED\n');
        writeFileSync(join(out, 'sprint-status.yaml'), 'not: [valid');
        const result = recoverStatus(root);
        expect(result.rebuiltDerivedStatus).toBe(true);
        expect(readFileSync(join(out, 'sprint-status.yaml'), 'utf8')).toContain('AUTO-GENERATED');
    });
    it('does not delete worktrees or branches', () => {
        const root = mkdtempSync(join(tmpdir(), 'wdf-recover-'));
        const result = recoverStatus(root);
        expect(result.actions.some(action => /delete|reset|revert|clean/i.test(action))).toBe(false);
    });
    it('restores corrupted split files from backup when available', () => {
        const root = mkdtempSync(join(tmpdir(), 'wdf-recover-'));
        const out = join(root, '_bmad-output', 'wdf-method');
        const status = join(out, 'status');
        const backup = join(out, '.status-backup');
        mkdirSync(status, { recursive: true });
        mkdirSync(backup, { recursive: true });
        writeFileSync(join(status, 'global.yaml'), 'not valid yaml: [');
        writeFileSync(join(backup, 'global.100.yaml'), 'global_state:\n  project: backup\n  workflow_version: 3.7.0\n');
        const result = recoverStatus(root);
        expect(result.restoredFromBackup).toContain('global.yaml');
        expect(readFileSync(join(status, 'global.yaml'), 'utf8')).toContain('global_state');
    });
    it('creates dashboard with recovery summary', () => {
        const root = mkdtempSync(join(tmpdir(), 'wdf-recover-'));
        const result = recoverStatus(root);
        expect(result.dashboard).toBeDefined();
        expect(typeof result.dashboard).toBe('string');
        expect(result.dashboard.length).toBeGreaterThan(0);
    });
    it('warns when no split files found to rebuild from', () => {
        const root = mkdtempSync(join(tmpdir(), 'wdf-recover-'));
        const out = join(root, '_bmad-output', 'wdf-method');
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'sprint-status.yaml'), 'not: [valid');
        const result = recoverStatus(root);
        expect(result.warnings).toContainEqual(expect.stringContaining('No status directory'));
    });
});
//# sourceMappingURL=recovery.test.js.map