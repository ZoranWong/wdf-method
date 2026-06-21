/**
 * CR Applier — applies a structured delta.yaml patch to project files.
 *
 * Reads `changes/<CHG-id>/delta.yaml`, validates against
 * `schemas/change-delta-schema.yaml`, and atomically applies the listed
 * operations to target files (TOML, YAML, Markdown, raw text).
 *
 * Design:
 *   - Plan-then-apply: every op produces a FileChange; only after ALL ops
 *     successfully plan do we write to disk. A failure during plan rolls
 *     back nothing because nothing has been written.
 *   - Format-preserving for TOML/YAML: edits operate on the source text
 *     surgically rather than round-tripping through a serializer. Comments
 *     and ordering are preserved.
 *   - Dry-run: return planned diffs without writing.
 *
 * Public API:
 *   loadDelta(path)              → parsed Delta
 *   planApply(delta, root)       → ChangePlan (per-file new content + diff)
 *   applyPlan(plan)              → writes all files, returns paths
 *   applyDelta(deltaPath, root, opts) → top-level convenience
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, renameSync, readdirSync } from 'fs';
import { resolve, join, dirname, isAbsolute, normalize, relative, basename } from 'path';
import { createHash } from 'crypto';
import { load as yamlLoad } from 'js-yaml';
import type { SpecRequirement, SpecDocument } from './spec-sync.js';
import {
  parseSpecDoc, formatSpecDoc, validateSpec, loadSpecDocs,
  forwardSync, forwardSyncApiSpec, forwardSyncDbSchema, applySync,
} from './spec-sync.js';
import { loadConfig, getSpecsDir, getApiSpecPath, getDbSchemaPath } from './config.js';

// ─── Types ───────────────────────────────────────────────────────────

export type DeltaOp =
  | 'set' | 'remove' | 'modify' | 'append' | 'create' | 'delete';

/**
 * Semantic classification of a delta operation — OpenSpec-inspired.
 * - `added`: introduces new spec content (new requirement, new field, new file)
 * - `modified`: changes existing spec content (rename, restructure, value change)
 * - `removed`: deletes spec content (deprecates requirement, drops field)
 *
 * Optional: when omitted, deriveSemanticFromOp() infers from `op`.
 */
export type DeltaSemantic = 'added' | 'modified' | 'removed';

export type TargetKind =
  | 'toml_key' | 'yaml_key' | 'spec_section' | 'text_match' | 'file';

export interface DeltaTarget {
  kind: TargetKind;
  file: string;
  path?: string;       // toml_key, yaml_key
  section?: string;    // spec_section
}

export interface DeltaOperation {
  op: DeltaOp;
  target: DeltaTarget;
  value?: unknown;
  before?: string;
  after?: string;
  content?: string;
  expected_hash?: string;
  rationale?: string;
  semantic?: DeltaSemantic;  // optional semantic classification (OpenSpec-style)
}

/**
 * CHG-2026-015 S2 — Semantic delta v2.
 *
 * v2 ops declare ADDED/MODIFIED/REMOVED at the requirement level on a domain's
 * spec.md (located under `_wdf_output/specs/<domain>/spec.md`). The plan-then-apply
 * pipeline parses the current spec, mutates the in-memory SpecDocument, validates
 * via validateSpec(), and re-serializes via formatSpecDoc() (which sorts by id).
 *
 * v2 ops MUST NOT target non-spec files; v1 ops remain required for TOML/YAML/
 * markdown/text mutations. Mixed-version deltas are rejected at validateDelta.
 */
export type DeltaSchemaVersion = 1 | 2;
export type SemanticOp = 'ADDED' | 'MODIFIED' | 'REMOVED';

export interface V2Operation {
  op: SemanticOp;
  domain: string;
  /** ADDED + MODIFIED: full requirement object (REPLACES scenarios on MODIFIED). */
  requirement?: SpecRequirement;
  /** REMOVED: which requirement id to delete. */
  requirement_id?: string;
  rationale?: string;
}

export function isV2Operation(op: DeltaOperation | V2Operation): op is V2Operation {
  return (op as V2Operation).op === 'ADDED'
      || (op as V2Operation).op === 'MODIFIED'
      || (op as V2Operation).op === 'REMOVED';
}

/**
 * Infer semantic classification from op when CR author didn't specify.
 * Lets legacy CRs (without `semantic:`) still get ADDED/MODIFIED/REMOVED
 * reporting in impact analysis.
 */
export function deriveSemanticFromOp(op: DeltaOp): DeltaSemantic {
  switch (op) {
    case 'create':
    case 'append':
      return 'added';
    case 'delete':
    case 'remove':
      return 'removed';
    case 'set':
    case 'modify':
    default:
      return 'modified';
  }
}

export interface Delta {
  change_id: string;
  summary: string;
  base_version: string;
  target_version: string;
  /** 1 (default) = mechanical v1 ops; 2 = semantic v2 ops on specs/. */
  schema_version?: DeltaSchemaVersion;
  operations: (DeltaOperation | V2Operation)[];
}

export interface FileChange {
  file: string;          // absolute path
  relPath: string;       // path relative to project root
  action: 'write' | 'create' | 'delete';
  before: string | null; // null if file did not exist
  after: string | null;  // null if op is delete
  ops: number[];         // indices of ops that contributed
}

export interface ChangePlan {
  delta: Delta;
  changes: FileChange[]; // one entry per touched file
  dryRun: boolean;
}

export class DeltaApplyError extends Error {
  constructor(
    public readonly opIndex: number,
    public readonly reason: string,
    public readonly opRepr: string,
  ) {
    super(`[op#${opIndex}] ${reason} (${opRepr})`);
    this.name = 'DeltaApplyError';
  }
}

// ─── Loader ──────────────────────────────────────────────────────────

export function loadDelta(deltaPath: string): Delta {
  if (!existsSync(deltaPath)) {
    throw new Error(`delta file not found: ${deltaPath}`);
  }
  const raw = readFileSync(deltaPath, 'utf8');
  const parsed = yamlLoad(raw);
  return validateDelta(parsed, deltaPath);
}

export function validateDelta(input: unknown, sourcePath = '<input>'): Delta {
  if (!input || typeof input !== 'object') {
    throw new Error(`${sourcePath}: delta must be a YAML mapping`);
  }
  const d = input as Record<string, unknown>;
  const required = ['change_id', 'summary', 'base_version', 'target_version', 'operations'];
  for (const k of required) {
    if (!(k in d)) throw new Error(`${sourcePath}: missing required field '${k}'`);
  }
  if (!/^CHG-\d{4}-\d{3}$/.test(String(d.change_id))) {
    throw new Error(`${sourcePath}: change_id must match CHG-YYYY-NNN, got '${d.change_id}'`);
  }
  if (!Array.isArray(d.operations) || d.operations.length === 0) {
    throw new Error(`${sourcePath}: operations must be a non-empty array`);
  }
  // CHG-2026-015 S2: read schema_version (default 1) and route validation
  let schemaVersion: 1 | 2 = 1;
  if (d.schema_version !== undefined) {
    const sv = Number(d.schema_version);
    if (sv !== 1 && sv !== 2) {
      throw new Error(
        `${sourcePath}: schema_version must be 1 or 2, got '${d.schema_version}'`,
      );
    }
    schemaVersion = sv as 1 | 2;
  }
  if (schemaVersion === 2) {
    d.operations.forEach((op, i) => {
      if (!isV2Operation(op as V2Operation)) {
        throw new Error(
          `${sourcePath}: schema_version=2 requires v2 ops (ADDED/MODIFIED/REMOVED). ` +
          `op#${i} has op='${(op as Record<string, unknown>).op}' which is v1. ` +
          `Split into separate deltas or set schema_version=1.`,
        );
      }
      validateV2Operation(op, i, sourcePath);
    });
  } else {
    d.operations.forEach((op, i) => {
      if (isV2Operation(op as V2Operation)) {
        throw new Error(
          `${sourcePath}: v2 op '${(op as V2Operation).op}' used with ` +
          `schema_version=1. Set schema_version=2.`,
        );
      }
      validateOperation(op, i, sourcePath);
    });
  }
  return { ...d, schema_version: schemaVersion } as unknown as Delta;
}

const DOMAIN_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
const REQ_ID_PATTERN = /^REQ-\d{3,4}$/;

function validateV2Operation(op: unknown, idx: number, src: string): void {
  const o = op as V2Operation;
  if (!o || typeof o !== 'object') {
    throw new Error(`${src}: op#${idx} must be a mapping`);
  }
  if (!['ADDED', 'MODIFIED', 'REMOVED'].includes(o.op)) {
    throw new Error(
      `${src}: op#${idx} unknown v2 op '${o.op}' (expected ADDED|MODIFIED|REMOVED)`,
    );
  }
  if (typeof o.domain !== 'string' || !DOMAIN_PATTERN.test(o.domain)) {
    throw new Error(
      `${src}: op#${idx} (${o.op}) domain must match ^[a-z][a-z0-9-]{1,30}$ (got '${o.domain}')`,
    );
  }
  if (o.op === 'REMOVED') {
    if (typeof o.requirement_id !== 'string' || !REQ_ID_PATTERN.test(o.requirement_id)) {
      throw new Error(
        `${src}: op#${idx} (REMOVED) requirement_id required (REQ-NNN format), got '${o.requirement_id}'`,
      );
    }
    return;
  }
  // ADDED + MODIFIED require a fully-formed requirement object
  if (!o.requirement || typeof o.requirement !== 'object') {
    throw new Error(`${src}: op#${idx} (${o.op}) requirement object required`);
  }
  const r = o.requirement;
  if (typeof r.name !== 'string' || !/^[A-Z][A-Za-z0-9 _-]{2,80}$/.test(r.name)) {
    throw new Error(
      `${src}: op#${idx} (${o.op}) requirement.name must match ^[A-Z][A-Za-z0-9 _-]{2,80}$ (got '${r.name}')`,
    );
  }
  if (r.id !== undefined && (typeof r.id !== 'string' || !REQ_ID_PATTERN.test(r.id))) {
    throw new Error(
      `${src}: op#${idx} (${o.op}) requirement.id must be REQ-NNN format (got '${r.id}')`,
    );
  }
  if (!Array.isArray(r.scenarios) || r.scenarios.length === 0) {
    throw new Error(`${src}: op#${idx} (${o.op}) requirement.scenarios must be a non-empty array`);
  }
  for (let s = 0; s < r.scenarios.length; s++) {
    const scn = r.scenarios[s];
    if (!Array.isArray(scn.given) || scn.given.length === 0 ||
        !Array.isArray(scn.when) || scn.when.length === 0 ||
        !Array.isArray(scn.then) || scn.then.length === 0) {
      throw new Error(
        `${src}: op#${idx} (${o.op}) requirement.scenarios[${s}] must have non-empty given/when/then`,
      );
    }
  }
}

const OP_REQUIRED: Record<DeltaOp, string[]> = {
  set:    ['target', 'value'],
  remove: ['target'],
  modify: ['target', 'before', 'after'],
  append: ['target', 'value'],
  create: ['target', 'content'],
  delete: ['target'],
};

const KIND_VALID_OPS: Record<TargetKind, DeltaOp[]> = {
  toml_key:     ['set', 'remove'],
  yaml_key:     ['set', 'remove'],
  spec_section: ['modify', 'append'],
  text_match:   ['modify', 'remove'],
  file:         ['create', 'delete'],
};

function validateOperation(op: unknown, idx: number, src: string): void {
  const o = op as Record<string, unknown>;
  if (!o || typeof o !== 'object') {
    throw new Error(`${src}: op#${idx} must be a mapping`);
  }
  if (!o.op || !(o.op as string in OP_REQUIRED)) {
    throw new Error(`${src}: op#${idx} unknown op '${o.op}'`);
  }
  const opType = o.op as DeltaOp;
  for (const k of OP_REQUIRED[opType]) {
    if (!(k in o)) {
      throw new Error(`${src}: op#${idx} (${opType}) missing required field '${k}'`);
    }
  }
  const t = o.target as DeltaTarget | undefined;
  if (!t || !t.file || !t.kind) {
    throw new Error(`${src}: op#${idx} target.kind and target.file required`);
  }
  if (!(t.kind in KIND_VALID_OPS)) {
    throw new Error(`${src}: op#${idx} unknown target.kind '${t.kind}'`);
  }
  if (!KIND_VALID_OPS[t.kind].includes(opType)) {
    throw new Error(
      `${src}: op#${idx} op '${opType}' not allowed for target.kind '${t.kind}'`,
    );
  }
  if (isAbsolute(t.file) || t.file.split('/').includes('..')) {
    throw new Error(`${src}: op#${idx} target.file must be a relative path without '..' (got '${t.file}')`);
  }
  if (['toml_key', 'yaml_key'].includes(t.kind) && !t.path) {
    throw new Error(`${src}: op#${idx} target.path required for kind '${t.kind}'`);
  }
  if (t.kind === 'spec_section' && !t.section) {
    throw new Error(`${src}: op#${idx} target.section required for kind 'spec_section'`);
  }
}

// ─── Planner ─────────────────────────────────────────────────────────

/**
 * Top-level planner. Routes by `schema_version`:
 *   - 1 (default): mechanical v1 ops → planApplyV1
 *   - 2: semantic v2 ops on specs/    → planApplyV2
 *
 * Mixed-version deltas are rejected in validateDelta; here we just dispatch.
 */
export function planApply(delta: Delta, projectRoot: string): ChangePlan {
  const v: 1 | 2 = delta.schema_version ?? 1;
  if (v === 2) return planApplyV2(delta, projectRoot);
  return planApplyV1(delta, projectRoot);
}

export function planApplyV1(delta: Delta, projectRoot: string): ChangePlan {
  // Buffer per-file content (so multiple ops on the same file compose).
  const buf = new Map<string, FileChange>();
  // Caller (planApply) guarantees v1-only; cast for ergonomic field access.
  const ops = delta.operations as DeltaOperation[];

  ops.forEach((op, i) => {
    const absFile = resolve(projectRoot, op.target.file);
    if (!isWithin(projectRoot, absFile)) {
      throw new DeltaApplyError(i, `path escapes project root`, op.target.file);
    }
    let entry = buf.get(absFile);
    if (!entry) {
      const fileExists = existsSync(absFile);
      entry = {
        file: absFile,
        relPath: relative(projectRoot, absFile),
        action: 'write',
        before: fileExists ? readFileSync(absFile, 'utf8') : null,
        after: fileExists ? readFileSync(absFile, 'utf8') : null,
        ops: [],
      };
      buf.set(absFile, entry);
    }
    entry.ops.push(i);

    if (op.expected_hash && entry.before !== null) {
      const got = sha256(entry.before);
      if (got !== op.expected_hash) {
        throw new DeltaApplyError(i, `expected_hash mismatch (got ${got})`, opRepr(op));
      }
    }

    try {
      applyOpToBuffer(op, entry);
    } catch (e) {
      if (e instanceof DeltaApplyError) throw e;
      throw new DeltaApplyError(i, (e as Error).message, opRepr(op));
    }
  });

  const changes: FileChange[] = [];
  for (const c of buf.values()) {
    if (c.before === c.after && c.action === 'write') continue; // no-op
    changes.push(c);
  }

  return { delta, changes, dryRun: false };
}

// ─── V2 planner (semantic ops on specs/<domain>/spec.md) ─────────────

/**
 * CHG-2026-015 S2 — Semantic v2 planner.
 *
 * Groups v2 ops by domain; per domain lazily loads the existing spec doc
 * (or starts from an empty SpecDocument), applies ADDED/MODIFIED/REMOVED ops
 * to the in-memory representation, validates via validateSpec(), and
 * re-serializes via formatSpecDoc() (which sorts requirements by id for
 * deterministic output). Buffers a single FileChange per touched spec.md.
 *
 * Atomicity: any failure (duplicate id, missing id, schema violation) throws
 * DeltaApplyError before any disk write — same contract as planApplyV1.
 */
export function planApplyV2(delta: Delta, projectRoot: string): ChangePlan {
  const buf = new Map<string, FileChange>();
  const docs = new Map<string, SpecDocument>(); // keyed by absPath

  delta.operations.forEach((rawOp, i) => {
    if (!isV2Operation(rawOp)) {
      // Should be unreachable thanks to validateDelta, but guard for direct callers.
      throw new DeltaApplyError(
        i,
        `non-v2 op in schema_version=2 delta`,
        JSON.stringify(rawOp).slice(0, 80),
      );
    }
    const op = rawOp as V2Operation;
    const relPath = `_wdf_output/specs/${op.domain}/spec.md`;
    const absFile = resolve(projectRoot, relPath);
    if (!isWithin(projectRoot, absFile)) {
      throw new DeltaApplyError(i, `path escapes project root`, relPath);
    }

    // Lazy-load existing spec content
    if (!buf.has(absFile)) {
      const fileExists = existsSync(absFile);
      const beforeText = fileExists ? readFileSync(absFile, 'utf8') : null;
      buf.set(absFile, {
        file: absFile,
        relPath: relative(projectRoot, absFile),
        action: fileExists ? 'write' : 'create',
        before: beforeText,
        after: beforeText,
        ops: [],
      });
      docs.set(
        absFile,
        fileExists ? parseSpecDoc(beforeText!, op.domain) : emptyDoc(op.domain),
      );
    }
    buf.get(absFile)!.ops.push(i);

    const doc = docs.get(absFile)!;
    try {
      applyV2OpToDoc(op, doc, i);
    } catch (e) {
      if (e instanceof DeltaApplyError) throw e;
      throw new DeltaApplyError(i, (e as Error).message, v2OpRepr(op));
    }
  });

  // After all ops land, validate + format each touched doc
  const changes: FileChange[] = [];
  for (const [absFile, entry] of buf.entries()) {
    const doc = docs.get(absFile)!;
    const errors = validateSpec(doc);
    if (errors.length > 0) {
      const idx = entry.ops[entry.ops.length - 1] ?? 0;
      throw new DeltaApplyError(
        idx,
        `spec validation failed: ${errors.map(e => `${e.ruleId}(${e.message})`).join('; ')}`,
        entry.relPath,
      );
    }
    const formatted = formatSpecDoc(doc);
    entry.after = formatted;
    if (entry.before === entry.after && entry.action === 'write') continue;
    changes.push(entry);
  }

  return { delta, changes, dryRun: false };
}

function emptyDoc(domain: string): SpecDocument {
  return { domain, version: 1, requirements: [] };
}

function applyV2OpToDoc(op: V2Operation, doc: SpecDocument, opIndex: number): void {
  if (op.op === 'ADDED') {
    const r = op.requirement!;
    if (r.id) {
      const dup = doc.requirements.find(x => x.id === r.id);
      if (dup) {
        throw new Error(`requirement id '${r.id}' already exists in domain '${op.domain}'`);
      }
    }
    doc.requirements.push({ ...r, scenarios: r.scenarios.map(s => ({ ...s })) });
    return;
  }
  if (op.op === 'MODIFIED') {
    const r = op.requirement!;
    const idTarget = r.id ?? op.requirement_id;
    if (!idTarget) {
      throw new Error(`MODIFIED requires requirement.id or requirement_id`);
    }
    const idx = doc.requirements.findIndex(x => x.id === idTarget);
    if (idx === -1) {
      throw new Error(`MODIFIED target id '${idTarget}' not found in domain '${op.domain}'`);
    }
    // REPLACES semantics (including scenarios)
    doc.requirements[idx] = { ...r, scenarios: r.scenarios.map(s => ({ ...s })) };
    return;
  }
  if (op.op === 'REMOVED') {
    const id = op.requirement_id!;
    const before = doc.requirements.length;
    doc.requirements = doc.requirements.filter(x => x.id !== id);
    if (doc.requirements.length === before) {
      throw new Error(`REMOVED target id '${id}' not found in domain '${op.domain}'`);
    }
    return;
  }
  throw new Error(`unknown v2 op '${op.op as string}'`);
}

function v2OpRepr(op: V2Operation): string {
  if (op.op === 'REMOVED') return `${op.op} ${op.domain}#${op.requirement_id}`;
  return `${op.op} ${op.domain}#${op.requirement?.id ?? '<no-id>'}`;
}

function applyOpToBuffer(op: DeltaOperation, entry: FileChange): void {
  const t = op.target;
  switch (op.op) {
    case 'create': {
      if (entry.before !== null) throw new Error(`file already exists: ${entry.relPath}`);
      entry.action = 'create';
      entry.after = String(op.content ?? '');
      return;
    }
    case 'delete': {
      if (entry.before === null) throw new Error(`cannot delete missing file: ${entry.relPath}`);
      entry.action = 'delete';
      entry.after = null;
      return;
    }
  }
  // All other ops modify existing file content
  if (entry.after === null) throw new Error(`cannot modify missing file: ${entry.relPath}`);
  switch (t.kind) {
    case 'toml_key':
      entry.after = applyTomlOp(entry.after, op);
      return;
    case 'yaml_key':
      entry.after = applyYamlOp(entry.after, op);
      return;
    case 'spec_section':
      entry.after = applySectionOp(entry.after, op);
      return;
    case 'text_match':
      entry.after = applyTextMatchOp(entry.after, op);
      return;
    default:
      throw new Error(`unsupported target.kind '${t.kind}' for op '${op.op}'`);
  }
}

// ─── TOML ops (text-surgical, format-preserving) ─────────────────────

function applyTomlOp(content: string, op: DeltaOperation): string {
  const path = String(op.target.path);
  const segs = parseDottedPath(path);
  if (segs.length === 0) throw new Error(`empty path`);
  const tableSegs = segs.slice(0, -1);
  const leaf = segs[segs.length - 1];
  const tableHeader = tableSegs.length > 0 ? `[${tableSegs.join('.')}]` : null;

  const lines = content.split('\n');
  const range = findTomlSectionRange(lines, tableHeader);
  // Search for `leaf =` within range
  const keyRe = new RegExp(`^(\\s*)${escapeRe(leaf)}\\s*=\\s*(.*)$`);

  if (op.op === 'set') {
    const valueLiteral = tomlLiteral(op.value);
    for (let i = range.start; i < range.end; i++) {
      if (keyRe.test(lines[i])) {
        const indent = lines[i].match(keyRe)![1];
        lines[i] = `${indent}${leaf} = ${valueLiteral}`;
        return lines.join('\n');
      }
    }
    // Insert: append new key inside section (or new section at EOF)
    if (tableHeader && range.start === range.end && range.start === lines.length) {
      // Section doesn't exist, create it at EOF
      const sep = lines.length > 0 && lines[lines.length - 1].trim() !== '' ? [''] : [];
      lines.push(...sep, tableHeader, `${leaf} = ${valueLiteral}`);
    } else {
      // Insert before next section header or EOF
      const insertAt = range.end;
      lines.splice(insertAt, 0, `${leaf} = ${valueLiteral}`);
    }
    return lines.join('\n');
  }

  if (op.op === 'remove') {
    for (let i = range.start; i < range.end; i++) {
      if (keyRe.test(lines[i])) {
        lines.splice(i, 1);
        return lines.join('\n');
      }
    }
    throw new Error(`toml key not found: ${path}`);
  }

  throw new Error(`toml_key supports only set/remove (got ${op.op})`);
}

interface SectionRange { start: number; end: number; }

function findTomlSectionRange(lines: string[], header: string | null): SectionRange {
  if (header === null) {
    // Top-level: from line 0 up to first section header
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\[[^\]]+\]\s*(#.*)?$/.test(lines[i])) { end = i; break; }
    }
    return { start: 0, end };
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === header) {
      const start = i + 1;
      let end = lines.length;
      for (let j = start; j < lines.length; j++) {
        if (/^\s*\[[^\]]+\]\s*(#.*)?$/.test(lines[j])) { end = j; break; }
      }
      return { start, end };
    }
  }
  // Section absent
  return { start: lines.length, end: lines.length };
}

function tomlLiteral(v: unknown): string {
  if (typeof v === 'string') {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return `[${v.map(x => tomlLiteral(x)).join(', ')}]`;
  }
  throw new Error(`unsupported TOML value type: ${typeof v}`);
}

// ─── YAML ops (text-surgical for simple cases) ──────────────────────

function applyYamlOp(content: string, op: DeltaOperation): string {
  const path = String(op.target.path);
  const segs = parseDottedPath(path);
  if (segs.length === 0) throw new Error(`empty path`);

  const lines = content.split('\n');
  // Find target line by tracking indentation hierarchy
  const target = findYamlKeyLine(lines, segs);

  if (op.op === 'set') {
    const valueLiteral = yamlLiteral(op.value);
    if (target.found) {
      // Replace the value portion only on a single-line `key: value`
      const line = lines[target.lineIdx];
      const m = line.match(/^(\s*)([^:]+):\s*(.*)$/);
      if (!m) throw new Error(`yaml line malformed at ${path}`);
      lines[target.lineIdx] = `${m[1]}${segs[segs.length - 1]}: ${valueLiteral}`;
      // If subsequent lines are nested children of this key, drop them
      const childIndent = (m[1].length) + 2;
      let drop = target.lineIdx + 1;
      while (drop < lines.length && (lines[drop].trim() === '' || leadingSpaces(lines[drop]) >= childIndent)) {
        if (lines[drop].trim() === '') break; // keep blank lines as section separators
        drop++;
      }
      if (drop > target.lineIdx + 1) lines.splice(target.lineIdx + 1, drop - target.lineIdx - 1);
      return lines.join('\n');
    }
    // Insert: walk segments, create missing parents
    return insertYamlKey(lines, segs, op.value).join('\n');
  }

  if (op.op === 'remove') {
    if (!target.found) throw new Error(`yaml key not found: ${path}`);
    const line = lines[target.lineIdx];
    const indent = line.match(/^(\s*)/)![1].length;
    let end = target.lineIdx + 1;
    while (end < lines.length) {
      if (lines[end].trim() === '') { end++; continue; }
      if (leadingSpaces(lines[end]) > indent) end++;
      else break;
    }
    lines.splice(target.lineIdx, end - target.lineIdx);
    return lines.join('\n');
  }

  throw new Error(`yaml_key supports only set/remove (got ${op.op})`);
}

function findYamlKeyLine(lines: string[], segs: string[]): { found: boolean; lineIdx: number } {
  let segIdx = 0;
  let parentIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^(\s*)([^:#\s][^:]*):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2].trim();
    if (segIdx === 0) {
      if (indent === 0 && key === segs[0]) {
        segIdx++;
        parentIndent = indent;
        if (segIdx === segs.length) return { found: true, lineIdx: i };
      }
    } else {
      if (indent <= parentIndent) {
        // Backed out — not found under this branch; reset
        segIdx = 0;
        parentIndent = -1;
        i--; // re-evaluate this line as potential top-level
        continue;
      }
      if (indent === parentIndent + 2 && key === segs[segIdx]) {
        segIdx++;
        parentIndent = indent;
        if (segIdx === segs.length) return { found: true, lineIdx: i };
      }
    }
  }
  return { found: false, lineIdx: -1 };
}

function insertYamlKey(lines: string[], segs: string[], value: unknown): string[] {
  // Simplest reliable strategy: append at EOF as a top-level fragment.
  // For nested missing parents, build the chain.
  const indent = (n: number) => '  '.repeat(n);
  const buf: string[] = [];
  for (let i = 0; i < segs.length - 1; i++) {
    buf.push(`${indent(i)}${segs[i]}:`);
  }
  buf.push(`${indent(segs.length - 1)}${segs[segs.length - 1]}: ${yamlLiteral(value)}`);
  // Ensure separation
  const result = [...lines];
  if (result.length > 0 && result[result.length - 1].trim() !== '') result.push('');
  result.push(...buf);
  return result;
}

function yamlLiteral(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    if (/^[a-zA-Z0-9_./\- ]+$/.test(v) && !['true','false','null','yes','no'].includes(v.toLowerCase())) {
      return v;
    }
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map(yamlLiteral).join(', ')}]`;
  }
  throw new Error(`unsupported YAML value type: ${typeof v}`);
}

function leadingSpaces(s: string): number {
  return s.match(/^( *)/)![1].length;
}

// ─── Markdown section ops ───────────────────────────────────────────

function applySectionOp(content: string, op: DeltaOperation): string {
  const heading = String(op.target.section);
  const range = findMarkdownSection(content, heading);
  if (range === null) throw new Error(`markdown section not found: '${heading}'`);

  const sectionText = content.slice(range.start, range.end);

  if (op.op === 'modify') {
    const before = String(op.before);
    const after = String(op.after);
    const occurrences = countOccurrences(sectionText, before);
    if (occurrences === 0) throw new Error(`'before' text not found in section '${heading}'`);
    if (occurrences > 1) throw new Error(`'before' text not unique in section '${heading}' (${occurrences} matches)`);
    const newSection = sectionText.replace(before, after);
    return content.slice(0, range.start) + newSection + content.slice(range.end);
  }

  if (op.op === 'append') {
    const value = String(op.value ?? '');
    const trimmedSection = sectionText.replace(/\s+$/, '');
    const newSection = trimmedSection + '\n' + (value.startsWith('\n') ? value.slice(1) : value);
    const tail = sectionText.slice(trimmedSection.length); // preserve trailing blank lines
    return content.slice(0, range.start) + newSection + tail + content.slice(range.end);
  }

  throw new Error(`spec_section supports only modify/append (got ${op.op})`);
}

interface MdRange { start: number; end: number; level: number; }

function findMarkdownSection(content: string, heading: string): MdRange | null {
  const trimmedHeading = heading.trim();
  const levelMatch = trimmedHeading.match(/^(#+)\s+/);
  if (!levelMatch) throw new Error(`section locator must include heading prefix (e.g. '## Title'): '${heading}'`);
  const level = levelMatch[1].length;

  const lines = content.split('\n');
  let lineStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === trimmedHeading) {
      // Section content starts after this heading line
      const start = lineStart + lines[i].length + 1; // +1 for the \n after heading
      // Find next heading at same-or-higher level
      let cursor = start;
      let end = content.length;
      for (let j = i + 1; j < lines.length; j++) {
        const nm = lines[j].match(/^(#+)\s+/);
        if (nm && nm[1].length <= level) {
          end = cursor;
          break;
        }
        cursor += lines[j].length + 1;
      }
      return { start, end, level };
    }
    lineStart += lines[i].length + 1;
  }
  return null;
}

// ─── Text-match ops (raw) ───────────────────────────────────────────

function applyTextMatchOp(content: string, op: DeltaOperation): string {
  const before = String(op.before);
  const occurrences = countOccurrences(content, before);
  if (occurrences === 0) throw new Error(`text not found: ${truncate(before)}`);
  if (occurrences > 1) throw new Error(`text not unique (${occurrences} matches): ${truncate(before)}`);
  if (op.op === 'modify') {
    return content.replace(before, String(op.after ?? ''));
  }
  if (op.op === 'remove') {
    return content.replace(before, '');
  }
  throw new Error(`text_match supports only modify/remove`);
}

// ─── Apply (write to disk) ───────────────────────────────────────────

export function applyPlan(plan: ChangePlan, opts: { dryRun?: boolean } = {}): { written: string[]; deleted: string[] } {
  if (opts.dryRun) return { written: [], deleted: [] };
  const written: string[] = [];
  const deleted: string[] = [];
  for (const c of plan.changes) {
    if (c.action === 'delete') {
      if (existsSync(c.file)) unlinkSync(c.file);
      deleted.push(c.relPath);
    } else {
      mkdirSync(dirname(c.file), { recursive: true });
      writeFileSync(c.file, c.after ?? '', 'utf8');
      written.push(c.relPath);
    }
  }
  return { written, deleted };
}

export function applyDelta(
  deltaPath: string,
  projectRoot: string,
  opts: { dryRun?: boolean } = {},
): { plan: ChangePlan; written: string[]; deleted: string[] } {
  const delta = loadDelta(deltaPath);
  const plan = planApply(delta, projectRoot);
  plan.dryRun = !!opts.dryRun;
  const result = applyPlan(plan, opts);
  return { plan, ...result };
}

// ─── Diff helpers ────────────────────────────────────────────────────

export function unifiedDiff(relPath: string, before: string | null, after: string | null): string {
  const a = before ?? '';
  const b = after ?? '';
  if (a === b) return '';
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  // Minimal diff: not LCS, just header + line counts. Sufficient for human review.
  const header = [
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    `@@ -1,${aLines.length} +1,${bLines.length} @@`,
  ];
  const body: string[] = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const al = i < aLines.length ? aLines[i] : null;
    const bl = i < bLines.length ? bLines[i] : null;
    if (al === bl) body.push(` ${al}`);
    else {
      if (al !== null) body.push(`-${al}`);
      if (bl !== null) body.push(`+${bl}`);
    }
  }
  return [...header, ...body].join('\n');
}

export function summarizePlan(plan: ChangePlan): string {
  const lines: string[] = [
    `Delta: ${plan.delta.change_id} — ${plan.delta.summary}`,
    `Version: ${plan.delta.base_version} → ${plan.delta.target_version}`,
    `Operations: ${plan.delta.operations.length}`,
    `Files affected: ${plan.changes.length}`,
    '',
  ];
  for (const c of plan.changes) {
    lines.push(`  [${c.action}] ${c.relPath} (ops: ${c.ops.map(i => '#' + i).join(',')})`);
  }
  return lines.join('\n');
}

// ─── Utilities ──────────────────────────────────────────────────────

function parseDottedPath(p: string): string[] {
  // Supports a.b.c and a."b.c".d (quoted segments). Arrays not supported in v1.
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === '.' && !inQuote) {
      if (buf) out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

function isWithin(root: string, candidate: string): boolean {
  const r = normalize(resolve(root));
  const c = normalize(resolve(candidate));
  return c === r || c.startsWith(r + '/');
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function opRepr(op: DeltaOperation): string {
  return `${op.op} ${op.target.kind}:${op.target.file}${op.target.path ? '#' + op.target.path : ''}${op.target.section ? '#' + op.target.section : ''}`;
}

/**
 * Resolve a CR identifier (which may be bare 'CHG-YYYY-NNN' or slug-suffixed
 * 'CHG-YYYY-NNN-<slug>') to its actual directory under changes/.
 *
 * The wdf convention (see INDEX.md links and existing CRs CHG-001..014) is to
 * name proposal directories with a slug suffix. Earlier versions of the CLI
 * assumed bare IDs only, which made `wdf cr apply` / `wdf cr archive` fail on
 * every real CR. This helper restores CLI usability without forcing a rename
 * of the 14 existing CR directories.
 *
 * Resolution order:
 *   1. Exact match: changes/<id>/  (handles user passing the full slug)
 *   2. Unique prefix match: any dir starting with <id> or <id>-  (bare ID input)
 *   3. Fail with a helpful error
 *
 * Throws if idOrSlug is not a valid CR ID prefix, if no dir matches, or if
 * multiple dirs match (ambiguous).
 */
export function resolveCrDir(changesDir: string, idOrSlug: string): string {
  const idPattern = /^CHG-\d{4}-\d{3}(-[a-z0-9][a-z0-9-]*)?$/;
  if (!idPattern.test(idOrSlug)) {
    throw new Error(
      `Invalid CR ID: '${idOrSlug}' (expected CHG-YYYY-NNN or CHG-YYYY-NNN-<slug>)`,
    );
  }

  // 1. Exact match — user passed the full slug (or the dir genuinely has no slug)
  const exactPath = join(changesDir, idOrSlug);
  if (existsSync(exactPath)) {
    return exactPath;
  }

  // 2. Prefix match — user passed bare ID, find the unique slug-suffixed dir
  const bareId = idOrSlug.match(/^(CHG-\d{4}-\d{3})/)![0];
  let entries: string[];
  try {
    entries = readdirSync(changesDir).filter(
      (d) => d === bareId || d.startsWith(`${bareId}-`),
    );
  } catch (e) {
    throw new Error(
      `Cannot read changes/ directory: ${(e as Error).message}`,
    );
  }

  if (entries.length === 0) {
    throw new Error(`Proposal directory not found: changes/${idOrSlug}`);
  }
  if (entries.length > 1) {
    throw new Error(
      `Ambiguous CR ID '${idOrSlug}'. Matches: ${entries.join(', ')}. ` +
        `Pass the full slug to disambiguate.`,
    );
  }
  return join(changesDir, entries[0]);
}

/**
 * CHG-2026-014 — Archive a CR and rewrite canonical specs from delta.yaml.
 *
 * Steps:
 * 1. If `changes/<id>/delta.yaml` exists, plan + apply it (dry-run first).
 * 2. Move `changes/<id>/` to `changes/_archive/<original-dir-name>/`.
 * 3. Return the set of files that were patched.
 *
 * Accepts either bare 'CHG-YYYY-NNN' or slug-suffixed 'CHG-YYYY-NNN-<slug>'
 * via resolveCrDir. The archived directory preserves the original slug.
 */
export async function archiveAndRewrite(
  crId: string,
  projectRoot: string,
  opts?: {
    dryRun?: boolean;
    noRewrite?: boolean;
    noPrdRegen?: boolean;
    noApiRegen?: boolean;
    noDbRegen?: boolean;
  },
): Promise<{ archived: string; patched: string[]; cascadeWarning?: string; dryRun: boolean }> {
  const changesDir = join(projectRoot, 'changes');
  const archiveDir = join(changesDir, '_archive');
  const crDir = resolveCrDir(changesDir, crId);
  const crDirName = basename(crDir);
  const deltaPath = join(crDir, 'delta.yaml');

  const patched: string[] = [];
  const dryRun = opts?.dryRun ?? false;

  // 1. Apply delta to canonical specs (unless --no-rewrite)
  let cascadeWarning: string | undefined;
  if (!opts?.noRewrite && existsSync(deltaPath)) {
    const delta = loadDelta(deltaPath);
    const plan = planApply(delta, projectRoot);
    if (!dryRun) {
      applyPlan(plan);
    }
    patched.push(...plan.changes.map(c => c.relPath));

    // CHG-2026-015 S2/S3: cascade regenerate PRD/api-spec/db-schema when specs/
    // was touched AND source_of_truth is true. Per-target flags allow skipping
    // individual cascades. If source_of_truth is false but specs/ moved,
    // surface guidance so the user knows to flip the flag manually.
    const cascade = maybeCascadeSpecsSync(projectRoot, plan, dryRun, {
      noPrdRegen: opts?.noPrdRegen,
      noApiRegen: opts?.noApiRegen,
      noDbRegen: opts?.noDbRegen,
    });
    patched.push(...cascade.cascadeWrites);
    if (cascade.warning) cascadeWarning = cascade.warning;
  }

  // 2. Move CR to archive (preserve slug)
  const target = join(archiveDir, crDirName);
  if (existsSync(target)) {
    throw new Error(`Already archived: changes/_archive/${crDirName}`);
  }

  if (!dryRun) {
    mkdirSync(archiveDir, { recursive: true });
    renameSync(crDir, target);
  }

  return {
    archived: dryRun ? `would archive: changes/_archive/${crDirName}` : `changes/_archive/${crDirName}`,
    patched,
    cascadeWarning,
    dryRun,
  };
}

/**
 * CHG-2026-015 S2/S3 — Cascade regenerate derived artifacts when a v2 delta
 * touched specs/.
 *
 * Runs only after the spec files have been written (so loadSpecDocs sees the
 * new content). If `[specs] source_of_truth = true`, calls:
 *   - forwardSync         → PRD §2 (skip if noPrdRegen)
 *   - forwardSyncApiSpec  → api-spec.yaml paths/schemas (skip if noApiRegen)
 *   - forwardSyncDbSchema → db-schema.md tables (skip if noDbRegen)
 * If `source_of_truth = false`, returns guidance but no writes.
 *
 * Returns the list of cascade-written relPaths plus an optional warning.
 */
export function maybeCascadeSpecsSync(
  projectRoot: string,
  plan: ChangePlan,
  dryRun: boolean,
  regenOpts: { noPrdRegen?: boolean; noApiRegen?: boolean; noDbRegen?: boolean } = {},
): { cascadeWrites: string[]; warning?: string } {
  const touchedSpecs = plan.changes.filter(c =>
    c.relPath.startsWith('_wdf_output/specs/') && c.relPath.endsWith('/spec.md'),
  );
  if (touchedSpecs.length === 0) {
    return { cascadeWrites: [] };
  }

  const { config } = loadConfig(projectRoot);
  const specsDir = getSpecsDir(config, projectRoot);
  const prdPath = join(projectRoot, '_wdf_output', 'prd.md');
  const apiPath = getApiSpecPath(config, projectRoot);
  const dbPath = getDbSchemaPath(config, projectRoot);

  if (!config.specs.source_of_truth) {
    return {
      cascadeWrites: [],
      warning:
        'specs/ updated but PRD is canonical (source_of_truth=false). ' +
        "Run 'wdf spec sync --forward' after flipping [specs] source_of_truth = true.",
    };
  }

  const cascadeWrites: string[] = [];
  const warnings: string[] = [];
  const docs = loadSpecDocs(specsDir);

  // PRD cascade
  if (!regenOpts.noPrdRegen) {
    if (existsSync(prdPath)) {
      const prdText = readFileSync(prdPath, 'utf8');
      const result = forwardSync(docs, prdText, prdPath, {
        specsDir,
        sourceOfTruth: config.specs.source_of_truth,
        managedRegionMarker: config.specs.managed_region_marker,
        enforceUniqueRequirementNames: config.specs.enforce_unique_requirement_names,
      });
      const { applied } = applySync(result, dryRun);
      cascadeWrites.push(...applied.map(w => relative(projectRoot, w.path)));
      warnings.push(...result.warnings);
    } else {
      warnings.push(`source_of_truth=true but PRD not found at ${relative(projectRoot, prdPath)}; PRD cascade skipped.`);
    }
  }

  // api-spec.yaml cascade
  if (!regenOpts.noApiRegen) {
    if (existsSync(apiPath)) {
      const apiText = readFileSync(apiPath, 'utf8');
      const result = forwardSyncApiSpec(docs, apiText, apiPath, {
        specsDir,
        sourceOfTruth: config.specs.source_of_truth,
        managedRegionMarker: config.specs.managed_region_marker,
        enforceUniqueRequirementNames: config.specs.enforce_unique_requirement_names,
      });
      const { applied } = applySync(result, dryRun);
      cascadeWrites.push(...applied.map(w => relative(projectRoot, w.path)));
      warnings.push(...result.warnings);
    } else {
      warnings.push(`api-spec.yaml not found at ${relative(projectRoot, apiPath)}; api cascade skipped.`);
    }
  }

  // db-schema.md cascade
  if (!regenOpts.noDbRegen) {
    if (existsSync(dbPath)) {
      const dbText = readFileSync(dbPath, 'utf8');
      const result = forwardSyncDbSchema(docs, dbText, dbPath, {
        specsDir,
        sourceOfTruth: config.specs.source_of_truth,
        managedRegionMarker: config.specs.managed_region_marker,
        enforceUniqueRequirementNames: config.specs.enforce_unique_requirement_names,
      });
      const { applied } = applySync(result, dryRun);
      cascadeWrites.push(...applied.map(w => relative(projectRoot, w.path)));
      warnings.push(...result.warnings);
    } else {
      warnings.push(`db-schema.md not found at ${relative(projectRoot, dbPath)}; db cascade skipped.`);
    }
  }

  return {
    cascadeWrites,
    warning: warnings.length > 0 ? warnings.join('; ') : undefined,
  };
}
