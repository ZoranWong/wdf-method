/**
 * constitution-cmd — the constitution lifecycle (show / bump / diff).
 *
 * These tests seed a synthetic _wdf_output/constitution.yaml and verify:
 *   - load reports version + rules,
 *   - bump increments the semver, writes the version back, appends a
 *     changelog entry, and snapshots the rules,
 *   - diff reports added / removed / modified rules + their scopes against
 *     the snapshot,
 *   - resolution prefers _wdf_output/constitution.yaml over the root file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadConstitution,
  bumpConstitution,
  bumpVersion,
  diffConstitution,
  resolveConstitutionPath,
  formatConstitution,
  formatConstitutionDiff,
} from './constitution-cmd.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wdf-constitution-'));
  mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function seed(version: string, rules: string): void {
  writeFileSync(
    join(projectRoot, '_wdf_output', 'constitution.yaml'),
    `# Project Constitution\nversion: "${version}"\n\nrules:\n${rules}\n`,
  );
}

const TWO_RULES = [
  '  - id: WDF-001',
  '    name: TypeScript strict mode',
  '    level: warning',
  '    scope: src/**/*.ts',
  '  - id: WDF-002',
  '    name: No stale perms',
  '    level: error',
  '    check: "echo 0"',
  '    expected: 0',
].join('\n');

describe('bumpVersion', () => {
  it('increments each semver part', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });
});

describe('loadConstitution', () => {
  it('reports version and rules', () => {
    seed('0.1.0', TWO_RULES);
    const c = loadConstitution(projectRoot);
    expect(c.exists).toBe(true);
    expect(c.version).toBe('0.1.0');
    expect(c.rules.map(r => r.id)).toEqual(['WDF-001', 'WDF-002']);
    expect(formatConstitution(c)).toContain('WDF-001');
  });

  it('prefers _wdf_output/constitution.yaml over the root file', () => {
    seed('0.1.0', TWO_RULES);
    writeFileSync(join(projectRoot, 'constitution.yaml'), 'version: "9.9.9"\nrules:\n');
    expect(resolveConstitutionPath(projectRoot)).toBe(join(projectRoot, '_wdf_output', 'constitution.yaml'));
    expect(loadConstitution(projectRoot).version).toBe('0.1.0');
  });
});

describe('bumpConstitution', () => {
  it('bumps version, writes it back, appends changelog, snapshots rules', () => {
    seed('0.1.0', TWO_RULES);
    const r = bumpConstitution(projectRoot, 'minor', 'tightened lint');
    expect(r.ok).toBe(true);
    expect(r.oldVersion).toBe('0.1.0');
    expect(r.newVersion).toBe('0.2.0');

    // version written back
    expect(loadConstitution(projectRoot).version).toBe('0.2.0');
    // changelog appended
    const changelog = readFileSync(join(projectRoot, '_wdf_output', 'constitution-changelog.md'), 'utf8');
    expect(changelog).toContain('0.2.0');
    expect(changelog).toContain('tightened lint');
    // snapshot written
    expect(existsSync(join(projectRoot, '_wdf_output', '.constitution-snapshot.json'))).toBe(true);
  });
});

describe('diffConstitution', () => {
  it('reports no snapshot before the first bump', () => {
    seed('0.1.0', TWO_RULES);
    const d = diffConstitution(projectRoot);
    expect(d.hasSnapshot).toBe(false);
    expect(formatConstitutionDiff(d)).toContain('No constitution snapshot');
  });

  it('reports added / removed / modified rules + scopes after edits', () => {
    seed('0.1.0', TWO_RULES);
    bumpConstitution(projectRoot, 'minor', 'snapshot baseline');

    // Edit: remove WDF-002, modify WDF-001's scope, add WDF-003.
    seed('0.2.0', [
      '  - id: WDF-001',
      '    name: TypeScript strict mode',
      '    level: error', // changed from warning
      '    scope: src/**/*.ts',
      '  - id: WDF-003',
      '    name: New rule',
      '    level: error',
      '    scope: tests/**/*.ts',
    ].join('\n'));

    const d = diffConstitution(projectRoot);
    expect(d.hasSnapshot).toBe(true);
    expect(d.added.map(a => a.id)).toEqual(['WDF-003']);
    expect(d.removed.map(r => r.id)).toEqual(['WDF-002']);
    expect(d.modified.map(m => m.id)).toEqual(['WDF-001']);
    expect(d.modified[0].fields).toContain('level');

    const out = formatConstitutionDiff(d);
    expect(out).toContain('WDF-003');
    expect(out).toContain('tests/**/*.ts'); // scope surfaced
  });
});
