/**
 * CR Migrate — CHG-2026-015 S6
 *
 * Converts v1 mechanical deltas (op: create/append on target.kind: file) to v2
 * semantic deltas (op: ADDED on domain + requirement).
 *
 * Scope: migrate handles the most common v1→v2 case — a v1 delta that creates
 * a new spec.md (or appends requirements to one). The v1 op set has no stable
 * REQ-ID targeting for in-place mutation (it uses `spec_section` + a heading
 * string, not an ID), so MODIFIED/REMOVED migrations aren't safe to automate.
 * Authors of those deltas should hand-rewrite directly in v2.
 *
 * v1 deltas touching non-specs/ files have no clean v2 representation and are
 * refused with an offending-path list.
 *
 * Idempotent: re-running migrate on an already-v2 delta is a noop.
 *
 * Non-destructive: a backup of the original delta.yaml is written to
 * delta.yaml.v1.bak before the new v2 file is written.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { dump as yamlDump } from 'js-yaml';
import {
  loadDelta,
  isV2Operation,
  type Delta,
  type DeltaOperation,
  type V2Operation,
} from './cr-applier.js';
import { parseSpecDoc, type SpecRequirement } from './spec-sync.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface MigrateResult {
  ok: boolean;
  changeId: string;
  fromVersion: 1 | 2;
  toVersion: 2;
  action: 'noop' | 'converted' | 'refused' | 'dry-run';
  reason?: string;
  opsIn?: number;
  opsOut?: number;
  offendingPaths?: string[];
  backupPath?: string;
}

// specs/<domain>/spec.md — repo-relative (no leading slash)
const SPECS_FILE_PATTERN = /^specs\/([a-z][a-z0-9-]{1,30})\/spec\.md$/;

// ─── Public API ──────────────────────────────────────────────────────

export function migrateDelta(
  proposalDir: string,
  opts: { dryRun?: boolean; force?: boolean } = {},
): MigrateResult {
  const deltaPath = join(proposalDir, 'delta.yaml');
  const delta = loadDelta(deltaPath);
  const changeId = delta.change_id;
  const fromVersion: 1 | 2 = delta.schema_version ?? 1;

  if (fromVersion === 2) {
    return {
      ok: true,
      changeId,
      fromVersion: 2,
      toVersion: 2,
      action: 'noop',
      reason: 'delta already uses schema_version: 2',
    };
  }

  // v1 path: classify every op by target.file.
  const v1Ops = delta.operations.filter(
    (op): op is DeltaOperation => !isV2Operation(op),
  );

  const offending: string[] = [];
  for (const op of v1Ops) {
    const file = op.target?.file;
    if (!file || !SPECS_FILE_PATTERN.test(file)) {
      offending.push(file || `<op '${op.op}' missing target.file>`);
    }
  }

  if (offending.length > 0) {
    return {
      ok: false,
      changeId,
      fromVersion: 1,
      toVersion: 2,
      action: 'refused',
      reason:
        'delta touches non-specs/ files (no clean v2 mapping). ' +
        'Keep as schema_version: 1, or split into a specs-only delta + a separate v1 delta.',
      offendingPaths: dedup(offending),
    };
  }

  // Convert each v1 op to one or more v2 ops.
  const v2Ops: V2Operation[] = [];
  for (const op of v1Ops) {
    const match = op.target.file.match(SPECS_FILE_PATTERN)!;
    const domain = match[1];
    const outcome = convertOp(op, domain, changeId);
    if ('refusal' in outcome) return outcome.refusal;
    v2Ops.push(...outcome.ops);
  }

  if (opts.dryRun) {
    return {
      ok: true,
      changeId,
      fromVersion: 1,
      toVersion: 2,
      action: 'dry-run',
      opsIn: v1Ops.length,
      opsOut: v2Ops.length,
    };
  }

  // Backup the original BEFORE overwriting.
  const backupPath = join(proposalDir, 'delta.yaml.v1.bak');
  if (existsSync(backupPath) && !opts.force) {
    return {
      ok: false,
      changeId,
      fromVersion: 1,
      toVersion: 2,
      action: 'refused',
      reason: `backup already exists at ${backupPath}; pass --force to overwrite.`,
      offendingPaths: [backupPath],
    };
  }
  const originalRaw = readFileSync(deltaPath, 'utf8');

  const newDelta: Delta = {
    change_id: delta.change_id,
    summary: delta.summary,
    base_version: delta.base_version,
    target_version: delta.target_version,
    schema_version: 2,
    operations: v2Ops,
  };

  writeAtomic(deltaPath, serializeDelta(newDelta));
  writeAtomic(backupPath, originalRaw);

  return {
    ok: true,
    changeId,
    fromVersion: 1,
    toVersion: 2,
    action: 'converted',
    opsIn: v1Ops.length,
    opsOut: v2Ops.length,
    backupPath,
  };
}

// ─── Per-op conversion ───────────────────────────────────────────────

type ConvertOutcome =
  | { ops: V2Operation[] }
  | { refusal: MigrateResult };

function convertOp(op: DeltaOperation, domain: string, changeId: string): ConvertOutcome {
  // Only create/append on kind: file maps cleanly to v2 ADDED.
  // v1's spec_section + heading-string mutations don't carry a stable REQ-ID,
  // so MODIFIED/REMOVED can't be safely automated.
  if (op.op !== 'create' && op.op !== 'append') {
    return refusal(
      changeId,
      op,
      `v1 op '${op.op}' on specs/ has no safe v2 mapping. v1 spec_section mutations don't carry a stable REQ-ID; hand-rewrite as v2 MODIFIED/REMOVED instead.`,
    );
  }
  if (op.target.kind !== 'file') {
    return refusal(
      changeId,
      op,
      `v1 op ${op.op} with target.kind='${op.target.kind}' isn't a whole-file create; cannot map to v2 ADDED.`,
    );
  }
  const parsed = parseValueAsRequirements(op);
  if (!parsed.ok) return refusal(changeId, op, parsed.error);
  return {
    ops: parsed.reqs.map((req) => ({
      op: 'ADDED' as const,
      domain,
      requirement: req,
      rationale: op.rationale,
    })),
  };
}

function parseValueAsRequirements(
  op: DeltaOperation,
): { ok: true; reqs: SpecRequirement[] } | { ok: false; error: string } {
  const value = op.value ?? op.content ?? op.after;
  if (typeof value !== 'string') {
    return { ok: false, error: `op ${op.op} value must be a string (markdown body); got ${typeof value}.` };
  }
  let doc;
  try {
    doc = parseSpecDoc(value);
  } catch (e) {
    return { ok: false, error: `failed to parse value as spec markdown: ${(e as Error).message}` };
  }
  if (doc.requirements.length === 0) {
    return { ok: false, error: `op ${op.op} value parsed to zero requirements; cannot emit empty v2 ADDED/MODIFIED.` };
  }
  return { ok: true, reqs: doc.requirements };
}

function refusal(changeId: string, op: DeltaOperation, reason: string): { refusal: MigrateResult } {
  return {
    refusal: {
      ok: false,
      changeId,
      fromVersion: 1,
      toVersion: 2,
      action: 'refused',
      reason,
      offendingPaths: [op.target?.file ?? '<unknown>'],
    },
  };
}

function dedup(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function serializeDelta(d: Delta): string {
  const obj = {
    change_id: d.change_id,
    summary: d.summary,
    base_version: d.base_version,
    target_version: d.target_version,
    schema_version: 2,
    operations: d.operations,
  };
  return `# Migrated from schema_version: 1 by 'wdf cr migrate' (CHG-2026-015 S6)\n` +
    yamlDump(obj, { lineWidth: 100 });
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

// ─── Formatter ───────────────────────────────────────────────────────

export function formatMigrateResult(r: MigrateResult, dryRun: boolean): string {
  const prefix = dryRun ? '[DRY RUN] ' : '';
  switch (r.action) {
    case 'noop':
      return `✅ ${prefix}${r.changeId}: ${r.reason ?? 'already v2'}`;
    case 'converted':
      return `✅ ${prefix}${r.changeId}: v1 → v2 (${r.opsIn} ops in, ${r.opsOut} ops out). Backup: ${r.backupPath}`;
    case 'dry-run':
      return `✅ ${prefix}${r.changeId}: would convert v1 → v2 (${r.opsIn} ops in, ${r.opsOut} ops out)`;
    case 'refused': {
      const paths = r.offendingPaths?.length
        ? `\n   Offending paths: ${r.offendingPaths.join(', ')}`
        : '';
      return `❌ ${r.changeId}: refused — ${r.reason ?? 'no clean v2 mapping'}${paths}`;
    }
  }
}
