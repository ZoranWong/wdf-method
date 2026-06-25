/**
 * phase4-entry-gate.ts — the fail-closed Phase 3.9 → Phase 4 boundary.
 *
 * Phase 1-3 produce the spec (PRD, stories, api-spec, db-schema, checklists).
 * Phase 4 turns that spec into code. This gate is the last point at which the
 * spec can be rejected for INTERNAL INCONSISTENCY before any agent writes a
 * line of implementation. It composes three families of check:
 *
 *   1. Semantic consistency — REQ_COVERAGE, API_SCOPE_MAPPING,
 *      DB_API_CONSISTENCY. Every PRD REQ is covered by a story, every endpoint
 *      is claimed, every entity an endpoint references exists in the schema.
 *   2. Traceability — every STORY derives from a REQ, every REQ is implemented
 *      by a STORY.
 *   3. Checklist — every story checklist that EXISTS is fully ticked.
 *
 * Crucially, TEST-dependent checks are EXCLUDED. Tests are authored during
 * Phase 4 (dev → testing), so at entry they do not exist yet; gating on them
 * (AC_TEST_BINDING, traceability's STORY_NO_TEST) would make Phase 4
 * unreachable for every project. Those checks belong to post-implementation
 * gates and to `wdf check`'s advisory pass, not here.
 *
 * Default-on, opt-out: governed by the same `semantic_gate.enabled` flag as
 * the advisory `wdf check` pass. When disabled, the gate reports `enabled:
 * false` and `ok: true` so legacy / in-flight projects are not retro-blocked.
 *
 * Checklists are optional by design (CLAUDE.md), so a MISSING checklist is not
 * a gap — only an existing-but-incomplete checklist blocks entry.
 */

import { runSemanticRules } from './semantic-consistency.js';
import { evaluateTraceabilityGate } from './traceability-gate.js';
import { listChecklists } from './checklist-cmd.js';
import { isSemanticGateEnabled } from './config.js';

export type Phase4GapCategory = 'semantic' | 'traceability' | 'checklist';

export interface Phase4EntryGap {
  category: Phase4GapCategory;
  /** Rule id, traceability node id, or story id depending on category. */
  id: string;
  message: string;
}

export interface Phase4EntryGateResult {
  /** Overall verdict. Always true when the gate is disabled. */
  ok: boolean;
  /** False when the project opted out via semantic_gate.enabled = false. */
  enabled: boolean;
  gaps: Phase4EntryGap[];
  totals: { semantic: number; traceability: number; checklist: number };
}

/** Traceability gap kinds that depend on TEST nodes — excluded at entry. */
const TEST_DEPENDENT_TRACE_KINDS = new Set<string>(['STORY_NO_TEST']);

export function evaluatePhase4EntryGate(projectRoot: string): Phase4EntryGateResult {
  if (!isSemanticGateEnabled(projectRoot)) {
    return {
      ok: true,
      enabled: false,
      gaps: [],
      totals: { semantic: 0, traceability: 0, checklist: 0 },
    };
  }

  const gaps: Phase4EntryGap[] = [];

  // 1. Semantic consistency (excluding test-dependent rules).
  const semantic = runSemanticRules(projectRoot, { excludeTestDependent: true });
  for (const f of semantic) {
    gaps.push({ category: 'semantic', id: f.ruleId, message: f.message });
  }

  // 2. Traceability, minus the test-dependent invariant (tests don't exist yet).
  const trace = evaluateTraceabilityGate(projectRoot);
  for (const g of trace.gaps) {
    if (TEST_DEPENDENT_TRACE_KINDS.has(g.kind)) continue;
    gaps.push({ category: 'traceability', id: g.id, message: `[${g.kind}] ${g.reason}` });
  }

  // 3. Checklists: only existing-but-incomplete ones block. Missing = optional.
  const checklists = listChecklists({ projectRoot });
  for (const c of checklists) {
    if (!c.ok) {
      gaps.push({
        category: 'checklist',
        id: c.storyId,
        message: `story ${c.storyId} checklist incomplete (${c.unchecked}/${c.total} unchecked) — run \`wdf checklist verify ${c.storyId}\``,
      });
    }
  }

  return {
    ok: gaps.length === 0,
    enabled: true,
    gaps,
    totals: {
      semantic: gaps.filter(g => g.category === 'semantic').length,
      traceability: gaps.filter(g => g.category === 'traceability').length,
      checklist: gaps.filter(g => g.category === 'checklist').length,
    },
  };
}

export function formatPhase4EntryGate(result: Phase4EntryGateResult): string {
  if (!result.enabled) {
    return 'Phase 4 entry gate: DISABLED (semantic_gate.enabled = false) — proceeding without spec-consistency checks';
  }
  if (result.ok) {
    return 'Phase 4 entry gate: PASS — spec is internally consistent (REQ coverage, API scope, DB consistency, traceability, checklists)';
  }
  const lines = [
    `Phase 4 entry gate: FAIL — ${result.gaps.length} gap(s) must be resolved before implementation:`,
    `  semantic: ${result.totals.semantic} | traceability: ${result.totals.traceability} | checklist: ${result.totals.checklist}`,
  ];
  for (const g of result.gaps.slice(0, 30)) {
    lines.push(`  • [${g.category}] ${g.message}`);
  }
  if (result.gaps.length > 30) {
    lines.push(`  … and ${result.gaps.length - 30} more`);
  }
  return lines.join('\n');
}
