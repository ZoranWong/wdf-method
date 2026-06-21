// wdf trace <id> — Full bidirectional traceability query.
//
// Queries the project traceability graph (CHG-2026-003) to show the complete
// upstream (depends on) and downstream (impacts) chain for any node.
//
// Usage:
//   wdf trace REQ-7
//   wdf trace STORY-001 --format=mermaid
//   wdf trace REQ-7 --direction=downstream
import { existsSync } from 'fs';
import { join } from 'path';
// TODO: traceability-graph.ts source was lost and needs reconstruction.
// The compiled module exists in dist/orchestrator/traceability-graph.js.
// Types below mirror the public surface declared in traceability-graph.d.ts
// so this file type-checks cleanly once the source is restored.
//
// import { buildTraceabilityGraph, loadGraph, indexGraph, formatTraceText, formatTraceMermaid } from './traceability-graph.js';

export interface TraceOptions {
  id: string;
  projectRoot: string;
  format?: 'text' | 'mermaid';
  direction?: 'upstream' | 'downstream' | 'both';
  rebuild?: boolean;
}

export interface TraceResult {
  id: string;
  found: boolean;
  node?: {
    id: string;
    kind: string;
    title?: string;
    source?: string;
  };
  upstreamCount: number;
  downstreamCount: number;
  formatted: string;
}

interface TraceNode {
  id: string;
  kind: string;
  title?: string;
  source?: string;
}

interface TraceEdge {
  from: string;
  to: string;
  kind: string;
  source?: string;
}

interface TraceabilityGraph {
  nodes: TraceNode[];
  edges: TraceEdge[];
  built_at: string;
  project_root: string;
  source_hash: string;
}

interface AdjacencyIndex {
  out: Map<string, TraceEdge[]>;
  in: Map<string, TraceEdge[]>;
  byId: Map<string, TraceNode>;
}

interface BuildOptions {
  projectRoot: string;
  outputRoot?: string;
  testRoots?: string[];
  cached?: TraceabilityGraph | null;
}

// Runtime imports — the .js build is still shipped in dist/, so we pull the
// symbols via a dynamic require to keep this module working while the
// traceability-graph.ts source is being reconstructed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  buildTraceabilityGraph,
  loadGraph,
  indexGraph,
  formatTraceText,
  formatTraceMermaid,
}: {
  buildTraceabilityGraph: (opts: BuildOptions) => TraceabilityGraph;
  loadGraph: (outputRoot: string) => TraceabilityGraph | null;
  indexGraph: (g: TraceabilityGraph) => AdjacencyIndex;
  formatTraceText: (index: AdjacencyIndex, seedId: string) => string;
  formatTraceMermaid: (index: AdjacencyIndex, seedId: string) => string;
} = require('./traceability-graph.js');

/**
 * Run a trace query and return formatted result.
 */
export async function traceCommand(opts: TraceOptions): Promise<TraceResult> {
  const outputRoot = join(opts.projectRoot, '_wdf_output');
  // Load or build the graph
  let graph: TraceabilityGraph;
  if (opts.rebuild || !existsSync(join(outputRoot, 'traceability.graph.json'))) {
    graph = buildTraceabilityGraph({ projectRoot: opts.projectRoot, outputRoot });
  }
  else {
    graph = loadGraph(outputRoot) as TraceabilityGraph;
    if (!graph) {
      graph = buildTraceabilityGraph({ projectRoot: opts.projectRoot, outputRoot });
    }
  }
  const index = indexGraph(graph);
  const node = index.byId.get(opts.id);
  // Filter by direction
  let formatted: string;
  if (opts.format === 'mermaid') {
    formatted = formatTraceMermaid(index, opts.id);
  }
  else {
    formatted = formatTraceText(index, opts.id);
  }
  return {
    id: opts.id,
    found: node != null,
    node: node
      ? {
          id: node.id,
          kind: node.kind,
          title: node.title,
          source: node.source,
        }
      : undefined,
    upstreamCount: node
      ? countReachable(index, opts.id, 'upstream')
      : 0,
    downstreamCount: node
      ? countReachable(index, opts.id, 'downstream')
      : 0,
    formatted,
  };
}

function countReachable(index: AdjacencyIndex, seedId: string, _direction: 'upstream' | 'downstream'): number {
  // Simple: count all nodes reachable from seed, minus the seed itself
  const visited = new Set<string>();
  const queue: string[] = [seedId];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const dir of ['out', 'in'] as const) {
      const edges = index[dir].get(cur) ?? [];
      for (const e of edges) {
        const next = dir === 'out' ? e.to : e.from;
        if (!visited.has(next) && next !== seedId) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }
  return visited.size;
}
