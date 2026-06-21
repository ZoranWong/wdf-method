import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateDelta, formatMigrateResult } from './cr-migrate.js';
import { loadDelta } from './cr-applier.js';

// ─── Fixtures ────────────────────────────────────────────────────────

function setupRoot(): string {
  return mkdtempSync(join(tmpdir(), 'wdf-cr-migrate-'));
}

const V1_SPECS_CREATE_DELTA = `change_id: CHG-2026-099
summary: Add Password Reset requirement
base_version: "3.9.0"
target_version: "3.9.1"

operations:
  - op: create
    target:
      kind: file
      file: specs/auth/spec.md
    content: |
      ---
      artifact_type: spec
      domain: auth
      version: 1
      ---

      # Spec — Auth

      ## Requirement: Password Reset
      - id: REQ-014
      - priority: P1

      GIVEN a user who forgot their password
      WHEN they request a reset
      THEN the system MUST email a time-limited token
    rationale: v1 spec file create
`;

const V2_DELTA = `change_id: CHG-2026-099
summary: already v2
base_version: "3.9.0"
target_version: "3.9.1"
schema_version: 2

operations:
  - op: ADDED
    domain: auth
    requirement:
      id: REQ-014
      name: Password Reset
      scenarios:
        - given: [a]
          when: [b]
          then: [MUST c]
`;

function writeDelta(root: string, body: string): string {
  const dir = join(root, 'changes', 'CHG-2026-099-test');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'delta.yaml');
  writeFileSync(path, body, 'utf8');
  return dir;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('cr-migrate — CHG-2026-015 S6', () => {
  let root: string;

  beforeEach(() => {
    root = setupRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('noop when delta is already schema_version: 2', () => {
    const dir = writeDelta(root, V2_DELTA);
    const result = migrateDelta(dir);
    expect(result.action).toBe('noop');
    expect(result.ok).toBe(true);
    expect(result.fromVersion).toBe(2);
    expect(result.reason).toMatch(/already uses schema_version: 2/);
    // Original file untouched.
    const after = readFileSync(join(dir, 'delta.yaml'), 'utf8');
    expect(after).toBe(V2_DELTA);
  });

  it('converts a v1 specs-only create delta to v2 ADDED ops', () => {
    const dir = writeDelta(root, V1_SPECS_CREATE_DELTA);
    const result = migrateDelta(dir);

    expect(result.ok).toBe(true);
    expect(result.action).toBe('converted');
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(2);
    expect(result.opsIn).toBe(1);
    expect(result.opsOut).toBe(1); // one ADDED per requirement in the spec body
    expect(result.backupPath).toBe(join(dir, 'delta.yaml.v1.bak'));

    // Backup exists and matches original.
    expect(existsSync(result.backupPath!)).toBe(true);
    const backup = readFileSync(result.backupPath!, 'utf8');
    expect(backup).toBe(V1_SPECS_CREATE_DELTA);

    // New delta is valid v2.
    const reloaded = loadDelta(join(dir, 'delta.yaml'));
    expect(reloaded.schema_version).toBe(2);
    expect(reloaded.operations).toHaveLength(1);
    const op = reloaded.operations[0] as { op: string; domain: string; requirement?: { id?: string; name?: string } };
    expect(op.op).toBe('ADDED');
    expect(op.domain).toBe('auth');
    expect(op.requirement?.id).toBe('REQ-014');
    expect(op.requirement?.name).toBe('Password Reset');
  });

  it('refuses v1 delta that touches non-specs/ files (e.g. customize.toml)', () => {
    const dir = writeDelta(root, `change_id: CHG-2026-099
summary: mixed
base_version: "3.9.0"
target_version: "3.9.1"

operations:
  - op: set
    target:
      kind: toml_key
      file: customize.toml
      path: "specs.source_of_truth"
    value: true
  - op: create
    target:
      kind: file
      file: specs/auth/spec.md
    content: |
      ---
      artifact_type: spec
      domain: auth
      version: 1
      ---

      # Spec — Auth

      ## Requirement: X
      - id: REQ-001

      GIVEN a
      WHEN b
      THEN the system MUST c
`);
    const result = migrateDelta(dir);

    expect(result.ok).toBe(false);
    expect(result.action).toBe('refused');
    expect(result.offendingPaths).toContain('customize.toml');
    expect(result.reason).toMatch(/non-specs/);

    // Original file untouched, no backup written.
    expect(existsSync(join(dir, 'delta.yaml.v1.bak'))).toBe(false);
  });

  it('propagates loadDelta errors for malformed v1 ops (missing content)', () => {
    const dir = writeDelta(root, `change_id: CHG-2026-099
summary: missing body
base_version: "3.9.0"
target_version: "3.9.1"

operations:
  - op: create
    target:
      kind: file
      file: specs/auth/spec.md
`);
    // Validator rejects before migrate sees it; migrate surfaces the error.
    expect(() => migrateDelta(dir)).toThrow(/missing required field 'content'/);
    expect(existsSync(join(dir, 'delta.yaml.v1.bak'))).toBe(false);
  });

  it('refuses v1 spec_section modify on specs/ (only create/append on kind:file supported)', () => {
    const dir = writeDelta(root, `change_id: CHG-2026-099
summary: unsupported op
base_version: "3.9.0"
target_version: "3.9.1"

operations:
  - op: modify
    target:
      kind: spec_section
      file: specs/auth/spec.md
      section: "Password Reset"
    before: "## Requirement: Password Reset\\n- id: REQ-014\\n"
    after: "## Requirement: Password Reset\\n- id: REQ-014\\nGIVEN ...\\n"
`);
    const result = migrateDelta(dir);

    expect(result.ok).toBe(false);
    expect(result.action).toBe('refused');
    expect(result.reason).toMatch(/no safe v2 mapping/);
    expect(existsSync(join(dir, 'delta.yaml.v1.bak'))).toBe(false);
  });

  it('refuses v1 file delete on specs/ (whole-file delete has no v2 representation)', () => {
    const dir = writeDelta(root, `change_id: CHG-2026-099
summary: whole-file delete
base_version: "3.9.0"
target_version: "3.9.1"

operations:
  - op: delete
    target:
      kind: file
      file: specs/auth/spec.md
`);
    const result = migrateDelta(dir);

    expect(result.ok).toBe(false);
    expect(result.action).toBe('refused');
    // v1 file delete lacks a target.id — convertOp refuses.
    expect(result.reason).toMatch(/no safe v2 mapping|whole-file|requirements/);
    expect(existsSync(join(dir, 'delta.yaml.v1.bak'))).toBe(false);
  });

  it('--dry-run plans conversion without touching disk', () => {
    const dir = writeDelta(root, V1_SPECS_CREATE_DELTA);
    const result = migrateDelta(dir, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.action).toBe('dry-run');
    expect(result.opsIn).toBe(1);
    expect(result.opsOut).toBe(1);

    // Nothing written.
    const after = readFileSync(join(dir, 'delta.yaml'), 'utf8');
    expect(after).toBe(V1_SPECS_CREATE_DELTA);
    expect(existsSync(join(dir, 'delta.yaml.v1.bak'))).toBe(false);
  });

  it('idempotent: re-running migrate on the converted delta returns noop', () => {
    const dir = writeDelta(root, V1_SPECS_CREATE_DELTA);
    const first = migrateDelta(dir);
    expect(first.action).toBe('converted');

    const second = migrateDelta(dir);
    expect(second.action).toBe('noop');
    expect(second.ok).toBe(true);
  });

  it('--force overwrites an existing delta.yaml.v1.bak', () => {
    const dir = writeDelta(root, V1_SPECS_CREATE_DELTA);
    // Pre-create a stale backup to block the second migrate.
    const backupPath = join(dir, 'delta.yaml.v1.bak');
    writeFileSync(backupPath, 'STALE BACKUP', 'utf8');

    // Without force: refused.
    const refused = migrateDelta(dir);
    expect(refused.ok).toBe(false);
    expect(refused.action).toBe('refused');
    expect(refused.reason).toMatch(/backup already exists/);

    // Reset delta back to v1 (previous run was refused so it's still v1).
    // Then force.
    const forced = migrateDelta(dir, { force: true });
    expect(forced.ok).toBe(true);
    expect(forced.action).toBe('converted');
    expect(readFileSync(backupPath, 'utf8')).toBe(V1_SPECS_CREATE_DELTA);
  });
});

describe('formatMigrateResult', () => {
  it('renders noop', () => {
    const s = formatMigrateResult({
      ok: true,
      changeId: 'CHG-X',
      fromVersion: 2,
      toVersion: 2,
      action: 'noop',
      reason: 'already v2',
    }, false);
    expect(s).toMatch(/✅.*CHG-X.*already v2/);
  });

  it('renders converted with op counts and backup path', () => {
    const s = formatMigrateResult({
      ok: true,
      changeId: 'CHG-X',
      fromVersion: 1,
      toVersion: 2,
      action: 'converted',
      opsIn: 2,
      opsOut: 5,
      backupPath: '/tmp/delta.yaml.v1.bak',
    }, false);
    expect(s).toMatch(/✅.*v1 → v2.*2 ops in.*5 ops out/);
    expect(s).toMatch(/delta\.yaml\.v1\.bak/);
  });

  it('renders refused with offending paths', () => {
    const s = formatMigrateResult({
      ok: false,
      changeId: 'CHG-X',
      fromVersion: 1,
      toVersion: 2,
      action: 'refused',
      reason: 'non-specs/',
      offendingPaths: ['customize.toml'],
    }, false);
    expect(s).toMatch(/❌.*refused.*non-specs/);
    expect(s).toMatch(/customize\.toml/);
  });
});
