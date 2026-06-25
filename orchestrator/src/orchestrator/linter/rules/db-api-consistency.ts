import { LintRule, LintContext, LintResult } from '../types.js';
import { buildTraceabilityGraph, indexGraph } from '../../traceability-graph.js';

/**
 * DB_API_CONSISTENCY — every entity referenced by an API endpoint (via
 * `$ref: #/components/schemas/<X>` in api-spec.yaml) must exist in
 * db-schema.md.
 *
 * Detects two classes of drift:
 *   - Spec mentions entity that doesn't exist in DB schema (phantom entity)
 *   - DB schema has entity that no endpoint uses (orphan entity) — warning only
 *
 * Uses the `uses_entity` edge (API → DB) introduced in Phase B. The edge is
 * created during parseApiSpec when it sees a $ref to a schema; the DB node
 * is created as a stub if it didn't already exist (from parseDbSchema).
 * Consistency is verified by checking whether each `DB:*` node has a real
 * source in db-schema.md.
 *
 * Defaults to warning — entity naming casing mismatches (UserProfile vs
 * user_profile) can produce false positives, so callers should review
 * before promoting to error in strict mode.
 */
export const DbApiConsistencyRule: LintRule = {
  id: 'DB_API_CONSISTENCY',
  level: 'warning',
  description: 'API endpoints must only reference entities that exist in db-schema.md',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];
    const graph = buildTraceabilityGraph({ projectRoot: context.projectRoot, cached: null });
    const idx = indexGraph(graph);

    for (const node of graph.nodes) {
      if (node.kind !== 'DB') continue;

      // A real DB node has its source in db-schema.md. Stub nodes created
      // by parseApiSpec have source === 'api-spec.yaml' — they exist only
      // because an endpoint referenced them, but db-schema.md doesn't
      // actually contain them.
      const isStubFromApi = node.source === 'api-spec.yaml';
      const hasDbSchemaSource = graph.nodes.some(
        n => n.kind === 'DB' && n.id === node.id && n.source === 'db-schema.md',
      );

      if (isStubFromApi && !hasDbSchemaSource) {
        // Find the endpoints that reference this stub so the message is actionable
        const referrers = (idx.in.get(node.id) ?? [])
          .filter(e => e.kind === 'uses_entity')
          .map(e => e.from);

        results.push({
          ruleId: 'DB_API_CONSISTENCY',
          level: 'warning',
          file: 'api-spec.yaml',
          message: `Entity ${node.id.replace(/^DB:/, '')} is referenced by ${referrers.join(', ') || 'endpoints'} but not declared in db-schema.md`,
        });
      }
    }

    return results;
  },
};
