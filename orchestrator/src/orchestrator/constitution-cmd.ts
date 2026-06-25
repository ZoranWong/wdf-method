/**
 * constitution-cmd.ts — make the project constitution an EVOLVABLE artifact.
 *
 * The constitution (constitution.yaml) is a machine-readable list of
 * non-negotiable rules enforced by CONSTITUTION_CHECK (linter/rules/
 * constitution-check.ts). Until now it was a static validator: there was no
 * versioning, no changelog, and no way to see what a rule change would
 * affect. This module adds the lifecycle:
 *
 *   - `wdf constitution show`  — print the version + rule inventory.
 *   - `wdf constitution bump`  — semver-bump the `version:` field, append a
 *     changelog entry, and snapshot the current rules for later diffing.
 *   - `wdf constitution diff`  — compare current rules against the last
 *     snapshot and emit a SYNC-IMPACT report (added / removed / modified
 *     rules + the artifact scope each one touches) so the author knows what
 *     to re-lint or re-verify after editing the constitution.
 *
 * Resolution precedence matches CONSTITUTION_CHECK: prefer the per-project
 * `_wdf_output/constitution.yaml` (written by `wdf init`) over the
 * framework-root `constitution.yaml`. The changelog and snapshot live beside
 * whichever file is resolved.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { parseConstitutionRules, type ConstitutionRule } from './linter/rules/constitution-check.js';

export type SemverKind = 'major' | 'minor' | 'patch';

export interface LoadedConstitution {
  exists: boolean;
  path: string;
  version: string;
  rules: ConstitutionRule[];
}

const SNAPSHOT_NAME = '.constitution-snapshot.json';
const CHANGELOG_NAME = 'constitution-changelog.md';

/** Resolve the active constitution path (project over framework root). */
export function resolveConstitutionPath(projectRoot: string): string {
  const projectConstitution = join(projectRoot, '_wdf_output', 'constitution.yaml');
  if (existsSync(projectConstitution)) return projectConstitution;
  return join(projectRoot, 'constitution.yaml');
}

function parseVersion(raw: string): string {
  const m = raw.match(/^version:\s*["']?([0-9]+\.[0-9]+\.[0-9]+)["']?\s*$/m);
  return m ? m[1] : '0.0.0';
}

export function loadConstitution(projectRoot: string): LoadedConstitution {
  const path = resolveConstitutionPath(projectRoot);
  if (!existsSync(path)) {
    return { exists: false, path, version: '0.0.0', rules: [] };
  }
  const raw = readFileSync(path, 'utf8');
  return {
    exists: true,
    path,
    version: parseVersion(raw),
    rules: parseConstitutionRules(raw),
  };
}

export function bumpVersion(version: string, kind: SemverKind): string {
  const parts = version.split('.').map(n => parseInt(n, 10) || 0);
  const [maj, min, pat] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

/** Write a new `version:` value back into the raw constitution text. */
function writeVersion(raw: string, newVersion: string): string {
  if (/^version:\s*.*$/m.test(raw)) {
    return raw.replace(/^version:\s*.*$/m, `version: "${newVersion}"`);
  }
  // No version field yet — insert one at the top, after any leading comments.
  const lines = raw.split('\n');
  let insertAt = 0;
  while (insertAt < lines.length && (lines[insertAt].startsWith('#') || lines[insertAt].trim() === '')) {
    insertAt++;
  }
  lines.splice(insertAt, 0, `version: "${newVersion}"`, '');
  return lines.join('\n');
}

export interface BumpResult {
  ok: boolean;
  error?: string;
  path: string;
  oldVersion: string;
  newVersion: string;
}

export function bumpConstitution(
  projectRoot: string,
  kind: SemverKind,
  reason: string,
): BumpResult {
  const loaded = loadConstitution(projectRoot);
  if (!loaded.exists) {
    return { ok: false, error: `no constitution found at ${loaded.path}`, path: loaded.path, oldVersion: '0.0.0', newVersion: '0.0.0' };
  }

  const oldVersion = loaded.version;
  const newVersion = bumpVersion(oldVersion, kind);
  const raw = readFileSync(loaded.path, 'utf8');
  writeFileSync(loaded.path, writeVersion(raw, newVersion), 'utf8');

  const dir = dirname(loaded.path);

  // Snapshot the rules AS OF this bump so a later `diff` can show what
  // changed since. The snapshot represents the rule set the version describes.
  const snapshotPath = join(dir, SNAPSHOT_NAME);
  writeFileSync(
    snapshotPath,
    JSON.stringify({ version: newVersion, snapshotted_at: new Date().toISOString(), rules: loaded.rules }, null, 2),
    'utf8',
  );

  // Append a human-readable changelog entry.
  const changelogPath = join(dir, CHANGELOG_NAME);
  if (!existsSync(changelogPath)) {
    writeFileSync(changelogPath, '# Constitution Changelog\n\n', 'utf8');
  }
  appendFileSync(
    changelogPath,
    `## ${newVersion} — ${new Date().toISOString()}\n` +
      `- bump: ${kind} (${oldVersion} → ${newVersion})\n` +
      `- reason: ${reason || '(none given)'}\n\n`,
    'utf8',
  );

  return { ok: true, path: loaded.path, oldVersion, newVersion };
}

export interface RuleChange {
  id: string;
  scope?: string;
  /** Which fields differ (modified only). */
  fields?: string[];
}

export interface ConstitutionDiff {
  hasSnapshot: boolean;
  snapshotVersion?: string;
  currentVersion: string;
  added: RuleChange[];
  removed: RuleChange[];
  modified: RuleChange[];
}

function ruleFields(r: ConstitutionRule): Record<string, unknown> {
  return { name: r.name, level: r.level, scope: r.scope, check: r.check, expected: r.expected };
}

export function diffConstitution(projectRoot: string): ConstitutionDiff {
  const loaded = loadConstitution(projectRoot);
  const dir = dirname(loaded.path);
  const snapshotPath = join(dir, SNAPSHOT_NAME);

  if (!existsSync(snapshotPath)) {
    return {
      hasSnapshot: false,
      currentVersion: loaded.version,
      added: [],
      removed: [],
      modified: [],
    };
  }

  const snap = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { version: string; rules: ConstitutionRule[] };
  const snapById = new Map(snap.rules.map(r => [r.id, r]));
  const curById = new Map(loaded.rules.map(r => [r.id, r]));

  const added: RuleChange[] = [];
  const removed: RuleChange[] = [];
  const modified: RuleChange[] = [];

  for (const cur of loaded.rules) {
    const prev = snapById.get(cur.id);
    if (!prev) {
      added.push({ id: cur.id, scope: cur.scope });
      continue;
    }
    const a = ruleFields(prev);
    const b = ruleFields(cur);
    const fields = Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (fields.length > 0) {
      modified.push({ id: cur.id, scope: cur.scope, fields });
    }
  }
  for (const prev of snap.rules) {
    if (!curById.has(prev.id)) {
      removed.push({ id: prev.id, scope: prev.scope });
    }
  }

  return {
    hasSnapshot: true,
    snapshotVersion: snap.version,
    currentVersion: loaded.version,
    added,
    removed,
    modified,
  };
}

// ─── Formatters ─────────────────────────────────────────────────────

export function formatConstitution(c: LoadedConstitution): string {
  if (!c.exists) {
    return `No constitution found at ${c.path}. Run \`wdf init\` to generate one.`;
  }
  const lines = [
    `Constitution: ${c.path}`,
    `Version: ${c.version}`,
    `Rules: ${c.rules.length}`,
    '',
  ];
  for (const r of c.rules) {
    const scope = r.scope ? ` scope=${r.scope}` : '';
    const check = r.check ? ' [shell-check]' : '';
    lines.push(`  • ${r.id} [${r.level}] ${r.name}${scope}${check}`);
  }
  return lines.join('\n');
}

export function formatConstitutionDiff(d: ConstitutionDiff): string {
  if (!d.hasSnapshot) {
    return 'No constitution snapshot found. Run `wdf constitution bump <major|minor|patch>` to create the first snapshot, then `diff` after editing rules.';
  }
  const total = d.added.length + d.removed.length + d.modified.length;
  if (total === 0) {
    return `Constitution sync-impact: no rule changes since snapshot ${d.snapshotVersion} (current ${d.currentVersion}).`;
  }
  const lines = [
    `Constitution sync-impact — snapshot ${d.snapshotVersion} → current ${d.currentVersion}:`,
    `  added: ${d.added.length} | removed: ${d.removed.length} | modified: ${d.modified.length}`,
    '',
  ];
  const scopes = new Set<string>();
  for (const a of d.added) {
    lines.push(`  + ${a.id}${a.scope ? ` (scope: ${a.scope})` : ''}`);
    if (a.scope) scopes.add(a.scope);
  }
  for (const r of d.removed) {
    lines.push(`  - ${r.id}${r.scope ? ` (scope: ${r.scope})` : ''}`);
    if (r.scope) scopes.add(r.scope);
  }
  for (const m of d.modified) {
    lines.push(`  ~ ${m.id}${m.scope ? ` (scope: ${m.scope})` : ''} — changed: ${m.fields?.join(', ')}`);
    if (m.scope) scopes.add(m.scope);
  }
  lines.push('');
  if (scopes.size > 0) {
    lines.push('Affected scopes — re-run `wdf lint` and re-verify stories touching:');
    for (const s of scopes) lines.push(`  · ${s}`);
  } else {
    lines.push('Re-run `wdf lint` to re-enforce the updated constitution.');
  }
  return lines.join('\n');
}
