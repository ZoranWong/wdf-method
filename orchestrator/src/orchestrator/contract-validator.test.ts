import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  StoryContractValidator,
  parseAcsFromStory,
  scanTestsForAcBindings,
  parseVitestJson,
  parseJestJson,
  validateAcBindings,
  formatAcBindingReport,
  runAcBindingCheck,
  auditAcCoverage,
  formatAuditReport,
  type StoryContract,
  type TestRunResult,
  type TestBinding,
} from './contract-validator.js';

function setupRoot(): string {
  return mkdtempSync(join(tmpdir(), 'wdf-ac-binding-'));
}

// ─── Existing StoryContractValidator (regression coverage) ──────────

describe('StoryContractValidator', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  function full(over: Partial<StoryContract> = {}): StoryContract {
    return {
      story_id: 'STORY-001',
      title: 'Sample',
      scope_write: ['src/index.ts'],
      out_of_scope: ['db migrations'],
      acceptance_checks: ['npm test'],
      code_standards_source: ['AGENTS.md'],
      parallel_safe: true,
      ui_truth_source: 'wireframes.md',
      ...over,
    };
  }

  it('passes a fully populated contract', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    const v = new StoryContractValidator(root);
    // npm test is rejected as too generic; supply a concrete check.
    const r = v.validate(full({ acceptance_checks: ['npx vitest run'] }));
    expect(r.passed).toBe(true);
  });

  it('flags placeholder acceptance_checks', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    const v = new StoryContractValidator(root);
    const r = v.validate(full({ acceptance_checks: ['todo'] }));
    expect(r.passed).toBe(false);
    expect(r.missing_fields.some(m => m.startsWith('acceptance_checks'))).toBe(true);
  });

  it('flags missing out_of_scope', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    const v = new StoryContractValidator(root);
    const r = v.validate(full({ out_of_scope: [], acceptance_checks: ['npx vitest run'] }));
    expect(r.passed).toBe(false);
    expect(r.missing_fields).toContain('out_of_scope');
  });
});

// ─── parseAcsFromStory ──────────────────────────────────────────────

describe('parseAcsFromStory', () => {
  it('parses inline list', () => {
    const md = `---\nstory_id: S-1\nacceptance_criteria: [AC-1, AC-2, AC-3]\n---\nbody`;
    const acs = parseAcsFromStory(md);
    expect(acs.map(a => a.id)).toEqual(['AC-1', 'AC-2', 'AC-3']);
  });

  it('parses block list with bare IDs', () => {
    const md = `---\nstory_id: S-1\nacceptance_criteria:\n  - AC-1\n  - AC-2\n---\n`;
    expect(parseAcsFromStory(md).map(a => a.id)).toEqual(['AC-1', 'AC-2']);
  });

  it('parses block list with descriptions', () => {
    const md = `---\nacceptance_criteria:\n  - AC-1: validates input\n  - AC-2: returns 401 on bad token\n---\n`;
    const acs = parseAcsFromStory(md);
    expect(acs[0]).toEqual({ id: 'AC-1', description: 'validates input' });
    expect(acs[1].description).toBe('returns 401 on bad token');
  });

  it('returns empty array when no frontmatter', () => {
    expect(parseAcsFromStory('# title\n\nbody')).toEqual([]);
  });

  it('returns empty array when no acceptance_criteria', () => {
    expect(parseAcsFromStory(`---\nstory_id: S-1\n---\n`)).toEqual([]);
  });

  it('normalises ID casing and AC1 → AC-1', () => {
    const md = `---\nacceptance_criteria: [ac-1, AC2]\n---`;
    expect(parseAcsFromStory(md).map(a => a.id)).toEqual(['AC-1', 'AC-2']);
  });
});

// ─── scanTestsForAcBindings ─────────────────────────────────────────

describe('scanTestsForAcBindings', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('detects name-prefix bindings', () => {
    writeFileSync(join(root, 'a.test.ts'),
      `it('AC-1: validates input', () => {});\ntest('AC-2: rejects bad', () => {});\n`);
    const bindings = scanTestsForAcBindings({ roots: [root], projectRoot: root });
    expect(bindings).toHaveLength(2);
    expect(bindings[0].ac_id).toBe('AC-1');
    expect(bindings[0].binding_kind).toBe('name_prefix');
    expect(bindings[1].ac_id).toBe('AC-2');
  });

  it('detects comment annotation bindings', () => {
    writeFileSync(join(root, 'a.test.ts'),
      `// @ac AC-3\nit('does the thing', () => {});\n`);
    const bindings = scanTestsForAcBindings({ roots: [root], projectRoot: root });
    expect(bindings).toHaveLength(1);
    expect(bindings[0].ac_id).toBe('AC-3');
    expect(bindings[0].binding_kind).toBe('comment_annotation');
    expect(bindings[0].test_name).toBe('does the thing');
  });

  it('finds annotation across blank lines (within 5 lines)', () => {
    writeFileSync(join(root, 'a.test.ts'),
      `// @ac AC-7\n\n// helpful comment\nit('after blanks', () => {});\n`);
    const bindings = scanTestsForAcBindings({ roots: [root], projectRoot: root });
    expect(bindings).toHaveLength(1);
    expect(bindings[0].ac_id).toBe('AC-7');
  });

  it('skips ignored directories', () => {
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'pkg.test.js'),
      `it('AC-1: should be ignored', () => {});`);
    expect(scanTestsForAcBindings({ roots: [root], projectRoot: root })).toHaveLength(0);
  });

  it('handles describe.each / it.skip / test.only suffixes', () => {
    writeFileSync(join(root, 'a.test.ts'),
      `it.skip('AC-9: pending', () => {});\ntest.only('AC-10: focused', () => {});\n`);
    const bindings = scanTestsForAcBindings({ roots: [root], projectRoot: root });
    expect(bindings.map(b => b.ac_id)).toEqual(['AC-9', 'AC-10']);
  });
});

// ─── Reporter parsers ───────────────────────────────────────────────

describe('parseVitestJson / parseJestJson', () => {
  it('extracts test names and statuses', () => {
    const json = {
      testResults: [{
        name: '/p/a.test.ts',
        assertionResults: [
          { title: 'AC-1: validates input', status: 'passed', duration: 12 },
          { title: 'AC-2: rejects bad', status: 'failed', failureMessages: ['oops'] },
        ],
      }],
    };
    const r = parseVitestJson(json);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ test_name: 'AC-1: validates input', status: 'passed' });
    expect(r[1].failure_message).toBe('oops');
  });

  it('maps pending → skipped, todo → todo', () => {
    const r = parseJestJson({
      testResults: [{
        assertionResults: [
          { title: 'a', status: 'pending' },
          { title: 'b', status: 'todo' },
        ],
      }],
    });
    expect(r[0].status).toBe('skipped');
    expect(r[1].status).toBe('todo');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseVitestJson('not json{')).toThrow(/parse error/);
  });

  it('throws when testResults missing', () => {
    expect(() => parseVitestJson({})).toThrow(/missing testResults/);
  });
});

// ─── validateAcBindings — the proposal §5 scenarios ─────────────────

describe('validateAcBindings', () => {
  it('proposal §5: 5 ACs, 4 bound, 1 unbound → precise report', () => {
    const acs = ['AC-1', 'AC-2', 'AC-3', 'AC-4', 'AC-5'].map(id => ({ id }));
    const bindings: TestBinding[] = (['AC-1', 'AC-2', 'AC-3', 'AC-4'] as const).map((id, i) => ({
      ac_id: id, test_name: `${id}: t${i}`, file: 't.test.ts', line: i + 1,
      binding_kind: 'name_prefix' as const,
    }));
    const test_results: TestRunResult[] = bindings.map(b => ({
      test_name: b.test_name, status: 'passed' as const,
    }));
    const r = validateAcBindings({ story_id: 'S-1', acs, bindings, test_results });
    expect(r.unbound_acs).toEqual(['AC-5']);
    expect(r.failing_acs).toEqual([]);
    expect(r.all_pass).toBe(false);
  });

  it('marks AC failing when its bound test failed', () => {
    const acs = [{ id: 'AC-1' }];
    const bindings: TestBinding[] = [{
      ac_id: 'AC-1', test_name: 'AC-1: x', file: 't.test.ts', line: 1,
      binding_kind: 'name_prefix',
    }];
    const test_results: TestRunResult[] = [{ test_name: 'AC-1: x', status: 'failed' }];
    const r = validateAcBindings({ story_id: 'S-1', acs, bindings, test_results });
    expect(r.failing_acs).toEqual(['AC-1']);
    expect(r.all_pass).toBe(false);
  });

  it('marks AC skipped when only skipped tests bound', () => {
    const acs = [{ id: 'AC-1' }];
    const bindings: TestBinding[] = [{
      ac_id: 'AC-1', test_name: 'AC-1: x', file: 't.test.ts', line: 1,
      binding_kind: 'name_prefix',
    }];
    const test_results: TestRunResult[] = [{ test_name: 'AC-1: x', status: 'skipped' }];
    const r = validateAcBindings({ story_id: 'S-1', acs, bindings, test_results });
    expect(r.skipped_acs).toEqual(['AC-1']);
    expect(r.all_pass).toBe(false);
  });

  it('flags unknown bindings (test refers to AC not on story)', () => {
    const acs = [{ id: 'AC-1' }];
    const bindings: TestBinding[] = [
      { ac_id: 'AC-1', test_name: 'a', file: 'f', line: 1, binding_kind: 'name_prefix' },
      { ac_id: 'AC-9', test_name: 'b', file: 'f', line: 2, binding_kind: 'name_prefix' },
    ];
    const test_results: TestRunResult[] = [
      { test_name: 'a', status: 'passed' },
      { test_name: 'b', status: 'passed' },
    ];
    const r = validateAcBindings({ story_id: 'S-1', acs, bindings, test_results });
    expect(r.unknown_bindings).toHaveLength(1);
    expect(r.unknown_bindings[0].ac_id).toBe('AC-9');
    expect(r.all_pass).toBe(false);
  });

  it('all_pass true when every AC has a passing bound test', () => {
    const acs = [{ id: 'AC-1' }, { id: 'AC-2' }];
    const bindings: TestBinding[] = [
      { ac_id: 'AC-1', test_name: 'AC-1: x', file: 'f', line: 1, binding_kind: 'name_prefix' },
      { ac_id: 'AC-2', test_name: 'AC-2: y', file: 'f', line: 2, binding_kind: 'name_prefix' },
    ];
    const test_results: TestRunResult[] = [
      { test_name: 'AC-1: x', status: 'passed' },
      { test_name: 'AC-2: y', status: 'passed' },
    ];
    expect(validateAcBindings({ story_id: 'S-1', acs, bindings, test_results }).all_pass).toBe(true);
  });

  it('detects missing test_results — bound but never ran (fail-closed)', () => {
    const acs = [{ id: 'AC-1' }];
    const bindings: TestBinding[] = [{
      ac_id: 'AC-1', test_name: 'AC-1: x', file: 'f', line: 1, binding_kind: 'name_prefix',
    }];
    const r = validateAcBindings({ story_id: 'S-1', acs, bindings, test_results: [] });
    expect(r.failing_acs).toContain('AC-1');
    expect(r.missing_test_results).toHaveLength(1);
  });

  it('matches results by suffix when describe-prefixed', () => {
    const acs = [{ id: 'AC-1' }];
    const bindings: TestBinding[] = [{
      ac_id: 'AC-1', test_name: 'AC-1: x', file: 'f', line: 1, binding_kind: 'name_prefix',
    }];
    const test_results: TestRunResult[] = [
      { test_name: 'auth > AC-1: x', status: 'passed' },
    ];
    expect(validateAcBindings({ story_id: 'S-1', acs, bindings, test_results }).all_pass).toBe(true);
  });
});

// ─── formatter ───────────────────────────────────────────────────────

describe('formatAcBindingReport', () => {
  it('renders pass / fail / unbound lines', () => {
    const out = formatAcBindingReport({
      story_id: 'S-1',
      acs: [{ id: 'AC-1' }, { id: 'AC-2' }, { id: 'AC-3' }],
      bindings: [
        { ac_id: 'AC-1', test_name: 't1', file: 'a', line: 1, binding_kind: 'name_prefix' },
        { ac_id: 'AC-2', test_name: 't2', file: 'a', line: 2, binding_kind: 'name_prefix' },
      ],
      unbound_acs: ['AC-3'],
      failing_acs: ['AC-2'],
      skipped_acs: [],
      unknown_bindings: [],
      missing_test_results: [],
      all_pass: false,
    });
    expect(out).toContain('AC-1 — OK');
    expect(out).toContain('AC-2 — FAILING');
    expect(out).toContain('AC-3 — UNBOUND');
    expect(out).toContain('BLOCKED');
  });
});

// ─── runAcBindingCheck (end-to-end with injected reporter JSON) ─────

describe('runAcBindingCheck', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('joins story ACs + scanner bindings + reporter JSON', async () => {
    const storyPath = join(root, 'STORY-001.md');
    writeFileSync(storyPath, [
      '---',
      'story_id: STORY-001',
      'acceptance_criteria: [AC-1, AC-2, AC-3]',
      '---',
      '# Story',
    ].join('\n'));

    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests', 'a.test.ts'),
      `it('AC-1: x', () => {});\nit('AC-2: y', () => {});\n`);

    const reporterJson = {
      testResults: [{
        name: '/tests/a.test.ts',
        assertionResults: [
          { title: 'AC-1: x', status: 'passed' },
          { title: 'AC-2: y', status: 'failed', failureMessages: ['oops'] },
        ],
      }],
    };

    const r = await runAcBindingCheck({
      storyPath,
      testRoots: [join(root, 'tests')],
      projectRoot: root,
      reporterJson,
    });

    expect(r.report.story_id).toBe('STORY-001');
    expect(r.report.unbound_acs).toEqual(['AC-3']);
    expect(r.report.failing_acs).toEqual(['AC-2']);
    expect(r.report.all_pass).toBe(false);
    expect(r.exit_code).toBe(0);
  });

  it('throws on missing story file', async () => {
    await expect(runAcBindingCheck({
      storyPath: join(root, 'nope.md'),
      testRoots: [],
      projectRoot: root,
      reporterJson: { testResults: [] },
    })).rejects.toThrow(/story file not found/);
  });

  it('derives story_id from filename when frontmatter omits it', async () => {
    const storyPath = join(root, 'derive-from-name.md');
    writeFileSync(storyPath, `---\nacceptance_criteria: [AC-1]\n---\n`);
    writeFileSync(join(root, 'a.test.ts'), `it('AC-1: x', () => {});`);
    const r = await runAcBindingCheck({
      storyPath,
      testRoots: [root],
      projectRoot: root,
      reporterJson: { testResults: [{ assertionResults: [{ title: 'AC-1: x', status: 'passed' }] }] },
    });
    expect(r.report.story_id).toBe('derive-from-name');
    expect(r.report.all_pass).toBe(true);
  });
});

// ─── auditAcCoverage (codemod / report-only) ────────────────────────

describe('auditAcCoverage', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('produces unbound, unannotated, and unknown suggestions', () => {
    const storyPath = join(root, 'STORY.md');
    writeFileSync(storyPath, [
      '---',
      'story_id: STORY-099',
      'acceptance_criteria: [AC-1, AC-2]',
      '---',
    ].join('\n'));
    writeFileSync(join(root, 'a.test.ts'), [
      `it('AC-1: bound', () => {});`,
      `it('AC-9: bound to unknown AC', () => {});`,
      `it('plain test missing annotation', () => {});`,
    ].join('\n'));

    const r = auditAcCoverage({
      storyPath,
      testRoots: [root],
      projectRoot: root,
    });

    expect(r.declared_acs.map(a => a.id)).toEqual(['AC-1', 'AC-2']);
    expect(r.found_bindings).toHaveLength(2);
    const kinds = r.suggestions.map(s => s.kind);
    expect(kinds).toContain('unbound_ac');
    expect(kinds).toContain('unknown_binding');
    expect(kinds).toContain('unannotated_test');
  });

  it('clean project produces no suggestions', () => {
    const storyPath = join(root, 'S.md');
    writeFileSync(storyPath, `---\nacceptance_criteria: [AC-1]\n---`);
    writeFileSync(join(root, 'a.test.ts'), `it('AC-1: only', () => {});`);
    const r = auditAcCoverage({ storyPath, testRoots: [root], projectRoot: root });
    expect(r.suggestions).toHaveLength(0);
  });

  it('formatAuditReport renders the suggestion list', () => {
    const out = formatAuditReport({
      story_id: 'S-1',
      declared_acs: [{ id: 'AC-1' }],
      found_bindings: [],
      suggestions: [{
        kind: 'unbound_ac',
        message: 'AC-1 has no bound test',
        hint: 'Add a test named "AC-1: ..."',
      }],
    });
    expect(out).toContain('UNBOUND');
    expect(out).toContain('AC-1');
  });
});
