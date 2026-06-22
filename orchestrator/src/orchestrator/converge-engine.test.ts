import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  collectDeclaredRequirements,
  scanCodeReferences,
  compare,
  runConverge,
  renderReport,
  writeConvergeArtifacts,
} from './converge-engine.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wdf-converge-test-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('collectDeclaredRequirements — V3.9 specs/ format', () => {
  it('extracts REQ-NNN from specs/<domain>/spec.md', () => {
    const specsDir = join(projectRoot, '_wdf_output', 'specs', 'auth');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(
      join(specsDir, 'spec.md'),
      [
        '# Auth Spec',
        '',
        '## REQ-001: Login',
        '',
        'priority: P0',
        '',
        'The system MUST authenticate users.',
        '',
        '## REQ-002: Logout',
        '',
        'The system MUST end sessions.',
      ].join('\n'),
    );

    const reqs = collectDeclaredRequirements({ projectRoot });
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ id: 'REQ-001', name: 'Login', domain: 'auth', priority: 'P0' });
    expect(reqs[1]).toMatchObject({ id: 'REQ-002', name: 'Logout', domain: 'auth' });
  });

  it('skips duplicate REQ ids across domains (first wins)', () => {
    const a = join(projectRoot, '_wdf_output', 'specs', 'auth');
    const b = join(projectRoot, '_wdf_output', 'specs', 'todo');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, 'spec.md'), '## REQ-001: Login\n');
    writeFileSync(join(b, 'spec.md'), '## REQ-001: Todo List\n');

    const reqs = collectDeclaredRequirements({ projectRoot });
    expect(reqs).toHaveLength(1);
    expect(reqs[0].domain).toBe('auth');
  });
});

describe('collectDeclaredRequirements — V3.8 prd.md fallback', () => {
  it('reads REQ-NNN headings from prd.md when specs/ is absent', () => {
    mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
    writeFileSync(
      join(projectRoot, '_wdf_output', 'prd.md'),
      '### REQ-001: User Registration\n### REQ-002: User Login\n',
    );
    const reqs = collectDeclaredRequirements({ projectRoot });
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ id: 'REQ-001', name: 'User Registration', domain: 'legacy-prd' });
  });

  it('returns empty when neither specs/ nor prd.md exist', () => {
    expect(collectDeclaredRequirements({ projectRoot })).toEqual([]);
  });
});

describe('scanCodeReferences', () => {
  it('extracts REQ-NNN from comments and route annotations', () => {
    const srcDir = join(projectRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, 'auth.ts'),
      [
        '// REQ-001: login handler',
        'export function login() {}',
        '',
        '// REQ-002 follows below',
        'export function logout() {}',
      ].join('\n'),
    );

    const refs = scanCodeReferences({ projectRoot });
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ reqId: 'REQ-001', file: 'src/auth.ts', line: 1 });
    expect(refs[1]).toMatchObject({ reqId: 'REQ-002', file: 'src/auth.ts', line: 4 });
  });

  it('also scans backend/src/ when src/ is absent', () => {
    const backendSrc = join(projectRoot, 'backend', 'src');
    mkdirSync(backendSrc, { recursive: true });
    writeFileSync(join(backendSrc, 'todos.ts'), '// REQ-004 implements CRUD\n');

    const refs = scanCodeReferences({ projectRoot });
    expect(refs).toHaveLength(1);
    expect(refs[0].file).toBe('backend/src/todos.ts');
  });

  it('skips node_modules, dist, _wdf_output', () => {
    const srcDir = join(projectRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'a.ts'), '// REQ-001 real source\n');
    mkdirSync(join(projectRoot, 'node_modules', 'lib'), { recursive: true });
    writeFileSync(join(projectRoot, 'node_modules', 'lib', 'x.ts'), '// REQ-099 vendored\n');
    mkdirSync(join(projectRoot, 'dist'), { recursive: true });
    writeFileSync(join(projectRoot, 'dist', 'b.js'), '// REQ-098 build artifact\n');

    const refs = scanCodeReferences({ projectRoot });
    expect(refs.map((r) => r.reqId)).toEqual(['REQ-001']);
  });

  it('respects --source override', () => {
    const defaultSrc = join(projectRoot, 'src');
    const customSrc = join(projectRoot, 'custom');
    mkdirSync(defaultSrc, { recursive: true });
    mkdirSync(customSrc, { recursive: true });
    writeFileSync(join(defaultSrc, 'a.ts'), '// REQ-001 default\n');
    writeFileSync(join(customSrc, 'b.ts'), '// REQ-002 custom\n');

    const refs = scanCodeReferences({ projectRoot, sourceDir: customSrc });
    expect(refs.map((r) => r.reqId)).toEqual(['REQ-002']);
  });
});

describe('compare', () => {
  it('classifies implemented / gap / drift', () => {
    const declared = [
      { id: 'REQ-001', name: 'Login', domain: 'auth' },
      { id: 'REQ-002', name: 'Logout', domain: 'auth' },
      { id: 'REQ-003', name: 'Refresh', domain: 'auth' },
    ];
    const refs = [
      { reqId: 'REQ-001', file: 'a.ts', line: 1, snippet: 'login' },
      { reqId: 'REQ-002', file: 'b.ts', line: 1, snippet: 'logout' },
      { reqId: 'REQ-099', file: 'c.ts', line: 1, snippet: 'ghost' },
    ];
    const result = compare(declared, refs);
    expect(result.implemented).toEqual(['REQ-001', 'REQ-002']);
    expect(result.gaps).toEqual(['REQ-003']);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0].reqId).toBe('REQ-099');
  });
});

describe('runConverge integration', () => {
  it('returns full result with summary', () => {
    mkdirSync(join(projectRoot, '_wdf_output', 'specs', 'auth'), { recursive: true });
    writeFileSync(join(projectRoot, '_wdf_output', 'specs', 'auth', 'spec.md'), '## REQ-001: Login\n');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'a.ts'), '// REQ-001 done\n');

    const result = runConverge({ projectRoot });
    expect(result.summary).toEqual({
      declared: 1,
      implemented: 1,
      gaps: 0,
      drift: 0,
      coveragePercent: 100,
    });
  });

  it('handles empty project (no specs, no source)', () => {
    const result = runConverge({ projectRoot });
    expect(result.summary).toEqual({
      declared: 0,
      implemented: 0,
      gaps: 0,
      drift: 0,
      coveragePercent: 0,
    });
  });
});

describe('renderReport', () => {
  it('includes all sections when gaps and drift exist', () => {
    const result = runConverge({
      projectRoot: (() => {
        const root = projectRoot;
        mkdirSync(join(root, '_wdf_output', 'specs', 'auth'), { recursive: true });
        writeFileSync(join(root, '_wdf_output', 'specs', 'auth', 'spec.md'), '## REQ-001: Login\n');
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src', 'a.ts'), '// REQ-099 ghost\n');
        return root;
      })(),
    });
    const md = renderReport(result);
    expect(md).toContain('# Converge Report');
    expect(md).toContain('Gaps — declared but not implemented');
    expect(md).toContain('REQ-001');
    expect(md).toContain('Drift — code references undeclared REQ');
    expect(md).toContain('REQ-099');
    expect(md).toContain('Methodology');
  });
});

describe('writeConvergeArtifacts', () => {
  it('writes report file', () => {
    const result = runConverge({ projectRoot });
    const { reportPath } = writeConvergeArtifacts(result, { projectRoot });
    expect(reportPath).toMatch(/converge-report-\d{4}-\d{2}-\d{2}-[a-f0-9]{6}\.md$/);
  });

  it('emits draft stories with --to-stories', () => {
    const root = projectRoot;
    mkdirSync(join(root, '_wdf_output', 'specs', 'auth'), { recursive: true });
    writeFileSync(join(root, '_wdf_output', 'specs', 'auth', 'spec.md'), '## REQ-001: Login\n## REQ-002: Logout\n');
    const result = runConverge({ projectRoot: root });

    const { storiesDir } = writeConvergeArtifacts(result, { projectRoot: root, toStories: true });
    expect(storiesDir).toBeDefined();
    expect(storiesDir!).toMatch(/stories\/converge-\d{4}-\d{2}-\d{2}$/);
  });

  it('does not emit stories when there are no gaps', () => {
    const root = projectRoot;
    mkdirSync(join(root, '_wdf_output', 'specs', 'auth'), { recursive: true });
    writeFileSync(join(root, '_wdf_output', 'specs', 'auth', 'spec.md'), '## REQ-001: Login\n');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), '// REQ-001 done\n');
    const result = runConverge({ projectRoot: root });

    const { storiesDir } = writeConvergeArtifacts(result, { projectRoot: root, toStories: true });
    expect(storiesDir).toBeUndefined();
  });
});
