/**
 * phase4-exit-gate.ts — the fail-closed Phase 4 → MERGED boundary.
 *
 * The symmetric complement of phase4-entry-gate.ts. The ENTRY gate
 * deliberately EXCLUDES test-dependent checks because tests are authored
 * DURING Phase 4 (dev → testing); gating on them at entry would make Phase 4
 * unreachable. This EXIT gate enforces exactly those excluded checks before a
 * story is allowed to reach MERGED — closing the test side of the
 * traceability chain (AC → TEST) that CLAUDE.md design decision #6 requires.
 *
 * It composes three families of check:
 *
 *   1. test_binding   — AC_TEST_BINDING: every story acceptance criterion is
 *      bound to ≥1 TEST node.
 *   2. traceability   — STORY_NO_TEST: every STORY has ≥1 covering TEST
 *      (the entry gate's complement — STORY_NO_REQ / REQ_NOT_COVERED are
 *      already enforced at entry).
 *   3. drift          — spec-vs-code divergence: missing_test (story AC with
 *      no test candidate) + unspec_endpoint (code route absent from
 *      api-spec.yaml). orphan_endpoint is excluded — a spec-declared endpoint
 *      with no code is an implementation TODO, not a merge blocker.
 *
 * Default-on, opt-out: governed by the same `semantic_gate.enabled` flag as
 * the entry gate. When disabled, reports `enabled: false` and `ok: true`.
 *
 * Per-story scoping: when `opts.storyId` is given, only gaps tied to that
 * story are kept (used by the per-merge hard gate so one story's missing test
 * never blocks an unrelated story's merge). Story-agnostic drift such as
 * unspec_endpoint is dropped from the scoped view.
 */

import { AcTestBindingRule } from './linter/rules/ac-test-binding.js';
import type { LintResult } from './linter/types.js';
import { evaluateTraceabilityGate } from './traceability-gate.js';
import { checkSpecDrift } from './spec-drift-checker.js';
import { isSemanticGateEnabled } from './config.js';

export type Phase4ExitGapCategory = 'test_binding' | 'traceability' | 'drift';

export interface Phase4ExitGap {
  category: Phase4ExitGapCategory;
  /** Rule id, traceability node id, or drift identifier depending on category. */
  id: string;
  message: string;
}

export interface Phase4ExitGateResult {
  /** Overall verdict. Always true when the gate is disabled. */
  ok: boolean;
  /** False when the project opted out via semantic_gate.enabled = false. */
  enabled: boolean;
  gaps: Phase4ExitGap[];
  totals: { test_binding: number; traceability: number; drift: number };
}

export interface Phase4ExitGateOptions {
  /** Scope gaps to a single story (per-merge hard gate). */
  storyId?: string;
}

/** Drift kinds that block a merge. orphan_endpoint is a TODO, not a blocker. */
const BLOCKING_DRIFT_KINDS = new Set<string>(['missing_test', 'unspec_endpoint']);

/** Keep a gap only if it is tied to the scoped story. */
function matchesStory(gap: Phase4ExitGap, storyId: string): boolean {
  return gap.id === storyId || gap.id.includes(storyId) || gap.message.includes(storyId);
}

export function evaluatePhase4ExitGate(
  projectRoot: string,
  opts: Phase4ExitGateOptions = {},
): Phase4ExitGateResult {
  if (!isSemanticGateEnabled(projectRoot)) {
    return {
      ok: true,
      enabled: false,
      gaps: [],
      totals: { test_binding: 0, traceability: 0, drift: 0 },
    };
  }

  let gaps: Phase4ExitGap[] = [];

  // 1. test_binding — every AC bound to a TEST.
  const acResults = AcTestBindingRule.check({ projectRoot, files: [], config: null }) as LintResult[];
  for (const r of acResults) {
    // The rule's `file` is the story source (stories/<storyId>.md), so the
    // story id lives in the path — use the file as the gap id for scoping.
    gaps.push({ category: 'test_binding', id: r.file, message: r.message });
  }

  // 2. traceability — only the test-dependent invariant (entry gate's complement).
  const trace = evaluateTraceabilityGate(projectRoot);
  for (const g of trace.gaps) {
    if (g.kind !== 'STORY_NO_TEST') continue;
    gaps.push({ category: 'traceability', id: g.id, message: `[${g.kind}] ${g.reason}` });
  }

  // 3. drift — missing_test + unspec_endpoint.
  const drift = checkSpecDrift(projectRoot);
  for (const d of drift.drift) {
    if (!BLOCKING_DRIFT_KINDS.has(d.kind)) continue;
    gaps.push({ category: 'drift', id: d.identifier, message: `[${d.kind}] ${d.message}` });
  }

  // Per-story scoping: keep only gaps tied to the scoped story.
  if (opts.storyId) {
    const storyId = opts.storyId;
    gaps = gaps.filter(g => matchesStory(g, storyId));
  }

  return {
    ok: gaps.length === 0,
    enabled: true,
    gaps,
    totals: {
      test_binding: gaps.filter(g => g.category === 'test_binding').length,
      traceability: gaps.filter(g => g.category === 'traceability').length,
      drift: gaps.filter(g => g.category === 'drift').length,
    },
  };
}

export function formatPhase4ExitGate(result: Phase4ExitGateResult): string {
  if (!result.enabled) {
    return 'Phase 4 exit gate: DISABLED (semantic_gate.enabled = false) — proceeding without test-binding / drift checks';
  }
  if (result.ok) {
    return 'Phase 4 exit gate: PASS — every AC is test-bound, every story has a covering TEST, no spec/code drift';
  }
  const lines = [
    `Phase 4 exit gate: FAIL — ${result.gaps.length} gap(s) must be resolved before merge:`,
    `  test_binding: ${result.totals.test_binding} | traceability: ${result.totals.traceability} | drift: ${result.totals.drift}`,
  ];
  for (const g of result.gaps.slice(0, 30)) {
    lines.push(`  • [${g.category}] ${g.message}`);
  }
  if (result.gaps.length > 30) {
    lines.push(`  … and ${result.gaps.length - 30} more`);
  }
  return lines.join('\n');
}
