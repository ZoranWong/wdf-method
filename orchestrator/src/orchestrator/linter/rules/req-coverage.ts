import { LintRule, LintContext, LintResult } from '../types.js';
import { buildTraceabilityGraph, indexGraph } from '../../traceability-graph.js';

/**
 * REQ_COVERAGE — every PRD REQ must be covered by at least one STORY.
 *
 * Uses the traceability graph's `covers` edges (STORY → REQ) introduced in
 * Phase B (V3.10.2). A REQ with zero incoming `covers` edges is a coverage
 * gap — work was specified at the PRD level but no story took responsibility
 * for delivering it.
 *
 * Defaults to warning to avoid blocking legacy projects that haven't yet
 * migrated to Story Pack v1.0 (where `refs:` may use `derives_from` rather
 * than the new explicit `covers`). Strict mode promotes to error.
 *
 * Why: an uncovered REQ is silent scope loss. The PM signs off on the PRD,
 * engineering signs off on stories, and the gap is only discovered in UAT.
 */
export const ReqCoverageRule: LintRule = {
  id: 'REQ_COVERAGE',
  level: 'warning',
  description: 'Every PRD REQ must be covered by at least one STORY (via covers edge)',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];
    const graph = buildTraceabilityGraph({ projectRoot: context.projectRoot, cached: null });
    const idx = indexGraph(graph);

    const reqNodes = graph.nodes.filter(n => n.kind === 'REQ');
    if (reqNodes.length === 0) return results; // no PRD yet — nothing to check

    for (const req of reqNodes) {
      const covers = (idx.in.get(req.id) ?? []).filter(e => e.kind === 'covers');
      if (covers.length === 0) {
        results.push({
          ruleId: 'REQ_COVERAGE',
          level: 'warning',
          file: req.source ?? 'prd.md',
          line: req.line,
          message: `REQ ${req.id} (${req.title ?? 'untitled'}) has no covering story — add a story whose refs: includes ${req.id}`,
        });
      }
    }

    return results;
  },
};
