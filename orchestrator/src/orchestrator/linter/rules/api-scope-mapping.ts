import { LintRule, LintContext, LintResult } from '../types.js';
import { buildTraceabilityGraph, indexGraph } from '../../traceability-graph.js';

/**
 * API_SCOPE_MAPPING — every API endpoint in api-spec.yaml must be claimed
 * by at least one STORY (via scope_write or binds_endpoint edge).
 *
 * Orphan endpoints usually mean:
 *   - The spec was updated but no story was cut to implement the new endpoint
 *   - A story was abandoned mid-flight
 *   - The endpoint was added to the spec "for completeness" but never built
 *
 * Uses the `binds_endpoint` edge (STORY → API) introduced in Phase B. A
 * STORY claims an endpoint by listing `api-spec.yaml` in scope_write (claims
 * all endpoints) or by listing a file under routes/|api/|controllers/ that
 * implements that endpoint.
 *
 * Defaults to warning because the path-based heuristic for per-endpoint
 * binding is conservative — it can miss well-scoped stories whose
 * scope_write uses unusual paths. Strict mode promotes to error.
 */
export const ApiScopeMappingRule: LintRule = {
  id: 'API_SCOPE_MAPPING',
  level: 'warning',
  description: 'Every api-spec.yaml endpoint should be claimed by some story scope_write',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];
    const graph = buildTraceabilityGraph({ projectRoot: context.projectRoot, cached: null });
    const idx = indexGraph(graph);

    const apiNodes = graph.nodes.filter(n => n.kind === 'API');
    if (apiNodes.length === 0) return results;

    for (const api of apiNodes) {
      const claims = (idx.in.get(api.id) ?? []).filter(e => e.kind === 'binds_endpoint');
      if (claims.length === 0) {
        results.push({
          ruleId: 'API_SCOPE_MAPPING',
          level: 'warning',
          file: api.source ?? 'api-spec.yaml',
          line: api.line,
          message: `Endpoint ${api.id} is not claimed by any story — add it to a story's scope_write, or list api-spec.yaml in scope_write to claim all endpoints`,
        });
      }
    }

    return results;
  },
};
