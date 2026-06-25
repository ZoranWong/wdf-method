import { LintRule, LintContext, LintResult } from '../types.js';
import { buildTraceabilityGraph, indexGraph } from '../../traceability-graph.js';

/**
 * AC_TEST_BINDING — every story acceptance criterion should be bound to
 * at least one TEST node.
 *
 * Story acceptance criteria (the `acceptance_criteria` field in story
 * frontmatter, or `acceptance_check` in legacy form) are the contract the
 * story must fulfil. An AC with no corresponding TEST node means the story
 * can be marked complete without the AC ever being verified — pure scope
 * risk.
 *
 * Test files are discovered by scanning for *.test.ts / *.spec.ts files
 * and matching them to AC IDs via the existing ac-test-binding scanner
 * (which recognises comments like `// AC: AC-001` or test names like
 * `it('AC-001: ...')`).
 *
 * Defaults to warning — many legitimate ACs are verified manually (UX
 * flows, infra changes) and shouldn't block CI. Strict mode promotes to
 * error for projects that have committed to test-driven AC verification.
 */
export const AcTestBindingRule: LintRule = {
  id: 'AC_TEST_BINDING',
  level: 'warning',
  description: 'Every story acceptance criterion should be bound to at least one TEST',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];
    const graph = buildTraceabilityGraph({ projectRoot: context.projectRoot, cached: null });
    const idx = indexGraph(graph);

    // Build AC → TEST coverage map from TEST node metadata
    const acToTests = new Map<string, string[]>();
    for (const node of graph.nodes) {
      if (node.kind !== 'TEST') continue;
      const acId = node.meta?.ac_id as string | undefined;
      if (!acId) continue;
      const arr = acToTests.get(acId) ?? [];
      arr.push(node.id);
      acToTests.set(acId, arr);
    }

    // Walk STORY nodes and check each declared AC has at least one TEST
    for (const node of graph.nodes) {
      if (node.kind !== 'STORY') continue;
      const acs = (node.meta?.acceptance_criteria ?? []) as string[];
      if (acs.length === 0) continue;

      for (const ac of acs) {
        const tests = acToTests.get(ac);
        if (!tests || tests.length === 0) {
          results.push({
            ruleId: 'AC_TEST_BINDING',
            level: 'warning',
            file: node.source ?? `stories/${node.id}.md`,
            message: `Story ${node.id} declares AC "${ac}" but no TEST binds to it — add a test with comment \`// AC: ${ac}\` or matching test name`,
          });
        }
      }
    }

    return results;
  },
};
