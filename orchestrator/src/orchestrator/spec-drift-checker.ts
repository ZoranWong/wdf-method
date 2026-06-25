/**
 * spec-drift-checker.ts — Phase D (V3.10.4) spec vs code drift detection.
 *
 * Compares two graphs:
 *   - spec graph: derived from _wdf_output/ (api-spec.yaml, db-schema.md,
 *     stories/*.md) via buildTraceabilityGraph()
 *   - code graph: derived from source files via spec-reverse-engineer's
 *     parsers
 *
 * Emits a drift report classifying gaps as:
 *   - orphan_endpoints    — spec declares endpoint, code has no route
 *   - unspec_endpoints    — code has route, spec doesn't list it
 *   - missing_tests       — story declares AC, code has no test binding
 *
 * Designed to be registered as a lint rule (spec-drift.ts) and surfaced
 * as a pre-merge gate so unspec'd endpoints never land on main.
 */

import { reverseEngineerSpec, type Candidate } from './spec-reverse-engineer.js';
import {
  buildTraceabilityGraph,
  indexGraph,
} from './traceability-graph.js';

export interface DriftItem {
  kind: 'orphan_endpoint' | 'unspec_endpoint' | 'missing_test';
  /** Spec or code location depending on kind */
  source: string;
  /** Endpoint id (METHOD path) or AC id (AC-NNN) */
  identifier: string;
  message: string;
}

export interface DriftReport {
  ok: boolean;
  drift: DriftItem[];
  /** Breakdown by kind for quick stats */
  counts: {
    orphan_endpoints: number;
    unspec_endpoints: number;
    missing_tests: number;
  };
  /** Markdown rendering of the report */
  markdown: string;
}

/**
 * Compare spec-side and code-side graphs and emit a drift report.
 *
 * @param projectRoot absolute path to project
 * @param outputRoot  override `_wdf_output` location
 */
export function checkSpecDrift(
  projectRoot: string,
  outputRoot?: string,
): DriftReport {
  const specGraph = buildTraceabilityGraph({ projectRoot, outputRoot });
  const reversed = reverseEngineerSpec(projectRoot, outputRoot);

  const drift: DriftItem[] = [];

  // ── Endpoint comparison ──
  // Normalize spec endpoints and code endpoints to "METHOD path" tuples.
  const specEndpoints = new Set<string>();
  for (const node of specGraph.nodes) {
    if (node.kind !== 'API') continue;
    specEndpoints.add(node.id.replace(/^API:/, ''));
  }

  const codeEndpoints = new Set<string>();
  for (const c of reversed.candidates) {
    if (c.kind !== 'endpoint') continue;
    const method = String(c.payload.method ?? '').toUpperCase();
    const path = String(c.payload.path ?? '');
    if (!method || !path) continue;
    codeEndpoints.add(`${method} ${path}`);
  }

  // Orphan endpoints (in spec, not in code)
  for (const ep of specEndpoints) {
    if (!codeEndpoints.has(ep)) {
      drift.push({
        kind: 'orphan_endpoint',
        source: 'api-spec.yaml',
        identifier: ep,
        message: `Endpoint ${ep} is declared in api-spec.yaml but no matching route was found in the codebase`,
      });
    }
  }

  // Unspec'd endpoints (in code, not in spec)
  for (const ep of codeEndpoints) {
    if (!specEndpoints.has(ep)) {
      drift.push({
        kind: 'unspec_endpoint',
        source: 'source code',
        identifier: ep,
        message: `Endpoint ${ep} is implemented in code but not declared in api-spec.yaml`,
      });
    }
  }

  // ── Missing tests ──
  // For each STORY with acceptance_criteria, look for any code candidate
  // whose test_name mentions the AC id or story id. This is a soft check —
  // real binding lives in ac-test-binding.ts.
  const testCandidates = reversed.candidates.filter(c => c.kind === 'acceptance_check');
  const idx = indexGraph(specGraph);
  for (const node of specGraph.nodes) {
    if (node.kind !== 'STORY') continue;
    const acs = (node.meta?.acceptance_criteria ?? []) as string[];
    for (const ac of acs) {
      const hasTest = testCandidates.some(c => {
        const name = String(c.payload.test_name ?? '').toLowerCase();
        return name.includes(ac.toLowerCase()) || name.includes(node.id.toLowerCase());
      });
      if (!hasTest) {
        drift.push({
          kind: 'missing_test',
          source: node.source ?? `stories/${node.id}.md`,
          identifier: `${node.id}/${ac}`,
          message: `Story ${node.id} declares AC "${ac}" but no test candidate references it`,
        });
      }
    }
  }

  // Touch `idx` so the import isn't tree-shaken — the index is also useful
  // for downstream callers who want to walk the spec graph themselves.
  void idx;

  const counts = {
    orphan_endpoints: drift.filter(d => d.kind === 'orphan_endpoint').length,
    unspec_endpoints: drift.filter(d => d.kind === 'unspec_endpoint').length,
    missing_tests: drift.filter(d => d.kind === 'missing_test').length,
  };

  return {
    ok: drift.length === 0,
    drift,
    counts,
    markdown: renderDriftMarkdown(drift, counts, projectRoot),
  };
}

function renderDriftMarkdown(
  drift: DriftItem[],
  counts: DriftReport['counts'],
  projectRoot: string,
): string {
  const lines: string[] = [
    '# Spec Drift Report',
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Project:** ${projectRoot}`,
    '',
    `Total drift: **${drift.length}**`,
    `- Orphan endpoints (spec only): ${counts.orphan_endpoints}`,
    `- Unspec'd endpoints (code only): ${counts.unspec_endpoints}`,
    `- Missing tests: ${counts.missing_tests}`,
    '',
  ];

  if (drift.length === 0) {
    lines.push('✅ **No drift detected.** Spec and code are aligned.');
    return lines.join('\n');
  }

  const sections: Record<DriftItem['kind'], { title: string; description: string }> = {
    orphan_endpoint: {
      title: 'Orphan Endpoints',
      description: 'Endpoints declared in api-spec.yaml with no matching route in code. Either the route was deleted or the spec was authored ahead of implementation.',
    },
    unspec_endpoint: {
      title: "Unspec'd Endpoints",
      description: 'Routes implemented in code that api-spec.yaml does not declare. Add them to the spec or remove the routes — silent divergence creates integration risk.',
    },
    missing_test: {
      title: 'Missing Test Bindings',
      description: 'Story acceptance criteria with no matching test in the codebase. Either the AC has no test yet, or the test exists but does not name the AC.',
    },
  };

  for (const kind of Object.keys(sections) as DriftItem['kind'][]) {
    const items = drift.filter(d => d.kind === kind);
    if (items.length === 0) continue;
    const meta = sections[kind];
    lines.push(`## ${meta.title}`);
    lines.push('');
    lines.push(meta.description);
    lines.push('');
    for (const item of items) {
      lines.push(`- [${item.source}] ${item.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
