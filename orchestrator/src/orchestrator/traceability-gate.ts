/**
 * traceability-gate.ts — Phase 3.9 → Phase 4 entry gate.
 *
 * Joins the in-memory traceability graph (JTBD → REQ → STORY → TEST) and
 * enforces three invariants before implementation may begin:
 *
 *   1. STORY_NO_REQ      — every STORY must derive from at least one REQ.
 *   2. REQ_NOT_COVERED   — every REQ must be implemented by ≥1 STORY.
 *   3. STORY_NO_TEST     — every STORY must have ≥1 covering TEST node.
 *
 * Used by gate-evaluator when a Gate Card declares
 *   `type: traceability_complete`
 *
 * Fail-closed by design: any missing edge surfaces as a structured gap.
 */
import { buildTraceabilityGraph } from './traceability-graph.js';

export type TraceabilityGapKind = 'STORY_NO_REQ' | 'REQ_NOT_COVERED' | 'STORY_NO_TEST';

export interface TraceabilityGap {
  kind: TraceabilityGapKind;
  id: string;
  reason: string;
}

export interface TraceabilityGateResult {
  ok: boolean;
  totals: {
    requirements: number;
    stories: number;
    tests: number;
  };
  gaps: TraceabilityGap[];
}

/**
 * Build the graph and walk it once, collecting gap evidence.
 * Pure function — no side effects beyond reading on-disk artifacts.
 */
export function evaluateTraceabilityGate(projectRoot: string): TraceabilityGateResult {
  const graph = buildTraceabilityGraph({ projectRoot });
  // Index nodes by id so we can resolve edge endpoints in O(1).
  const nodeKind = new Map<string, string>();
  for (const n of graph.nodes)
    nodeKind.set(n.id, n.kind);
  // Edge adjacency in both directions.
  const outFrom = new Map<string, string[]>();
  const inTo = new Map<string, string[]>();
  for (const e of graph.edges) {
    (outFrom.get(e.from) ?? outFrom.set(e.from, []).get(e.from))!.push(e.to);
    (inTo.get(e.to) ?? inTo.set(e.to, []).get(e.to))!.push(e.from);
  }
  const gaps: TraceabilityGap[] = [];
  let storyCount = 0;
  let reqCount = 0;
  let testCount = 0;
  for (const n of graph.nodes) {
    if (n.kind === 'STORY')
      storyCount++;
    if (n.kind === 'REQ')
      reqCount++;
    if (n.kind === 'TEST')
      testCount++;
  }
  // (1) every STORY → ≥1 REQ
  for (const n of graph.nodes) {
    if (n.kind !== 'STORY')
      continue;
    const outs = outFrom.get(n.id) ?? [];
    if (!outs.some(t => nodeKind.get(t) === 'REQ')) {
      gaps.push({
        kind: 'STORY_NO_REQ',
        id: n.id,
        reason: `${n.id} has no derives_from edge to any REQ`,
      });
    }
  }
  // (2) every REQ ← ≥1 STORY
  for (const n of graph.nodes) {
    if (n.kind !== 'REQ')
      continue;
    const ins = inTo.get(n.id) ?? [];
    if (!ins.some(s => nodeKind.get(s) === 'STORY')) {
      gaps.push({
        kind: 'REQ_NOT_COVERED',
        id: n.id,
        reason: `${n.id} is not implemented by any STORY`,
      });
    }
  }
  // (3) every STORY ← ≥1 TEST
  for (const n of graph.nodes) {
    if (n.kind !== 'STORY')
      continue;
    const ins = inTo.get(n.id) ?? [];
    if (!ins.some(s => nodeKind.get(s) === 'TEST')) {
      gaps.push({
        kind: 'STORY_NO_TEST',
        id: n.id,
        reason: `${n.id} has no covering TEST node`,
      });
    }
  }
  return {
    ok: gaps.length === 0,
    totals: { requirements: reqCount, stories: storyCount, tests: testCount },
    gaps,
  };
}

/**
 * Format the result for human-readable gate output.
 */
export function formatTraceabilityResult(result: TraceabilityGateResult): string {
  if (result.ok) {
    return `traceability OK — ${result.totals.requirements} REQ / ${result.totals.stories} STORY / ${result.totals.tests} TEST, no gaps`;
  }
  const lines = [
    `traceability FAIL — ${result.gaps.length} gap(s):`,
    ...result.gaps.slice(0, 20).map(g => `  • [${g.kind}] ${g.reason}`),
  ];
  if (result.gaps.length > 20) {
    lines.push(`  … and ${result.gaps.length - 20} more`);
  }
  return lines.join('\n');
}
