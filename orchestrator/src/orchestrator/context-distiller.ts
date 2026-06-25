/**
 * context-distiller.ts — Phase E (V3.11) graph-driven context distillation.
 *
 * Problem: the dev dispatch prompt hands the agent raw `scope_write` paths
 * and a `scope_read` of the entire `_wdf_output/**`. The agent must read the
 * whole spec output and infer what's relevant — wasted tokens, more retries,
 * more escalations.
 *
 * This module pre-computes the slice of the spec that actually matters for a
 * given story by walking the traceability graph (which already encodes
 * STORY→REQ→JTBD, STORY→API, API→DB, TEST→STORY edges). The result is a
 * compact "Distilled Context" block injected into the dispatch prompt.
 *
 * It is BEST-EFFORT: a missing graph, an absent story node, or zero edges
 * yields an `empty` result and the caller simply omits the block. Distillation
 * must never break dispatch.
 */

import {
  buildTraceabilityGraph,
  indexGraph,
  type TraceabilityGraph,
} from './traceability-graph.js';

export interface DistilledRequirement {
  id: string;
  title?: string;
  /** JTBD ids this REQ derives from (one hop further out). */
  jtbd: string[];
}

export interface DistilledEndpoint {
  id: string;
  /** DB entity ids this endpoint references (via uses_entity). */
  entities: string[];
}

export interface DistilledContext {
  story_id: string;
  requirements: DistilledRequirement[];
  endpoints: DistilledEndpoint[];
  /** De-duplicated union of every entity reached through the story's endpoints. */
  entities: string[];
  /** TEST node ids already bound to this story. */
  existing_tests: string[];
  /** True when nothing was linked — caller should omit the context block. */
  empty: boolean;
}

/**
 * Distill the relevant spec slice for a single story.
 *
 * @param storyId     The story to distil context for (e.g. "S-AUTH-01").
 * @param projectRoot Absolute project path.
 * @param outputRoot  Optional `_wdf_output` override.
 * @param graph       Optional pre-built graph to avoid a rebuild.
 */
export function distillContext(
  storyId: string,
  projectRoot: string,
  outputRoot?: string,
  graph?: TraceabilityGraph,
): DistilledContext {
  const empty: DistilledContext = {
    story_id: storyId,
    requirements: [],
    endpoints: [],
    entities: [],
    existing_tests: [],
    empty: true,
  };

  let g: TraceabilityGraph;
  try {
    g = graph ?? buildTraceabilityGraph({ projectRoot, outputRoot });
  } catch {
    return empty;
  }

  const idx = indexGraph(g);
  if (!idx.byId.has(storyId)) return empty;

  const out = idx.out.get(storyId) ?? [];

  // ── Requirements (covers / derives_from → REQ), then REQ → JTBD ──
  const requirements: DistilledRequirement[] = [];
  const seenReq = new Set<string>();
  for (const e of out) {
    if (e.kind !== 'covers' && e.kind !== 'derives_from') continue;
    const node = idx.byId.get(e.to);
    if (node?.kind !== 'REQ' || seenReq.has(node.id)) continue;
    seenReq.add(node.id);

    const jtbd: string[] = [];
    for (const re of idx.out.get(node.id) ?? []) {
      const target = idx.byId.get(re.to);
      if (target?.kind === 'JTBD') jtbd.push(target.id);
    }
    requirements.push({ id: node.id, title: node.title, jtbd });
  }

  // ── Endpoints (binds_endpoint → API), then API → DB entities ──
  const endpoints: DistilledEndpoint[] = [];
  const entitySet = new Set<string>();
  const seenApi = new Set<string>();
  for (const e of out) {
    if (e.kind !== 'binds_endpoint') continue;
    const node = idx.byId.get(e.to);
    // binds_endpoint also points at FILE: nodes — only API nodes are endpoints.
    if (node?.kind !== 'API' || seenApi.has(node.id)) continue;
    seenApi.add(node.id);

    const entities: string[] = [];
    for (const ae of idx.out.get(node.id) ?? []) {
      if (ae.kind !== 'uses_entity') continue;
      const dbNode = idx.byId.get(ae.to);
      const label = dbNode?.title ?? ae.to.replace(/^DB:/, '');
      entities.push(label);
      entitySet.add(label);
    }
    endpoints.push({ id: node.id.replace(/^API:/, ''), entities });
  }

  // ── Existing tests (TEST → STORY via `tests`) ──
  const existing_tests: string[] = [];
  for (const e of idx.in.get(storyId) ?? []) {
    if (e.kind === 'tests') existing_tests.push(e.from);
  }

  const result: DistilledContext = {
    story_id: storyId,
    requirements,
    endpoints,
    entities: Array.from(entitySet),
    existing_tests,
    empty:
      requirements.length === 0 &&
      endpoints.length === 0 &&
      existing_tests.length === 0,
  };

  return result;
}

/**
 * Render a distilled context as a compact markdown block for prompt
 * injection. Returns an empty string when there is nothing to show, so the
 * caller can inject unconditionally.
 */
export function renderDistilledContext(d: DistilledContext): string {
  if (d.empty) return '';

  const lines: string[] = [];
  lines.push('## Distilled Context (read this first)');
  lines.push('');
  lines.push(
    'The spec slice below is everything this story touches. Prefer it over re-reading all of `_wdf_output/`.',
  );
  lines.push('');

  if (d.requirements.length > 0) {
    lines.push('### Requirements this story delivers');
    for (const r of d.requirements) {
      const title = r.title ? ` — ${r.title}` : '';
      const jtbd = r.jtbd.length > 0 ? ` (serves ${r.jtbd.join(', ')})` : '';
      lines.push(`- **${r.id}**${title}${jtbd}`);
    }
    lines.push('');
  }

  if (d.endpoints.length > 0) {
    lines.push('### API endpoints in scope');
    for (const ep of d.endpoints) {
      const ents = ep.entities.length > 0 ? ` → entities: ${ep.entities.join(', ')}` : '';
      lines.push(`- \`${ep.id}\`${ents}`);
    }
    lines.push('');
  }

  if (d.entities.length > 0) {
    lines.push(`### DB entities touched`);
    lines.push(d.entities.map(e => `\`${e}\``).join(', '));
    lines.push('');
  }

  if (d.existing_tests.length > 0) {
    lines.push('### Existing tests bound to this story');
    for (const t of d.existing_tests) {
      lines.push(`- \`${t}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}
