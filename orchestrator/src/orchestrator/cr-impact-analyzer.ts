/**
 * cr-impact-analyzer.ts — Map a Change Request's surface area to its
 * downstream traceability impact.
 *
 * Inputs:
 *   - a `Delta` (CHG-2026-002) or a raw list of {file, section?} change anchors
 *   - a `TraceabilityGraph` (CHG-2026-003)
 *
 * Output:
 *   - `ImpactReport` listing affected nodes per kind, plus the phases that
 *     should transition to UNLOCK_RESOLVE (Task 4).
 *
 * Strategy:
 *   1. Map every change anchor to seed graph nodes (the artefacts directly
 *      modified).
 *   2. BFS downstream via `derives_from` / `belongs_to` / `implements` /
 *      `tests` edges (see traceability-graph.ts:downstream).
 *   3. Group by node kind; suggest the phases that own each kind.
 */

import type { Delta, DeltaOperation } from './cr-applier.js';
import { isV2Operation } from './cr-applier.js';
import {
  type TraceabilityGraph,
  type TraceNode,
  type AdjacencyIndex,
  indexGraph,
  downstream,
} from './traceability-graph.js';
import {
  type PhaseStatus,
  validateStateTransition,
} from './fsm-engine.js';
import { deriveSemanticFromOp } from './cr-applier.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface ChangeAnchor {
  /** Project-relative path. */
  file: string;
  /** Optional markdown section heading (full line). */
  section?: string;
  /** Optional dotted key path (toml/yaml). */
  path?: string;
  /** Optional semantic classification (OpenSpec-style). */
  semantic?: 'added' | 'modified' | 'removed';
}

export interface ImpactReport {
  change_id?: string;
  /** The seed nodes derived from change anchors. */
  seeds: string[];
  /** Every node reachable from seeds (including seeds). */
  affected_ids: string[];
  /** Affected nodes grouped by kind. */
  by_kind: Record<string, TraceNode[]>;
  /** Phases that should transition to UNLOCK_RESOLVE. */
  unlock_phases: string[];
  /** Anchors that mapped to NO graph node (visible to reviewer). */
  unmapped_anchors: ChangeAnchor[];
  /** Semantic summary — count of operations by classification. */
  semantic_summary: {
    added: number;
    modified: number;
    removed: number;
    unspecified: number;
  };
}

// ─── Anchor → seed mapping ──────────────────────────────────────────

/**
 * Seed mapping rules:
 *   prd.md / spec section heading "REQ-N"  → REQ-N
 *   epics.md heading containing EPIC-N     → EPIC-N
 *   _wdf_output/stories/<file>.md          → STORY whose source matches
 *   api-spec.yaml + path/key               → API node by path+method
 *   db-schema.md heading                   → DB:<table>
 *   any test file                          → every TEST node in that file
 *
 * Anchors without a mapping are recorded in `unmapped_anchors` so the
 * reviewer knows the analysis was not exhaustive.
 */
export function anchorsToSeeds(
  anchors: ChangeAnchor[],
  graph: TraceabilityGraph,
): { seeds: Set<string>; unmapped: ChangeAnchor[] } {
  const seeds = new Set<string>();
  const unmapped: ChangeAnchor[] = [];

  for (const a of anchors) {
    const matched = matchAnchor(a, graph);
    if (matched.length === 0) {
      unmapped.push(a);
      continue;
    }
    for (const id of matched) seeds.add(id);
  }
  return { seeds, unmapped };
}

function matchAnchor(a: ChangeAnchor, g: TraceabilityGraph): string[] {
  const out: string[] = [];
  const file = a.file;

  // Tests: every TEST node sourced from this file
  if (/\.(test|spec)\.(t|j)sx?$/.test(file)) {
    for (const n of g.nodes) {
      if (n.kind === 'TEST' && n.source === file) out.push(n.id);
    }
    if (out.length) return out;
  }

  // Story file
  if (/stories\/[^/]+\.md$/.test(file)) {
    for (const n of g.nodes) {
      if (n.kind === 'STORY' && n.source && n.source.endsWith(basename(file))) out.push(n.id);
    }
    if (out.length) return out;
  }

  // Section-driven anchors
  if (a.section) {
    const reqM = a.section.match(/\b(REQ-\d+)\b/);
    if (reqM && g.nodes.some(n => n.id === reqM[1])) out.push(reqM[1]);
    const epicM = a.section.match(/\b(EPIC-\d+)\b/);
    if (epicM && g.nodes.some(n => n.id === epicM[1])) out.push(epicM[1]);
    const jtbdM = a.section.match(/\b(JTBD-\d+)\b/);
    if (jtbdM && g.nodes.some(n => n.id === jtbdM[1])) out.push(jtbdM[1]);
    if (out.length) return out;
  }

  // PRD / epics.md without section: too coarse — return all REQ / EPIC nodes
  if (file === 'prd.md' || file.endsWith('/prd.md')) {
    for (const n of g.nodes) if (n.kind === 'REQ') out.push(n.id);
  } else if (file === 'epics.md' || file.endsWith('/epics.md')) {
    for (const n of g.nodes) if (n.kind === 'EPIC') out.push(n.id);
  } else if (file === 'api-spec.yaml' || file.endsWith('/api-spec.yaml')) {
    if (a.path) {
      // path like paths."/todos".get → API:GET /todos
      const apiId = openApiPathToNodeId(a.path);
      if (apiId && g.nodes.some(n => n.id === apiId)) out.push(apiId);
    }
    if (out.length === 0) {
      for (const n of g.nodes) if (n.kind === 'API') out.push(n.id);
    }
  } else if (file === 'db-schema.md' || file.endsWith('/db-schema.md')) {
    if (a.section) {
      const tm = a.section.match(/##\s+([a-z][a-z0-9_]*)/i);
      if (tm) {
        const id = `DB:${tm[1].toLowerCase()}`;
        if (g.nodes.some(n => n.id === id)) out.push(id);
      }
    }
    if (out.length === 0) {
      for (const n of g.nodes) if (n.kind === 'DB') out.push(n.id);
    }
  }
  return out;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

function openApiPathToNodeId(dotted: string): string | null {
  // paths."/todos/{id}".get  → API:GET /todos/{id}
  const m = dotted.match(/^paths\.["']?([^"']+)["']?\.([a-z]+)$/);
  if (!m) return null;
  return `API:${m[2].toUpperCase()} ${m[1]}`;
}

// ─── Delta → anchors ─────────────────────────────────────────────────

export function deltaToAnchors(delta: Delta): ChangeAnchor[] {
  // CHG-2026-015 S2: v2 ops contribute domain-level anchors; v1 ops map as before.
  return delta.operations.map(op => {
    if (isV2Operation(op)) {
      const semantic = op.op === 'ADDED' ? 'added'
        : op.op === 'REMOVED' ? 'removed' : 'modified';
      const section = op.op === 'REMOVED'
        ? op.requirement_id
        : op.requirement?.id ?? op.requirement?.name;
      return {
        file: `_wdf_output/specs/${op.domain}/spec.md`,
        section,
        path: undefined,
        semantic,
      } as ChangeAnchor;
    }
    return opToAnchor(op);
  });
}

function opToAnchor(op: DeltaOperation): ChangeAnchor {
  // Carry through explicit semantic classification if the CR author set it;
  // otherwise infer from the op so legacy CRs still get ADDED/MODIFIED/REMOVED
  // bucketing in impact reports.
  return {
    file: op.target.file,
    section: op.target.section,
    path: op.target.path,
    semantic: op.semantic ?? deriveSemanticFromOp(op.op),
  };
}

// ─── Phase mapping ───────────────────────────────────────────────────

const KIND_TO_PHASES: Record<string, string[]> = {
  JTBD:   ['1.3', '2.5'],
  REQ:    ['2.7'],
  EPIC:   ['3.6'],
  STORY:  ['3.7'],
  API:    ['3.8'],
  DB:     ['3.8'],
  TEST:   ['4.5', '4.6'],
  COMMIT: [],
};

function phasesForKinds(kinds: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const k of kinds) for (const p of KIND_TO_PHASES[k] ?? []) set.add(p);
  return Array.from(set).sort();
}

// ─── Top-level analyzer ─────────────────────────────────────────────

export function analyzeImpact(
  anchors: ChangeAnchor[],
  graph: TraceabilityGraph,
  changeId?: string,
): ImpactReport {
  const idx: AdjacencyIndex = indexGraph(graph);
  const { seeds, unmapped } = anchorsToSeeds(anchors, graph);
  const reachable = downstream(idx, seeds);

  const byKind: Record<string, TraceNode[]> = {};
  for (const id of reachable) {
    const n = idx.byId.get(id);
    if (!n) continue;
    (byKind[n.kind] ??= []).push(n);
  }
  const unlock = phasesForKinds(Object.keys(byKind));

  const semantic_summary = { added: 0, modified: 0, removed: 0, unspecified: 0 };
  for (const a of anchors) {
    const s = a.semantic;
    if (s === 'added') semantic_summary.added++;
    else if (s === 'modified') semantic_summary.modified++;
    else if (s === 'removed') semantic_summary.removed++;
    else semantic_summary.unspecified++;
  }

  return {
    change_id: changeId,
    seeds: Array.from(seeds).sort(),
    affected_ids: Array.from(reachable).sort(),
    by_kind: byKind,
    unlock_phases: unlock,
    unmapped_anchors: unmapped,
    semantic_summary,
  };
}

export function analyzeDeltaImpact(delta: Delta, graph: TraceabilityGraph): ImpactReport {
  return analyzeImpact(deltaToAnchors(delta), graph, delta.change_id);
}

// ─── Formatter ───────────────────────────────────────────────────────

export function formatImpactReport(r: ImpactReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════');
  lines.push(`CR Impact${r.change_id ? ` — ${r.change_id}` : ''}`);
  lines.push('═══════════════════════════════════════════');
  lines.push(`  Seeds:             ${r.seeds.length}`);
  lines.push(`  Affected nodes:    ${r.affected_ids.length}`);
  lines.push(`  Unlock phases:     ${r.unlock_phases.join(', ') || '(none)'}`);
  // Semantic summary (OpenSpec-style ADDED/MODIFIED/REMOVED classification).
  const s = r.semantic_summary;
  const totalOps = s.added + s.modified + s.removed + s.unspecified;
  if (totalOps > 0) {
    lines.push('');
    lines.push('  Semantic classification:');
    lines.push(`    ➕ ADDED:      ${s.added}`);
    lines.push(`    ✏️  MODIFIED:   ${s.modified}`);
    lines.push(`    ❌ REMOVED:    ${s.removed}`);
    if (s.unspecified > 0) lines.push(`    ⚠  UNSPECIFIED: ${s.unspecified}`);
  }
  lines.push('');
  for (const kind of Object.keys(r.by_kind).sort()) {
    const ns = r.by_kind[kind];
    lines.push(`  ${kind} (${ns.length}):`);
    for (const n of ns.slice(0, 20)) {
      lines.push(`      • ${n.id}${n.title ? `  — ${n.title}` : ''}`);
    }
    if (ns.length > 20) lines.push(`      … ${ns.length - 20} more`);
  }
  if (r.unmapped_anchors.length) {
    lines.push('');
    lines.push(`  ! Unmapped anchors (no graph match — review manually):`);
    for (const a of r.unmapped_anchors) {
      lines.push(`      • ${a.file}${a.section ? ` § ${a.section}` : ''}${a.path ? ` ${a.path}` : ''}`);
    }
  }
  lines.push('═══════════════════════════════════════════');
  return lines.join('\n');
}

// ─── FSM integration (Task 4) ────────────────────────────────────────

export interface UnlockTransition {
  phase: string;          // sub-phase id, e.g. "3.7"
  from: PhaseStatus;
  to: 'UNLOCK_RESOLVE';
  /** True iff fsm-engine.validateStateTransition accepts this hop. */
  valid: boolean;
  /** Reason from validateStateTransition when not valid. */
  reason?: string;
}

/**
 * Plan a batch of UNLOCK_RESOLVE transitions for the phases an ImpactReport
 * declares blocked. Returns one entry per phase with validation status.
 *
 * This is a *plan* only — call `applyUnlockTransitions` (or fsm-engine
 * directly) when the CR is approved. Phases whose current state is NOT
 * `LOCKED` are reported as skipped (already unlocked, in progress, etc.)
 * with `valid: false` so the caller can surface the discrepancy.
 *
 * Phase id format matches sprint-status keys: "1.1", "2.7", "4.13", …
 */
export function planUnlockTransitions(
  impact: ImpactReport,
  currentStatus: Record<string, PhaseStatus>,
): UnlockTransition[] {
  const plan: UnlockTransition[] = [];
  for (const phase of impact.unlock_phases) {
    const from = currentStatus[phase] ?? 'NOT_STARTED';
    const validation = validateStateTransition(from, 'UNLOCK_RESOLVE');
    plan.push({
      phase,
      from,
      to: 'UNLOCK_RESOLVE',
      valid: validation.valid,
      reason: validation.valid ? undefined : validation.reason,
    });
  }
  return plan;
}

export function formatUnlockPlan(plan: UnlockTransition[]): string {
  const lines: string[] = [];
  lines.push('UNLOCK_RESOLVE plan:');
  for (const t of plan) {
    const tag = t.valid ? '✓' : '⊘';
    lines.push(`  ${tag} phase ${t.phase}: ${t.from} → ${t.to}${t.reason ? `  (${t.reason})` : ''}`);
  }
  return lines.join('\n');
}
