/**
 * traceability-graph.ts — Build and query a project-wide traceability graph.
 *
 * CHG-2026-003 (OPT-02). Joins JTBD → REQ → EPIC → STORY → API/DB → TEST → COMMIT
 * so that a CR touching any artifact can enumerate downstream impact.
 *
 * Design:
 *   - Pure in-memory graph; serialised to `_wdf_output/traceability.graph.json`.
 *   - Build is idempotent: every parser produces (Node, Edge) tuples keyed by
 *     stable IDs. Re-running the build with no changes yields an identical graph.
 *   - No external graph library — a simple Map<id, Node> + adjacency lists is
 *     sufficient at the scale we expect (< 500 nodes per project).
 *   - Parsers degrade gracefully: a missing artifact file produces zero nodes,
 *     not an error. Build never fails on stale projects.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join, basename, extname, relative } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { scanTestsForAcBindings, type TestBinding } from './ac-test-binding.js';

// ─── Types ───────────────────────────────────────────────────────────

export type NodeKind =
  | 'JTBD'    // Job to be Done card
  | 'REQ'     // PRD requirement
  | 'EPIC'    // Epic
  | 'STORY'   // Story
  | 'API'     // API endpoint (path + method)
  | 'DB'      // Database table
  | 'TEST'    // Test case (file:line, AC-bound)
  | 'COMMIT'; // Git commit

export type EdgeKind =
  | 'derives_from'   // STORY → REQ, REQ → JTBD
  | 'belongs_to'     // STORY → EPIC
  | 'implements'     // STORY → API/DB
  | 'tests'          // TEST → STORY (or TEST → AC, surfaced as STORY here)
  | 'references';    // generic catch-all

export interface TraceNode {
  id: string;          // canonical (e.g. "STORY-001", "REQ-7", "API:GET /todos")
  kind: NodeKind;
  title?: string;
  /** Path to the source artifact (relative to project root). */
  source?: string;
  /** Line number within the source, when applicable. */
  line?: number;
  /** Optional kind-specific payload. */
  meta?: Record<string, unknown>;
}

export interface TraceEdge {
  from: string;        // node id
  to: string;          // node id
  kind: EdgeKind;
  /** Optional source location that established the edge. */
  source?: string;
}

export interface TraceabilityGraph {
  nodes: TraceNode[];
  edges: TraceEdge[];
  built_at: string;
  project_root: string;
  /** Hash of every contributing source file — used as an incremental key. */
  source_hash: string;
}

// ─── Builder ─────────────────────────────────────────────────────────

export interface BuildOptions {
  projectRoot: string;
  /** Where _wdf_output lives (default `<projectRoot>/_wdf_output`). */
  outputRoot?: string;
  /** Roots to scan for test files. Default: `<projectRoot>` minus `node_modules`. */
  testRoots?: string[];
  /** Optional cached graph; if its source_hash matches, returned unchanged. */
  cached?: TraceabilityGraph | null;
}

export class GraphBuilder {
  private nodes = new Map<string, TraceNode>();
  private edges: TraceEdge[] = [];
  private edgeKey = new Set<string>(); // dedup

  addNode(node: TraceNode): void {
    const existing = this.nodes.get(node.id);
    if (existing) {
      // Merge non-empty fields without overwriting existing data
      this.nodes.set(node.id, {
        ...existing,
        title: existing.title ?? node.title,
        source: existing.source ?? node.source,
        line: existing.line ?? node.line,
        meta: { ...(existing.meta ?? {}), ...(node.meta ?? {}) },
      });
    } else {
      this.nodes.set(node.id, node);
    }
  }

  addEdge(edge: TraceEdge): void {
    const k = `${edge.from}→${edge.to}:${edge.kind}`;
    if (this.edgeKey.has(k)) return;
    this.edgeKey.add(k);
    this.edges.push(edge);
  }

  build(projectRoot: string, sourceHash: string): TraceabilityGraph {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      built_at: new Date().toISOString(),
      project_root: projectRoot,
      source_hash: sourceHash,
    };
  }

  hasNode(id: string): boolean { return this.nodes.has(id); }
}

export function buildTraceabilityGraph(opts: BuildOptions): TraceabilityGraph {
  const root = opts.projectRoot;
  const outRoot = opts.outputRoot ?? join(root, '_wdf_output');
  const testRoots = opts.testRoots ?? [root];

  // Collect contributing source files & compute a stable hash so callers
  // can short-circuit if nothing changed.
  const sources = collectSourceFiles(outRoot, testRoots);
  const sourceHash = hashSources(sources);
  if (opts.cached && opts.cached.source_hash === sourceHash) {
    return opts.cached;
  }

  const b = new GraphBuilder();

  // Order matters only for nicer debugging — every parser is idempotent.
  parsePrd(b, outRoot);
  parseEpics(b, outRoot);
  parseStories(b, outRoot);
  parseApiSpec(b, outRoot);
  parseDbSchema(b, outRoot);
  parseJtbd(b, outRoot);
  parseTests(b, testRoots, root);
  parseCommits(b, root);

  return b.build(root, sourceHash);
}

function collectSourceFiles(outRoot: string, testRoots: string[]): string[] {
  const files: string[] = [];
  const candidate = (p: string) => { if (existsSync(p)) files.push(p); };

  candidate(join(outRoot, 'prd.md'));
  candidate(join(outRoot, 'epics.md'));
  candidate(join(outRoot, 'api-spec.yaml'));
  candidate(join(outRoot, 'db-schema.md'));

  const dirs = ['stories', 'planning'];
  for (const d of dirs) {
    const dir = join(outRoot, d);
    if (!existsSync(dir)) continue;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isFile() && /\.(md|ya?ml)$/.test(e)) files.push(p);
    }
  }

  const ignoreDirs = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '_wdf_output']);
  for (const root of testRoots) {
    if (!existsSync(root)) continue;
    walk(root, ignoreDirs, p => {
      if (/\.(test|spec)\.(t|j)sx?$/.test(p)) files.push(p);
    });
  }
  return files;
}

function walk(start: string, ignores: Set<string>, visit: (file: string) => void): void {
  const stack: string[] = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    let st;
    try { st = statSync(cur); } catch { continue; }
    if (st.isDirectory()) {
      let entries: string[] = [];
      try { entries = readdirSync(cur); } catch { continue; }
      for (const name of entries) {
        if (ignores.has(name)) continue;
        stack.push(join(cur, name));
      }
    } else if (st.isFile()) {
      visit(cur);
    }
  }
}

function hashSources(files: string[]): string {
  const h = createHash('sha256');
  for (const f of files.sort()) {
    h.update(f);
    try { h.update(readFileSync(f)); } catch { /* missing — skip */ }
  }
  return h.digest('hex').slice(0, 16);
}

// ─── Parsers ─────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (km) out[km[1]] = km[2].trim();
  }
  return out;
}

function readFmList(fmRaw: string, key: string): string[] {
  const m = fmRaw.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, 'm'));
  if (m) return m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  // Block list
  const lines = fmRaw.split('\n');
  const idx = lines.findIndex(l => new RegExp(`^${key}:\\s*$`).test(l));
  if (idx === -1) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (/^\S/.test(lines[i])) break;
    const item = lines[i].match(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/);
    if (item) out.push(item[1]);
  }
  return out;
}

/** Parse PRD — extracts REQ-N IDs from headings or bold lines. */
export function parsePrd(b: GraphBuilder, outRoot: string): void {
  const file = join(outRoot, 'prd.md');
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  const re = /\b(REQ-\d+)\b/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const headingTitle = lines[i]
      .replace(re, '')
      .replace(/^#+\s*/, '')
      .replace(/[*_`:]/g, '')
      .trim();
    b.addNode({ id: m[1], kind: 'REQ', title: headingTitle || undefined, source: 'prd.md', line: i + 1 });
  }
}

/** Parse epics.md — EPIC-N headings → EPIC nodes.
 *
 * NOTE: a same-line `REQ-N` mention inside an epic does NOT create a
 * `derives_from` edge from EPIC → REQ. Doing so would let a REQ change
 * cascade up to its EPIC and back down to every sibling STORY under that
 * EPIC, dramatically over-reporting impact. The story-level
 * `STORY → REQ` edges are the authoritative impact path; EPIC is purely
 * a grouping abstraction. */
export function parseEpics(b: GraphBuilder, outRoot: string): void {
  const file = join(outRoot, 'epics.md');
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  const epicRe = /\b(EPIC-\d+)\b/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(epicRe);
    if (!m) continue;
    const title = lines[i].replace(epicRe, '').replace(/^#+\s*/, '').replace(/[*_`:]/g, '').trim();
    b.addNode({ id: m[1], kind: 'EPIC', title: title || undefined, source: 'epics.md', line: i + 1 });
  }
}

/** Parse stories/*.md — story_id + refs: + acceptance_criteria. */
export function parseStories(b: GraphBuilder, outRoot: string): void {
  const dir = join(outRoot, 'stories');
  if (!existsSync(dir)) return;
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const path = join(dir, f);
    const content = readFileSync(path, 'utf8');
    const fmMatch = content.match(FRONTMATTER_RE);
    if (!fmMatch) continue;
    const fmRaw = fmMatch[1];
    const fm = parseFrontmatter(content);
    const storyId = fm['story_id'] || basename(f, '.md');
    if (!storyId) continue;
    b.addNode({
      id: storyId, kind: 'STORY',
      title: fm['title'] || undefined,
      source: relative(outRoot, path),
      meta: { acceptance_criteria: readFmList(fmRaw, 'acceptance_criteria') },
    });
    for (const ref of readFmList(fmRaw, 'refs')) {
      b.addNode(refStub(ref));
      b.addEdge({ from: storyId, to: ref, kind: edgeKindForRef(ref), source: relative(outRoot, path) });
    }
  }
}

function refStub(ref: string): TraceNode {
  if (/^REQ-\d+$/.test(ref)) return { id: ref, kind: 'REQ' };
  if (/^EPIC-\d+$/.test(ref)) return { id: ref, kind: 'EPIC' };
  if (/^JTBD-\d+$/.test(ref)) return { id: ref, kind: 'JTBD' };
  if (/^API:/.test(ref)) return { id: ref, kind: 'API' };
  if (/^DB:/.test(ref)) return { id: ref, kind: 'DB' };
  return { id: ref, kind: 'REQ' };
}

function edgeKindForRef(ref: string): EdgeKind {
  if (/^EPIC-/.test(ref)) return 'belongs_to';
  if (/^API:|^DB:/.test(ref)) return 'implements';
  return 'derives_from';
}

/** Parse api-spec.yaml — extracts paths + methods as API nodes. */
export function parseApiSpec(b: GraphBuilder, outRoot: string): void {
  const file = join(outRoot, 'api-spec.yaml');
  if (!existsSync(file)) return;
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  // Look for `paths:` section, then 2-space indented `<path>:` then 4-space `<method>:`
  const pathsIdx = lines.findIndex(l => /^paths:\s*$/.test(l));
  if (pathsIdx === -1) return;
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  let currentPath: string | null = null;
  for (let i = pathsIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // back to top-level
    const pm = line.match(/^ {2}([^\s:]+):\s*$/);
    if (pm) { currentPath = pm[1]; continue; }
    if (currentPath) {
      const mm = line.match(/^ {4}([a-z]+):\s*$/);
      if (mm && methods.includes(mm[1])) {
        const id = `API:${mm[1].toUpperCase()} ${currentPath}`;
        b.addNode({ id, kind: 'API', title: id, source: 'api-spec.yaml', line: i + 1 });
      }
    }
  }
}

/** Parse db-schema.md — extract `## table-name` headings as DB nodes. */
export function parseDbSchema(b: GraphBuilder, outRoot: string): void {
  const file = join(outRoot, 'db-schema.md');
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+([a-z][a-z0-9_]*)\s*$/i);
    if (m) {
      const id = `DB:${m[1].toLowerCase()}`;
      b.addNode({ id, kind: 'DB', title: m[1], source: 'db-schema.md', line: i + 1 });
    }
  }
}

/** Parse jtbd-cards.md — extract JTBD-N entries. */
export function parseJtbd(b: GraphBuilder, outRoot: string): void {
  const candidates = [
    join(outRoot, '_output/analysis/jtbd-cards.md'),
    join(outRoot, '_output/planning/jtbd-cards.md'),
    join(outRoot, 'jtbd-cards.md'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const re = /\b(JTBD-\d+)\b/;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      const title = lines[i].replace(re, '').replace(/^#+\s*/, '').replace(/[*_`:]/g, '').trim();
      b.addNode({ id: m[1], kind: 'JTBD', title: title || undefined, source: relative(outRoot, file), line: i + 1 });
    }
    break;
  }
}

/** Parse test files — derive TEST nodes + edges to AC-bound stories. */
export function parseTests(b: GraphBuilder, testRoots: string[], projectRoot: string): void {
  const bindings: TestBinding[] = scanTestsForAcBindings({ roots: testRoots, projectRoot });
  // To link TEST → STORY we need AC → STORY mapping. We pre-built that on
  // STORY parsing via meta.acceptance_criteria.
  const acToStory = new Map<string, string>();
  for (const node of b['nodes'].values()) {
    if (node.kind !== 'STORY') continue;
    const acs = (node.meta?.acceptance_criteria ?? []) as string[];
    for (const ac of acs) acToStory.set(ac, node.id);
  }
  for (const bnd of bindings) {
    const id = `TEST:${bnd.file}:${bnd.line}`;
    b.addNode({
      id, kind: 'TEST',
      title: bnd.test_name,
      source: bnd.file, line: bnd.line,
      meta: { ac_id: bnd.ac_id, binding_kind: bnd.binding_kind },
    });
    const storyId = acToStory.get(bnd.ac_id);
    if (storyId) {
      b.addEdge({ from: id, to: storyId, kind: 'tests', source: bnd.file });
    }
  }
}

/**
 * Parse git log for COMMIT nodes and link them to STORY nodes.
 *
 * Recognises the WDF commit convention `{story_id}: {title}` (e.g.
 * `S-AUTH-01: login form — IMPLEMENTED`). Each matching commit becomes a
 * COMMIT node with a `references` edge from STORY → COMMIT.
 *
 * Silently no-ops when the project is not a git repo (execSync throws) —
 * the graph still builds without commit history.
 */
export function parseCommits(b: GraphBuilder, projectRoot: string): void {
  const storyIds = new Set<string>();
  for (const node of b['nodes'].values()) {
    if (node.kind === 'STORY') storyIds.add(node.id);
  }
  if (storyIds.size === 0) return;

  let raw: string;
  try {
    // %x09 is a tab separator. We only need hash + subject; bodies are noise.
    raw = execSync('git log --no-merges --format="%H%x09%s"', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
  } catch {
    return; // not a git repo, or git missing — skip silently
  }

  // Story IDs look like S-AUTH-01, S-TODO-001, STORY-001, etc.
  // Match longest first so S-AUTH-001 wins over S-AUTH-01 when both appear.
  const known = Array.from(storyIds).sort((a, b2) => b2.length - a.length);
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const sep = line.indexOf('\t');
    if (sep < 0) continue;
    const hash = line.slice(0, sep);
    const subject = line.slice(sep + 1);
    if (!hash || !subject) continue;

    const matched = known.find(id => subject.includes(id));
    if (!matched) continue;

    const commitId = `COMMIT:${hash.slice(0, 12)}`;
    b.addNode({
      id: commitId, kind: 'COMMIT',
      title: subject.slice(0, 120),
      source: hash,
      meta: { story_id: matched },
    });
    b.addEdge({ from: matched, to: commitId, kind: 'references' });
  }
}

// ─── Persistence ─────────────────────────────────────────────────────

export function saveGraph(graph: TraceabilityGraph, outputRoot: string): string {
  const path = join(outputRoot, 'traceability.graph.json');
  writeFileSync(path, JSON.stringify(graph, null, 2), 'utf8');
  return path;
}

export function loadGraph(outputRoot: string): TraceabilityGraph | null {
  const path = join(outputRoot, 'traceability.graph.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as TraceabilityGraph;
  } catch {
    return null;
  }
}

// ─── Query helpers ───────────────────────────────────────────────────

export interface AdjacencyIndex {
  /** id → outgoing edges */
  out: Map<string, TraceEdge[]>;
  /** id → incoming edges */
  in: Map<string, TraceEdge[]>;
  byId: Map<string, TraceNode>;
}

export function indexGraph(g: TraceabilityGraph): AdjacencyIndex {
  const outIdx = new Map<string, TraceEdge[]>();
  const inIdx = new Map<string, TraceEdge[]>();
  for (const e of g.edges) {
    (outIdx.get(e.from) ?? outIdx.set(e.from, []).get(e.from)!).push(e);
    (inIdx.get(e.to) ?? inIdx.set(e.to, []).get(e.to)!).push(e);
  }
  const byId = new Map<string, TraceNode>();
  for (const n of g.nodes) byId.set(n.id, n);
  return { out: outIdx, in: inIdx, byId };
}

/**
 * BFS downstream — given a seed set, return every node reachable by following
 * the *reverse* of `derives_from` and `belongs_to` edges (i.e. children).
 *
 * In our graph, STORY --derives_from--> REQ. So when REQ-7 is impacted,
 * downstream means: which STORIES derive from REQ-7? Which TESTs cover
 * those STORIES? The traversal follows incoming `derives_from` / `belongs_to`
 * edges, plus outgoing `tests` and `implements` edges from the discovered
 * children.
 */
export function downstream(
  index: AdjacencyIndex,
  seedIds: Iterable<string>,
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const s of seedIds) { visited.add(s); queue.push(s); }

  while (queue.length) {
    const cur = queue.shift()!;
    // Children-of via incoming derives_from / belongs_to / implements
    const incoming = index.in.get(cur) ?? [];
    for (const e of incoming) {
      if (e.kind === 'derives_from' || e.kind === 'belongs_to' || e.kind === 'implements' || e.kind === 'tests') {
        if (!visited.has(e.from)) { visited.add(e.from); queue.push(e.from); }
      }
    }
  }
  return visited;
}

/**
 * BFS upstream — given a seed set, return every node reachable by following
 * derives_from / belongs_to / implements edges *forward* (i.e. parents).
 *
 * STORY --derives_from--> REQ. So from STORY-001, upstream follows the edge
 * direction and finds REQ-7, EPIC-3, JTBD-1. From REQ-7, upstream finds JTBD-2.
 */
export function upstream(
  index: AdjacencyIndex,
  seedIds: Iterable<string>,
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const s of seedIds) { visited.add(s); queue.push(s); }

  while (queue.length) {
    const cur = queue.shift()!;
    // Parents via outgoing derives_from / belongs_to / implements
    const outgoing = index.out.get(cur) ?? [];
    for (const e of outgoing) {
      if (
        e.kind === 'derives_from' ||
        e.kind === 'belongs_to' ||
        e.kind === 'implements'
      ) {
        if (!visited.has(e.to)) {
          visited.add(e.to);
          queue.push(e.to);
        }
      }
    }
  }
  return visited;
}

/**
 * Full bidirectional trace from a node ID.
 * Returns { upstream, downstream, node } for rendering.
 */
export function trace(
  index: AdjacencyIndex,
  seedId: string,
): { node: TraceNode | undefined; upstream: Set<string>; downstream: Set<string> } {
  return {
    node: index.byId.get(seedId),
    upstream: upstream(index, [seedId]),
    downstream: downstream(index, [seedId]),
  };
}

/**
 * Format a trace result as human-readable text.
 */
export function formatTraceText(
  index: AdjacencyIndex,
  seedId: string,
): string {
  const result = trace(index, seedId);
  const lines: string[] = [];

  const node = result.node;
  if (!node) {
    return `No node found with ID "${seedId}".\n\nTry one of: ${Array.from(index.byId.keys()).slice(0, 20).join(', ')}...`;
  }

  lines.push(`╔══════════════════════════════════════════╗`);
  lines.push(`║  Trace: ${node.id.padEnd(34)}║`);
  lines.push(`╠══════════════════════════════════════════╣`);
  lines.push(`║  Kind: ${(node.kind ?? '?').padEnd(36)}║`);
  lines.push(`║  Title: ${(node.title ?? '(untitled)').slice(0, 32).padEnd(32)}║`);
  if (node.source) {
    lines.push(`║  Source: ${node.source.slice(0, 30).padEnd(30)}║`);
  }
  lines.push(`╚══════════════════════════════════════════╝`);
  lines.push('');

  // Upstream (what this depends on)
  const ups = Array.from(result.upstream).filter(id => id !== seedId);
  lines.push(`── Upstream (depends on) ── ${ups.length} nodes ──`);
  if (ups.length === 0) {
    lines.push('  (none — this is a root node)');
  } else {
    for (const id of ups.sort()) {
      const n = index.byId.get(id);
      const prefix = n ? `[${n.kind}]` : '[?]';
      lines.push(`  ↑ ${prefix} ${id} ${n?.title ? `— ${n.title}` : ''}`);
    }
  }
  lines.push('');

  // Downstream (what depends on this)
  const downs = Array.from(result.downstream).filter(id => id !== seedId);
  lines.push(`── Downstream (impacts) ── ${downs.length} nodes ──`);
  if (downs.length === 0) {
    lines.push('  (none — this is a leaf node)');
  } else {
    for (const id of downs.sort()) {
      const n = index.byId.get(id);
      const prefix = n ? `[${n.kind}]` : '[?]';
      lines.push(`  ↓ ${prefix} ${id} ${n?.title ? `— ${n.title}` : ''}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a trace result as a Mermaid flowchart.
 */
export function formatTraceMermaid(
  index: AdjacencyIndex,
  seedId: string,
): string {
  const result = trace(index, seedId);
  const node = result.node;
  if (!node) return `%% No node found: ${seedId}`;

  const allIds = new Set([
    seedId,
    ...Array.from(result.upstream),
    ...Array.from(result.downstream),
  ]);

  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('flowchart LR');
  lines.push(`  %% Trace for: ${seedId}`);

  // Style seed node
  const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Collect relevant edges
  const relevantEdges = new Set<string>();
  for (const id of allIds) {
    for (const dir of ['out' as const, 'in' as const]) {
      const edges = index[dir].get(id) ?? [];
      for (const e of edges) {
        if (allIds.has(e.from) && allIds.has(e.to)) {
          const key = `${e.from}→${e.to}`;
          if (!relevantEdges.has(key)) {
            relevantEdges.add(key);
            const label = e.kind.replace(/_/g, ' ');
            lines.push(`  ${safeId(e.from)}["${e.from}"] -->|"${label}"| ${safeId(e.to)}["${e.to}"]`);
          }
        }
      }
    }
  }

  // Highlight the seed node
  lines.push(`  style ${safeId(seedId)} fill:#f9f,stroke:#333,stroke-width:3px`);

  // Highlight impacted downstream
  for (const id of result.downstream) {
    if (id !== seedId) {
      lines.push(`  style ${safeId(id)} fill:#ffd,stroke:#333,stroke-width:1px`);
    }
  }

  lines.push('```');
  return lines.join('\n');
}
