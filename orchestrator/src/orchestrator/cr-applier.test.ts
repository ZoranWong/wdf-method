import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadDelta,
  validateDelta,
  planApply,
  planApplyV1,
  planApplyV2,
  applyPlan,
  applyDelta,
  archiveAndRewrite,
  maybeCascadeSpecsSync,
  unifiedDiff,
  summarizePlan,
  DeltaApplyError,
  isV2Operation,
  type Delta,
  type V2Operation,
} from './cr-applier.js';
import { parseSpecDoc } from './spec-sync.js';

function setupRoot(): string {
  return mkdtempSync(join(tmpdir(), 'wdf-cr-applier-'));
}

function writeDelta(root: string, delta: object): string {
  const path = join(root, 'delta.yaml');
  // Serialize via a tiny YAML emitter; for tests we keep it simple
  // by writing JSON which YAML accepts as a superset.
  writeFileSync(path, JSON.stringify(delta, null, 2), 'utf8');
  return path;
}

const MIN_HEADER = {
  change_id: 'CHG-2026-100',
  summary: 'test',
  base_version: '3.6.0',
  target_version: '3.7.0',
};

describe('cr-applier — validateDelta', () => {
  it('rejects non-object input', () => {
    expect(() => validateDelta('not an object')).toThrow(/must be a YAML mapping/);
  });

  it('rejects missing required fields', () => {
    expect(() => validateDelta({ ...MIN_HEADER })).toThrow(/missing required field 'operations'/);
  });

  it('rejects malformed change_id', () => {
    expect(() => validateDelta({ ...MIN_HEADER, change_id: 'bad', operations: [{}] }))
      .toThrow(/change_id must match/);
  });

  it('rejects empty operations array', () => {
    expect(() => validateDelta({ ...MIN_HEADER, operations: [] }))
      .toThrow(/non-empty array/);
  });

  it('rejects unknown op type', () => {
    expect(() => validateDelta({
      ...MIN_HEADER,
      operations: [{ op: 'mutate', target: { kind: 'toml_key', file: 'a.toml', path: 'x' } }],
    })).toThrow(/unknown op 'mutate'/);
  });

  it('rejects mismatched op/target kind', () => {
    expect(() => validateDelta({
      ...MIN_HEADER,
      operations: [{ op: 'create', target: { kind: 'toml_key', file: 'a.toml', path: 'x' }, content: '' }],
    })).toThrow(/op 'create' not allowed for target.kind 'toml_key'/);
  });

  it('rejects path traversal', () => {
    expect(() => validateDelta({
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'toml_key', file: '../etc/passwd', path: 'x' }, value: 1 }],
    })).toThrow(/must be a relative path without/);
  });

  it('rejects absolute paths', () => {
    expect(() => validateDelta({
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'toml_key', file: '/etc/x', path: 'x' }, value: 1 }],
    })).toThrow(/relative path/);
  });

  it('accepts a well-formed delta', () => {
    const delta = validateDelta({
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'toml_key', file: 'a.toml', path: 'x' }, value: 1 }],
    });
    expect(delta.change_id).toBe('CHG-2026-100');
    expect(delta.operations).toHaveLength(1);
  });
});

describe('cr-applier — TOML set/remove', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('sets an existing top-level key preserving formatting', () => {
    writeFileSync(join(root, 'c.toml'), `# comment\nname = "old"\nflag = true\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'toml_key', file: 'c.toml', path: 'name' }, value: 'new' }],
    };
    const plan = planApply(delta, root);
    applyPlan(plan);
    const out = readFileSync(join(root, 'c.toml'), 'utf8');
    expect(out).toBe(`# comment\nname = "new"\nflag = true\n`);
  });

  it('sets a nested section key', () => {
    writeFileSync(join(root, 'c.toml'), `[a.b]\nkey = 1\nkey2 = 2\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'toml_key', file: 'c.toml', path: 'a.b.key' }, value: 99 }],
    };
    applyPlan(planApply(delta, root));
    const out = readFileSync(join(root, 'c.toml'), 'utf8');
    expect(out).toContain('key = 99');
    expect(out).toContain('key2 = 2');
  });

  it('inserts a new key into an existing section', () => {
    writeFileSync(join(root, 'c.toml'), `[a]\nexisting = 1\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'toml_key', file: 'c.toml', path: 'a.added' }, value: 'hi' }],
    };
    applyPlan(planApply(delta, root));
    const out = readFileSync(join(root, 'c.toml'), 'utf8');
    expect(out).toContain('existing = 1');
    expect(out).toContain('added = "hi"');
  });

  it('removes a key', () => {
    writeFileSync(join(root, 'c.toml'), `[a]\nkeep = 1\ndrop = 2\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'remove', target: { kind: 'toml_key', file: 'c.toml', path: 'a.drop' } }],
    };
    applyPlan(planApply(delta, root));
    const out = readFileSync(join(root, 'c.toml'), 'utf8');
    expect(out).toContain('keep = 1');
    expect(out).not.toContain('drop');
  });

  it('throws when removing a missing key', () => {
    writeFileSync(join(root, 'c.toml'), `[a]\nkeep = 1\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'remove', target: { kind: 'toml_key', file: 'c.toml', path: 'a.missing' } }],
    };
    expect(() => planApply(delta, root)).toThrow(DeltaApplyError);
  });

  it('handles boolean and array literals', () => {
    writeFileSync(join(root, 'c.toml'), `flag = false\nlist = []\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [
        { op: 'set', target: { kind: 'toml_key', file: 'c.toml', path: 'flag' }, value: true },
        { op: 'set', target: { kind: 'toml_key', file: 'c.toml', path: 'list' }, value: ['a', 'b'] },
      ],
    };
    applyPlan(planApply(delta, root));
    const out = readFileSync(join(root, 'c.toml'), 'utf8');
    expect(out).toContain('flag = true');
    expect(out).toContain('list = ["a", "b"]');
  });
});

describe('cr-applier — YAML set/remove', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('replaces an existing top-level value', () => {
    writeFileSync(join(root, 'c.yaml'), `name: old\nflag: true\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'yaml_key', file: 'c.yaml', path: 'name' }, value: 'new' }],
    };
    applyPlan(planApply(delta, root));
    const out = readFileSync(join(root, 'c.yaml'), 'utf8');
    expect(out).toContain('name: new');
    expect(out).toContain('flag: true');
  });

  it('replaces a nested key', () => {
    writeFileSync(join(root, 'c.yaml'), `a:\n  b:\n    key: 1\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'yaml_key', file: 'c.yaml', path: 'a.b.key' }, value: 99 }],
    };
    applyPlan(planApply(delta, root));
    const out = readFileSync(join(root, 'c.yaml'), 'utf8');
    expect(out).toContain('key: 99');
  });

  it('removes a key and its nested children', () => {
    writeFileSync(join(root, 'c.yaml'), `keep: 1\ndrop:\n  inner: 2\nlater: 3\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'remove', target: { kind: 'yaml_key', file: 'c.yaml', path: 'drop' } }],
    };
    applyPlan(planApply(delta, root));
    const out = readFileSync(join(root, 'c.yaml'), 'utf8');
    expect(out).toContain('keep: 1');
    expect(out).toContain('later: 3');
    expect(out).not.toContain('drop');
    expect(out).not.toContain('inner');
  });
});

describe('cr-applier — markdown spec_section', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('modifies text inside a section', () => {
    const md = `# Doc\n\n## A\nfoo here\n\n## B\nbar\n`;
    writeFileSync(join(root, 'doc.md'), md, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{
        op: 'modify',
        target: { kind: 'spec_section', file: 'doc.md', section: '## A' },
        before: 'foo here',
        after: 'foo replaced',
      }],
    };
    applyPlan(planApply(delta, root));
    const out = readFileSync(join(root, 'doc.md'), 'utf8');
    expect(out).toContain('foo replaced');
    expect(out).not.toContain('foo here');
    expect(out).toContain('## B\nbar');
  });

  it('appends to a section preserving following sections', () => {
    const md = `## A\nline1\n## B\nb-line\n`;
    writeFileSync(join(root, 'doc.md'), md, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{
        op: 'append',
        target: { kind: 'spec_section', file: 'doc.md', section: '## A' },
        value: 'line2 added',
      }],
    };
    applyPlan(planApply(delta, root));
    const out = readFileSync(join(root, 'doc.md'), 'utf8');
    expect(out).toMatch(/## A[\s\S]*line1[\s\S]*line2 added[\s\S]*## B/);
  });

  it('throws on missing section', () => {
    writeFileSync(join(root, 'doc.md'), `## A\nx\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{
        op: 'modify',
        target: { kind: 'spec_section', file: 'doc.md', section: '## Z' },
        before: 'x', after: 'y',
      }],
    };
    expect(() => planApply(delta, root)).toThrow(/section not found/);
  });

  it('throws on non-unique before text', () => {
    writeFileSync(join(root, 'doc.md'), `## A\ndup\ndup\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{
        op: 'modify',
        target: { kind: 'spec_section', file: 'doc.md', section: '## A' },
        before: 'dup', after: 'unique',
      }],
    };
    expect(() => planApply(delta, root)).toThrow(/not unique/);
  });
});

describe('cr-applier — file create/delete', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('creates a new file', () => {
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{
        op: 'create',
        target: { kind: 'file', file: 'sub/new.md' },
        content: 'hello\n',
      }],
    };
    applyPlan(planApply(delta, root));
    expect(existsSync(join(root, 'sub/new.md'))).toBe(true);
    expect(readFileSync(join(root, 'sub/new.md'), 'utf8')).toBe('hello\n');
  });

  it('refuses to overwrite via create', () => {
    writeFileSync(join(root, 'a.md'), 'old', 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'create', target: { kind: 'file', file: 'a.md' }, content: 'new' }],
    };
    expect(() => planApply(delta, root)).toThrow(/already exists/);
  });

  it('deletes a file', () => {
    writeFileSync(join(root, 'a.md'), 'gone', 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'delete', target: { kind: 'file', file: 'a.md' } }],
    };
    applyPlan(planApply(delta, root));
    expect(existsSync(join(root, 'a.md'))).toBe(false);
  });

  it('refuses to delete a missing file', () => {
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'delete', target: { kind: 'file', file: 'gone.md' } }],
    };
    expect(() => planApply(delta, root)).toThrow(/cannot delete missing/);
  });
});

describe('cr-applier — text_match', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('replaces a unique substring', () => {
    writeFileSync(join(root, 'r.txt'), 'foo bar baz', 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{
        op: 'modify', target: { kind: 'text_match', file: 'r.txt' },
        before: 'bar', after: 'BAR',
      }],
    };
    applyPlan(planApply(delta, root));
    expect(readFileSync(join(root, 'r.txt'), 'utf8')).toBe('foo BAR baz');
  });

  it('refuses non-unique match', () => {
    writeFileSync(join(root, 'r.txt'), 'x x', 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{
        op: 'modify', target: { kind: 'text_match', file: 'r.txt' },
        before: 'x', after: 'y',
      }],
    };
    expect(() => planApply(delta, root)).toThrow(/not unique/);
  });
});

describe('cr-applier — atomicity & expected_hash', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('does not write any file if any op fails', () => {
    writeFileSync(join(root, 'a.toml'), `key = 1\n`, 'utf8');
    writeFileSync(join(root, 'b.toml'), `key = 2\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [
        { op: 'set', target: { kind: 'toml_key', file: 'a.toml', path: 'key' }, value: 99 },
        { op: 'remove', target: { kind: 'toml_key', file: 'b.toml', path: 'doesnotexist' } },
      ],
    };
    expect(() => planApply(delta, root)).toThrow();
    // Original files untouched
    expect(readFileSync(join(root, 'a.toml'), 'utf8')).toBe('key = 1\n');
    expect(readFileSync(join(root, 'b.toml'), 'utf8')).toBe('key = 2\n');
  });

  it('honours expected_hash precondition', () => {
    writeFileSync(join(root, 'a.toml'), `key = 1\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{
        op: 'set', target: { kind: 'toml_key', file: 'a.toml', path: 'key' },
        value: 2,
        expected_hash: 'deadbeef',
      }],
    };
    expect(() => planApply(delta, root)).toThrow(/expected_hash mismatch/);
  });
});

describe('cr-applier — dry-run & summary', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('dry-run does not modify disk', () => {
    writeFileSync(join(root, 'c.toml'), `key = 1\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'toml_key', file: 'c.toml', path: 'key' }, value: 2 }],
    };
    const plan = planApply(delta, root);
    applyPlan(plan, { dryRun: true });
    expect(readFileSync(join(root, 'c.toml'), 'utf8')).toBe('key = 1\n');
  });

  it('summarizePlan lists files and ops', () => {
    writeFileSync(join(root, 'c.toml'), `key = 1\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [{ op: 'set', target: { kind: 'toml_key', file: 'c.toml', path: 'key' }, value: 2 }],
    };
    const plan = planApply(delta, root);
    const s = summarizePlan(plan);
    expect(s).toContain('CHG-2026-100');
    expect(s).toContain('Files affected: 1');
    expect(s).toContain('c.toml');
  });

  it('unifiedDiff produces +/- lines', () => {
    const d = unifiedDiff('x.txt', 'foo\nbar', 'foo\nBAR');
    expect(d).toContain('-bar');
    expect(d).toContain('+BAR');
  });
});

describe('cr-applier — applyDelta end-to-end', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); });

  it('loads delta from disk and applies multiple ops on multiple files', () => {
    writeFileSync(join(root, 'customize.toml'), `[change_request]\ndelta_required = false\n`, 'utf8');
    writeFileSync(join(root, 'SPEC.md'), `# Spec\n\n## 7. CR\nold rule\n\n## 8. Done\n`, 'utf8');
    const delta = {
      ...MIN_HEADER,
      change_id: 'CHG-2026-002',
      summary: 'Spec Delta governance',
      operations: [
        { op: 'set', target: { kind: 'toml_key', file: 'customize.toml', path: 'change_request.delta_required' }, value: true },
        { op: 'modify', target: { kind: 'spec_section', file: 'SPEC.md', section: '## 7. CR' }, before: 'old rule', after: 'new rule' },
      ],
    };
    const deltaPath = writeDelta(root, delta);
    const result = applyDelta(deltaPath, root);
    expect(result.written.sort()).toEqual(['SPEC.md', 'customize.toml']);
    expect(readFileSync(join(root, 'customize.toml'), 'utf8')).toContain('delta_required = true');
    expect(readFileSync(join(root, 'SPEC.md'), 'utf8')).toContain('new rule');
  });

  it('loadDelta throws on missing file', () => {
    expect(() => loadDelta(join(root, 'nope.yaml'))).toThrow(/not found/);
  });
});

// ─────────────────────────────────────────
// CHG-2026-015 S2 — Semantic delta v2
// ─────────────────────────────────────────

const VALID_AUTH_SPEC = `---
artifact_type: spec
domain: auth
version: 1
---

# Spec — Auth

## Requirement: User Registration
- id: REQ-001
- priority: P0

GIVEN a visitor with a valid email
WHEN they submit the registration form
THEN the system MUST create the user record
`;

const V2_HEADER = {
  ...MIN_HEADER,
  change_id: 'CHG-2026-017',
  base_version: '3.9.0',
  target_version: '3.9.1',
  schema_version: 2,
};

function writeAuthSpec(root: string, content = VALID_AUTH_SPEC): void {
  const specsDir = join(root, '_wdf_output', 'specs', 'auth');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, 'spec.md'), content, 'utf8');
}

describe('cr-applier — v2 validateDelta', () => {
  it('rejects schema_version other than 1 or 2', () => {
    expect(() =>
      validateDelta({
        ...V2_HEADER,
        schema_version: 3,
        operations: [{ op: 'ADDED', domain: 'auth', requirement_id: 'REQ-001' }],
      }),
    ).toThrow(/schema_version must be 1 or 2/);
  });

  it('rejects v2 op in v1 delta', () => {
    expect(() =>
      validateDelta({
        ...MIN_HEADER,
        operations: [{ op: 'ADDED', domain: 'auth', requirement_id: 'REQ-001' }],
      }),
    ).toThrow(/v2 op 'ADDED' used with schema_version=1/);
  });

  it('rejects v1 op in v2 delta', () => {
    expect(() =>
      validateDelta({
        ...V2_HEADER,
        operations: [
          { op: 'set', target: { kind: 'toml_key', file: 'customize.toml', path: 'a.b' }, value: 1 },
        ],
      }),
    ).toThrow(/schema_version=2 requires v2 ops/);
  });

  it('rejects v2 REMOVED without requirement_id', () => {
    expect(() =>
      validateDelta({
        ...V2_HEADER,
        operations: [{ op: 'REMOVED', domain: 'auth' }],
      }),
    ).toThrow(/requirement_id required/);
  });

  it('rejects v2 ADDED without requirement object', () => {
    expect(() =>
      validateDelta({
        ...V2_HEADER,
        operations: [{ op: 'ADDED', domain: 'auth' }],
      }),
    ).toThrow(/requirement object required/);
  });

  it('rejects invalid domain names', () => {
    expect(() =>
      validateDelta({
        ...V2_HEADER,
        operations: [
          { op: 'ADDED', domain: 'Auth-Caps', requirement: { name: 'X', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] } },
        ],
      }),
    ).toThrow(/domain must match/);
  });

  it('accepts a valid v2 delta', () => {
    const delta = validateDelta({
      ...V2_HEADER,
      operations: [
        { op: 'ADDED', domain: 'auth', requirement: { id: 'REQ-014', name: 'Password Reset', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] } },
      ],
    });
    expect(delta.schema_version).toBe(2);
    expect(delta.operations.length).toBe(1);
    expect(isV2Operation(delta.operations[0] as V2Operation)).toBe(true);
  });
});

describe('cr-applier — v2 planApplyV2 ADDED', () => {
  let root: string;
  beforeEach(() => {
    root = setupRoot();
    writeAuthSpec(root);
  });

  it('adds a new requirement to an existing spec, sorted by id', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        {
          op: 'ADDED', domain: 'auth',
          requirement: {
            id: 'REQ-014', name: 'Password Reset', priority: 'P1',
            scenarios: [{ given: ['a user'], when: ['they reset'], then: ['the system MUST email a token'] }],
          },
        },
      ],
    };
    const plan = planApplyV2(delta, root);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].action).toBe('write');
    expect(plan.changes[0].ops).toEqual([0]);

    const reparsed = parseSpecDoc(plan.changes[0].after!, 'auth');
    const ids = reparsed.requirements.map(r => r.id);
    expect(ids).toEqual(['REQ-001', 'REQ-014']); // sorted ascending
  });

  it('creates spec.md when domain directory missing (action=create)', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        {
          op: 'ADDED', domain: 'todos',
          requirement: {
            id: 'REQ-050', name: 'Create Todo',
            scenarios: [{ given: ['a user'], when: ['they post a todo'], then: ['the system MUST persist it'] }],
          },
        },
      ],
    };
    const plan = planApplyV2(delta, root);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].action).toBe('create');
    expect(plan.changes[0].before).toBeNull();
    expect(plan.changes[0].after).toMatch(/## Requirement: Create Todo/);
  });

  it('rejects ADDED with duplicate id', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        {
          op: 'ADDED', domain: 'auth',
          requirement: {
            id: 'REQ-001', name: 'Duplicate Registration',
            scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
          },
        },
      ],
    };
    expect(() => planApplyV2(delta, root)).toThrow(DeltaApplyError);
    expect(() => planApplyV2(delta, root)).toThrow(/already exists/);
  });

  it('rejects ADDED with invalid scenario (no RFC 2119)', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        {
          op: 'ADDED', domain: 'auth',
          requirement: {
            id: 'REQ-099', name: 'Weak Outcome',
            scenarios: [{ given: ['a'], when: ['b'], then: ['some weak line'] }],
          },
        },
      ],
    };
    expect(() => planApplyV2(delta, root)).toThrow(/spec validation failed/);
  });
});

describe('cr-applier — v2 planApplyV2 MODIFIED', () => {
  let root: string;
  beforeEach(() => {
    root = setupRoot();
    writeAuthSpec(root);
  });

  it('REPLACES scenarios on MODIFIED (wholesale replacement)', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        {
          op: 'MODIFIED', domain: 'auth',
          requirement: {
            id: 'REQ-001', name: 'User Registration',
            scenarios: [
              { given: ['new precondition'], when: ['new trigger'], then: ['the system MUST do something else'] },
            ],
          },
        },
      ],
    };
    const plan = planApplyV2(delta, root);
    const reparsed = parseSpecDoc(plan.changes[0].after!, 'auth');
    expect(reparsed.requirements).toHaveLength(1);
    expect(reparsed.requirements[0].scenarios).toHaveLength(1);
    expect(reparsed.requirements[0].scenarios[0].given[0]).toBe('new precondition');
  });

  it('rejects MODIFIED on missing id', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        {
          op: 'MODIFIED', domain: 'auth',
          requirement: {
            id: 'REQ-404', name: 'Ghost',
            scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
          },
        },
      ],
    };
    expect(() => planApplyV2(delta, root)).toThrow(/not found/);
  });
});

describe('cr-applier — v2 planApplyV2 REMOVED', () => {
  let root: string;
  beforeEach(() => {
    root = setupRoot();
    writeAuthSpec(root);
  });

  it('deletes the requirement block by id', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [{ op: 'REMOVED', domain: 'auth', requirement_id: 'REQ-001' }],
    };
    const plan = planApplyV2(delta, root);
    const reparsed = parseSpecDoc(plan.changes[0].after!, 'auth');
    expect(reparsed.requirements.map(r => r.id)).not.toContain('REQ-001');
  });

  it('rejects REMOVED on missing id', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [{ op: 'REMOVED', domain: 'auth', requirement_id: 'REQ-404' }],
    };
    expect(() => planApplyV2(delta, root)).toThrow(/not found/);
  });
});

describe('cr-applier — v2 atomicity', () => {
  let root: string;
  beforeEach(() => {
    root = setupRoot();
    writeAuthSpec(root);
  });

  it('op#0 ADDED valid, op#1 ADDED duplicate → no file change', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        {
          op: 'ADDED', domain: 'auth',
          requirement: { id: 'REQ-014', name: 'First', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] },
        },
        {
          op: 'ADDED', domain: 'auth',
          requirement: { id: 'REQ-014', name: 'Second', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] },
        },
      ],
    };
    expect(() => planApplyV2(delta, root)).toThrow(/already exists/);
    // Nothing was written to disk
    expect(readFileSync(join(root, '_wdf_output/specs/auth/spec.md'), 'utf8'))
      .toBe(VALID_AUTH_SPEC);
  });
});

describe('cr-applier — v2 top-level planApply dispatch', () => {
  let root: string;
  beforeEach(() => {
    root = setupRoot();
  });

  it('routes v1 delta to planApplyV1 (no schema_version)', () => {
    writeFileSync(join(root, 'customize.toml'), `[change_request]\ndelta_required = false\n`, 'utf8');
    const delta: Delta = {
      change_id: 'CHG-2026-100',
      summary: 'v1',
      base_version: '3.9.0',
      target_version: '3.9.1',
      operations: [
        { op: 'set', target: { kind: 'toml_key', file: 'customize.toml', path: 'change_request.delta_required' }, value: true },
      ],
    } as unknown as Delta;
    const plan = planApply(delta, root);
    expect(plan.changes[0].relPath).toBe('customize.toml');
  });

  it('routes v2 delta to planApplyV2', () => {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        { op: 'ADDED', domain: 'auth', requirement: { id: 'REQ-001', name: 'Xyz Abc', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] } },
      ],
    };
    const plan = planApply(delta, root);
    expect(plan.changes[0].relPath).toBe('_wdf_output/specs/auth/spec.md');
  });

  it('v1 regression: planApplyV1 still rejects v2 ops', () => {
    const delta = {
      ...V2_HEADER,
      operations: [{ op: 'ADDED', domain: 'auth', requirement_id: 'REQ-001' }],
    } as unknown as Delta;
    // Calling v1 directly with a v2 op should fail when trying to access target.file
    expect(() => planApplyV1(delta, root)).toThrow();
  });
});

describe('cr-applier — maybeCascadeSpecsSync', () => {
  let root: string;
  beforeEach(() => {
    root = setupRoot();
    writeAuthSpec(root);
  });

  it('returns empty when plan touched no specs/', () => {
    writeFileSync(join(root, 'customize.toml'), `[change_request]\ndelta_required = false\n`, 'utf8');
    const delta: Delta = {
      ...MIN_HEADER,
      operations: [
        { op: 'set', target: { kind: 'toml_key', file: 'customize.toml', path: 'change_request.delta_required' }, value: true },
      ],
    } as unknown as Delta;
    const plan = planApplyV1(delta, root);
    const cascade = maybeCascadeSpecsSync(root, plan, false);
    expect(cascade.cascadeWrites).toEqual([]);
    expect(cascade.warning).toBeUndefined();
  });

  it('returns warning (no writes) when source_of_truth=false', () => {
    // Explicit override: CHG-2026-015 S6 flipped the default to true, so tests
    // covering the false path must set it explicitly.
    writeFileSync(join(root, 'customize.toml'), `[specs]\nsource_of_truth = false\n`, 'utf8');
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        { op: 'ADDED', domain: 'auth', requirement: { id: 'REQ-014', name: 'Xyz Abc', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] } },
      ],
    };
    const plan = planApplyV2(delta, root);
    applyPlan(plan); // actually write the spec
    const cascade = maybeCascadeSpecsSync(root, plan, false);
    expect(cascade.cascadeWrites).toEqual([]);
    expect(cascade.warning).toMatch(/source_of_truth/);
  });

  it('regenerates PRD when source_of_truth=true', () => {
    // Flip the flag
    writeFileSync(join(root, 'customize.toml'), `[specs]\nsource_of_truth = true\n`, 'utf8');
    // Seed a PRD with the section we expect to regenerate
    writeFileSync(
      join(root, '_wdf_output', 'prd.md'),
      `# PRD\n\n## 2. Functional Requirements\n\n(old content)\n\n## 3. Next\n`,
      'utf8',
    );
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        { op: 'ADDED', domain: 'auth', requirement: { id: 'REQ-014', name: 'Password Reset', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] } },
      ],
    };
    const plan = planApplyV2(delta, root);
    applyPlan(plan); // actually write the spec
    const cascade = maybeCascadeSpecsSync(root, plan, false);
    expect(cascade.cascadeWrites).toContain('_wdf_output/prd.md');
    const updatedPrd = readFileSync(join(root, '_wdf_output', 'prd.md'), 'utf8');
    expect(updatedPrd).toMatch(/Password Reset/);
    expect(updatedPrd).not.toMatch(/\(old content\)/);
  });
});

describe('cr-applier — v2 archiveAndRewrite interop', () => {
  let root: string;
  beforeEach(() => {
    root = setupRoot();
    writeAuthSpec(root);
    // Seed changes/CHG-2026-017-demo/ with a v2 delta
    const crDir = join(root, 'changes', 'CHG-2026-017-demo');
    mkdirSync(crDir, { recursive: true });
    writeFileSync(
      join(crDir, 'delta.yaml'),
      JSON.stringify({
        ...V2_HEADER,
        operations: [
          { op: 'ADDED', domain: 'auth', requirement: { id: 'REQ-014', name: 'Password Reset', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] } },
        ],
      }),
      'utf8',
    );
  });

  it('source_of_truth=false: archives, writes spec, returns cascade warning', async () => {
    // Explicit override: S6 default is true.
    writeFileSync(join(root, 'customize.toml'), `[specs]\nsource_of_truth = false\n`, 'utf8');
    const result = await archiveAndRewrite('CHG-2026-017', root);
    expect(result.patched).toContain('_wdf_output/specs/auth/spec.md');
    expect(result.cascadeWarning).toMatch(/source_of_truth/);
    expect(result.archived).toMatch(/CHG-2026-017-demo/);
    // Spec file actually has the new requirement
    const updated = readFileSync(join(root, '_wdf_output/specs/auth/spec.md'), 'utf8');
    expect(updated).toMatch(/Password Reset/);
  });

  it('source_of_truth=true: archives, writes spec + PRD, no warning', async () => {
    writeFileSync(join(root, 'customize.toml'), `[specs]\nsource_of_truth = true\n`, 'utf8');
    writeFileSync(
      join(root, '_wdf_output', 'prd.md'),
      `# PRD\n\n## 2. Functional Requirements\n\n(stale)\n\n## 3. Next\n`,
      'utf8',
    );
    writeFileSync(
      join(root, '_wdf_output', 'api-spec.yaml'),
      `openapi: 3.0.3\ninfo:\n  title: t\n  version: 0.1.0\n# wdf:specs-sync:start\n# wdf:specs-sync:end\n`,
      'utf8',
    );
    writeFileSync(
      join(root, '_wdf_output', 'db-schema.md'),
      `# DB\n\n<!-- wdf:specs-sync:start -->\n<!-- wdf:specs-sync:end -->\n`,
      'utf8',
    );
    const result = await archiveAndRewrite('CHG-2026-017', root);
    expect(result.patched).toContain('_wdf_output/specs/auth/spec.md');
    expect(result.patched).toContain('_wdf_output/prd.md');
    expect(result.cascadeWarning).toBeUndefined();
    const updatedPrd = readFileSync(join(root, '_wdf_output', 'prd.md'), 'utf8');
    expect(updatedPrd).toMatch(/Password Reset/);
  });

  it('dry-run: does not write spec or move archive', async () => {
    const result = await archiveAndRewrite('CHG-2026-017', root, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(existsSync(join(root, 'changes', '_archive'))).toBe(false);
    const originalSpec = readFileSync(join(root, '_wdf_output/specs/auth/spec.md'), 'utf8');
    expect(originalSpec).toBe(VALID_AUTH_SPEC);
  });
});

// ─────────────────────────────────────────
// CHG-2026-015 S3 — per-target cascade flags + structural cascade interop
// ─────────────────────────────────────────

describe('cr-applier — S3 per-target cascade flags', () => {
  let root: string;
  beforeEach(() => {
    root = setupRoot();
    writeAuthSpec(root);
    writeFileSync(join(root, 'customize.toml'), `[specs]\nsource_of_truth = true\n`, 'utf8');
    writeFileSync(
      join(root, '_wdf_output', 'prd.md'),
      `# PRD\n\n## 2. Functional Requirements\n\n(old)\n\n## 3. Next\n`,
      'utf8',
    );
    writeFileSync(
      join(root, '_wdf_output', 'api-spec.yaml'),
      `openapi: 3.0.3\ninfo:\n  title: x\n  version: '1'\n`,
      'utf8',
    );
    writeFileSync(
      join(root, '_wdf_output', 'db-schema.md'),
      `# DB Schema\n`,
      'utf8',
    );
  });

  function buildPlan(): void {
    const delta: Delta = {
      ...V2_HEADER,
      operations: [
        {
          op: 'ADDED', domain: 'auth',
          requirement: {
            id: 'REQ-014', name: 'Password Reset',
            scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
            endpoints: [{ method: 'POST', path: '/auth/password-reset', operationId: 'requestPasswordReset', response: '202 Ack' }],
            entities: [{ name: 'PasswordResetToken', fields: [{ name: 'token', type: 'TEXT', constraints: ['pk'] }] }],
          },
        },
      ],
    };
    const plan = planApplyV2(delta, root);
    applyPlan(plan);
  }

  it('--no-prd-regen skips PRD write but writes api + db', () => {
    buildPlan();
    // Replicate by directly calling maybeCascadeSpecsSync with flag
    const plan = {
      delta: {} as Delta,
      changes: [{
        file: join(root, '_wdf_output/specs/auth/spec.md'),
        relPath: '_wdf_output/specs/auth/spec.md',
        action: 'write' as const,
        before: '', after: '',
        ops: [0],
      }],
      dryRun: false,
    };
    const cascade = maybeCascadeSpecsSync(root, plan, false, { noPrdRegen: true });
    expect(cascade.cascadeWrites).not.toContain('_wdf_output/prd.md');
    expect(cascade.cascadeWrites).toContain('_wdf_output/api-spec.yaml');
    expect(cascade.cascadeWrites).toContain('_wdf_output/db-schema.md');
  });

  it('--no-api-regen skips api-spec.yaml but writes PRD + db', () => {
    buildPlan();
    const plan = {
      delta: {} as Delta,
      changes: [{
        file: join(root, '_wdf_output/specs/auth/spec.md'),
        relPath: '_wdf_output/specs/auth/spec.md',
        action: 'write' as const,
        before: '', after: '',
        ops: [0],
      }],
      dryRun: false,
    };
    const cascade = maybeCascadeSpecsSync(root, plan, false, { noApiRegen: true });
    expect(cascade.cascadeWrites).toContain('_wdf_output/prd.md');
    expect(cascade.cascadeWrites).not.toContain('_wdf_output/api-spec.yaml');
    expect(cascade.cascadeWrites).toContain('_wdf_output/db-schema.md');
  });

  it('--no-db-regen skips db-schema.md but writes PRD + api', () => {
    buildPlan();
    const plan = {
      delta: {} as Delta,
      changes: [{
        file: join(root, '_wdf_output/specs/auth/spec.md'),
        relPath: '_wdf_output/specs/auth/spec.md',
        action: 'write' as const,
        before: '', after: '',
        ops: [0],
      }],
      dryRun: false,
    };
    const cascade = maybeCascadeSpecsSync(root, plan, false, { noDbRegen: true });
    expect(cascade.cascadeWrites).toContain('_wdf_output/prd.md');
    expect(cascade.cascadeWrites).toContain('_wdf_output/api-spec.yaml');
    expect(cascade.cascadeWrites).not.toContain('_wdf_output/db-schema.md');
  });
});

describe('cr-applier — S3 structural cascade end-to-end (archiveAndRewrite)', () => {
  let root: string;
  beforeEach(() => {
    root = setupRoot();
    writeAuthSpec(root);
    writeFileSync(join(root, 'customize.toml'), `[specs]\nsource_of_truth = true\n`, 'utf8');
    writeFileSync(
      join(root, '_wdf_output', 'prd.md'),
      `# PRD\n\n## 2. Functional Requirements\n\n(stale)\n\n## 3. Next\n`,
      'utf8',
    );
    writeFileSync(
      join(root, '_wdf_output', 'api-spec.yaml'),
      `openapi: 3.0.3\ninfo:\n  title: x\n  version: '1'\n`,
      'utf8',
    );
    writeFileSync(
      join(root, '_wdf_output', 'db-schema.md'),
      `# DB Schema\n`,
      'utf8',
    );
    const crDir = join(root, 'changes', 'CHG-2026-017-demo');
    mkdirSync(crDir, { recursive: true });
    writeFileSync(
      join(crDir, 'delta.yaml'),
      JSON.stringify({
        ...V2_HEADER,
        operations: [
          {
            op: 'ADDED', domain: 'auth',
            requirement: {
              id: 'REQ-014', name: 'Password Reset',
              scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
              endpoints: [{ method: 'POST', path: '/auth/password-reset', operationId: 'requestPasswordReset', response: '202 Ack' }],
              entities: [{ name: 'PasswordResetToken', fields: [{ name: 'token', type: 'TEXT', constraints: ['pk'] }] }],
            },
          },
        ],
      }),
      'utf8',
    );
  });

  it('cascades to all three artifacts (PRD + api + db) on full archive', async () => {
    const result = await archiveAndRewrite('CHG-2026-017', root);
    expect(result.patched).toContain('_wdf_output/specs/auth/spec.md');
    expect(result.patched).toContain('_wdf_output/prd.md');
    expect(result.patched).toContain('_wdf_output/api-spec.yaml');
    expect(result.patched).toContain('_wdf_output/db-schema.md');
    // Verify content actually regenerated
    expect(readFileSync(join(root, '_wdf_output/prd.md'), 'utf8')).toMatch(/Password Reset/);
    expect(readFileSync(join(root, '_wdf_output/api-spec.yaml'), 'utf8')).toMatch(/requestPasswordReset/);
    expect(readFileSync(join(root, '_wdf_output/db-schema.md'), 'utf8')).toMatch(/PasswordResetToken/);
  });

  it('respects --no-api-regen (api-spec.yaml untouched)', async () => {
    const before = readFileSync(join(root, '_wdf_output/api-spec.yaml'), 'utf8');
    await archiveAndRewrite('CHG-2026-017', root, { noApiRegen: true });
    const after = readFileSync(join(root, '_wdf_output/api-spec.yaml'), 'utf8');
    expect(after).toBe(before);
  });
});
