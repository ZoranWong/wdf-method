import { describe, it, expect } from 'vitest';
import { resolve, isAbsolute, sep } from 'path';
import { resolveWorkflowPath, resolveStatusDir } from './status-paths.js';
describe('resolveWorkflowPath', () => {
    const projectRoot = '/tmp/sample-project';
    it('substitutes {project-root} with the resolved project root', () => {
        const out = resolveWorkflowPath(projectRoot, '{project-root}/_bmad/foo');
        expect(out).toBe(resolve(projectRoot, '_bmad/foo'));
    });
    it('returns absolute paths unchanged after substitution', () => {
        const out = resolveWorkflowPath(projectRoot, '/var/data/status');
        expect(out).toBe('/var/data/status');
    });
    it('resolves relative values against the project root', () => {
        const out = resolveWorkflowPath(projectRoot, 'status');
        expect(out).toBe(resolve(projectRoot, 'status'));
        expect(isAbsolute(out)).toBe(true);
    });
    it('falls back when value is undefined', () => {
        const out = resolveWorkflowPath(projectRoot, undefined, '{project-root}/fallback');
        expect(out).toBe(resolve(projectRoot, 'fallback'));
    });
    it('falls back when value is an empty/whitespace string', () => {
        const out = resolveWorkflowPath(projectRoot, '   ', '{project-root}/fallback');
        expect(out).toBe(resolve(projectRoot, 'fallback'));
    });
    it('throws when no value or fallback is provided', () => {
        expect(() => resolveWorkflowPath(projectRoot, undefined)).toThrow(/no value or fallback/);
    });
    it('throws when both value and fallback are empty', () => {
        expect(() => resolveWorkflowPath(projectRoot, '', '')).toThrow(/no value or fallback/);
    });
    it('replaces multiple {project-root} occurrences', () => {
        const out = resolveWorkflowPath(projectRoot, '{project-root}/a/{project-root}/b');
        expect(out).toContain(`${resolve(projectRoot)}${sep}a${sep}${resolve(projectRoot)}${sep}b`);
    });
});
describe('resolveStatusDir', () => {
    const projectRoot = '/tmp/sample-project';
    it('uses the default fallback when config is empty', () => {
        const out = resolveStatusDir(projectRoot, {});
        expect(out).toBe(resolve(projectRoot, '_wdf_output/status'));
    });
    it('uses the default fallback when workflow.status_dir is missing', () => {
        const out = resolveStatusDir(projectRoot, { workflow: {} });
        expect(out).toBe(resolve(projectRoot, '_wdf_output/status'));
    });
    it('honours a workflow.status_dir override', () => {
        const out = resolveStatusDir(projectRoot, {
            workflow: { status_dir: '{project-root}/custom/status' },
        });
        expect(out).toBe(resolve(projectRoot, 'custom/status'));
    });
    it('accepts an absolute override', () => {
        const out = resolveStatusDir(projectRoot, {
            workflow: { status_dir: '/var/wdf/status' },
        });
        expect(out).toBe('/var/wdf/status');
    });
    it('ignores non-string workflow.status_dir values', () => {
        const out = resolveStatusDir(projectRoot, { workflow: { status_dir: 42 } });
        expect(out).toBe(resolve(projectRoot, '_wdf_output/status'));
    });
});
//# sourceMappingURL=status-paths.test.js.map