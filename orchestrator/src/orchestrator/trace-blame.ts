/**
 * trace-blame — reverse-traceability query: any source line → commit → story → REQ → JTBD.
 *
 * Why this exists:
 *   The existing `wdf trace <id>` walks the graph forward (JTBD→REQ→Story→
 *   Test→Commit). Production bugs and code review, however, start in the
 *   *other* direction: a developer lands on `src/api/user.ts:42` and wants to
 *   know which REQ it implements and whether there's test coverage for it.
 *   Without a tool, they'd have to grep commits, find the story, trace it up
 *   by hand. This command compresses that to one call.
 *
 * Pipeline:
 *   1. git blame -L <line>,<line> --porcelain <file>  →  commit hash + subject
 *   2. parseStoryTag(subject)                          →  story_id (or null)
 *   3. buildTraceabilityGraph + indexGraph             →  AdjacencyIndex
 *   4. Walk upstream of STORY node:
 *        - REQ parents (inbound REQ→STORY edges)
 *        - JTBD grandparents of each REQ (inbound JTBD→REQ edges)
 *   5. Walk downstream: any TEST or API node the STORY derives
 *   6. Format a human-readable report.
 *
 * Failures are reported, not thrown — `found` and each missing sub-field
 * are independent, so the caller gets as much of the chain as the repo
 * actually declares. This makes partial traceability visible instead of
 * hiding it behind a 404.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { relative, isAbsolute, resolve, join } from 'path';
import {
  buildTraceabilityGraph,
  loadGraph,
  indexGraph,
  type TraceabilityGraph,
  type AdjacencyIndex,
  type TraceNode,
} from './traceability-graph.js';
import { parseStoryTag } from './hooks-cmd.js';

export interface TraceBlameOpts {
  /** Source file. Absolute or project-relative. */
  file: string;
  /** 1-based line number. */
  line: number;
  projectRoot: string;
  /** Rebuild the traceability graph even if a cached one exists. */
  rebuild?: boolean;
}

export interface TraceBlameResult {
  file: string;
  /** Project-relative file path (for display). */
  relFile: string;
  line: number;
  /** Short commit hash of the line's author. Null if the file isn't tracked. */
  commit: string | null;
  /** The full commit subject. Null if commit is null. */
  subject: string | null;
  /** Parsed story id from the subject, or null when absent/malformed. */
  story_id: string | null;
  story_title: string | null;
  reqs: { id: string; title?: string }[];
  jtbds: { id: string; title?: string }[];
  /** Test / API / DB nodes downstream of the story. */
  downstream: { id: string; kind: string; title?: string }[];
  /** True iff we resolved every hop up to and including at least one REQ. */
  traceComplete: boolean;
  /** Human-readable report (text form). */
  formatted: string;
}

// ─── Public API ─────────────────────────────────────────────────────

export async function traceBlame(opts: TraceBlameOpts): Promise<TraceBlameResult> {
  const fileAbs = isAbsolute(opts.file) ? opts.file : resolve(opts.projectRoot, opts.file);
  const relFile = relative(opts.projectRoot, fileAbs);

  if (!existsSync(fileAbs)) {
    return makeResult({
      file: fileAbs, relFile, line: opts.line,
      reason: 'file not found',
    });
  }
  if (opts.line < 1) {
    return makeResult({
      file: fileAbs, relFile, line: opts.line,
      reason: 'line must be >= 1',
    });
  }

  // 1. git blame for the specific line.
  const blame = readBlame(opts.projectRoot, relFile, opts.line);
  if (!blame) {
    return makeResult({
      file: fileAbs, relFile, line: opts.line,
      reason: 'file is not tracked by git (or not in a git repo)',
    });
  }

  // 2. Parse story tag from subject.
  const storyId = parseStoryTag(blame.subject ?? '');

  // 3. Build the graph, then look up the story + its upstream REQs/JTBDs
  //    and any downstream TEST/API/DB nodes.
  const graph = loadOrBuildGraph(opts.projectRoot, opts.rebuild);
  if (!graph) {
    // No _wdf_output — partial result still useful (file + commit + story).
    return makeResult({
      file: fileAbs, relFile, line: opts.line,
      commit: blame.hash, subject: blame.subject,
      story_id: storyId,
      reason: storyId
        ? `traceability graph unavailable; cannot resolve REQ/JTBD for ${storyId}`
        : undefined,
    });
  }

  const index = indexGraph(graph);
  const storyNode = storyId ? index.byId.get(storyId) : null;

  if (storyId && !storyNode) {
    return makeResult({
      file: fileAbs, relFile, line: opts.line,
      commit: blame.hash, subject: blame.subject,
      story_id: storyId,
      reason: `story "${storyId}" not in traceability graph`,
    });
  }

  const { reqs, jtbds, downstream } = storyNode
    ? walkStoryNeighbors(index, storyNode)
    : { reqs: [], jtbds: [], downstream: [] };

  return {
    file: fileAbs, relFile, line: opts.line,
    commit: blame.hash,
    subject: blame.subject,
    story_id: storyId,
    story_title: storyNode?.title ?? null,
    reqs, jtbds, downstream,
    traceComplete: reqs.length > 0,
    formatted: formatBlame({
      relFile, line: opts.line,
      commit: blame.hash, subject: blame.subject,
      story_id: storyId, story_title: storyNode?.title ?? null,
      reqs, jtbds, downstream,
    }),
  };
}

// ─── Internals ──────────────────────────────────────────────────────

function readBlame(cwd: string, relPath: string, line: number): { hash: string; subject: string } | null {
  let raw: string;
  try {
    // --porcelain is stable across git versions; -L limits to the one line.
    raw = execSync(`git blame -L ${line},${line} --porcelain -- "${relPath}"`, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
  } catch {
    return null;
  }
  // Porcelain output starts with `<full_hash> <orig> <final> [<lines>]`
  // then indented header lines, ending with a tab-prefixed source line.
  // We need hash + the commit subject (`summary <text>`).
  const lines = raw.split('\n');
  if (!lines[0]) return null;
  const hash = lines[0].split(' ')[0];
  if (!/^[0-9a-f]{40}$/.test(hash)) return null;
  const summaryLine = lines.find(l => l.startsWith('summary '));
  if (!summaryLine) return null;
  const subject = summaryLine.slice('summary '.length);
  return { hash: hash.slice(0, 12), subject };
}

function walkStoryNeighbors(index: AdjacencyIndex, storyNode: TraceNode): {
  reqs: { id: string; title?: string }[];
  jtbds: { id: string; title?: string }[];
  downstream: { id: string; kind: string; title?: string }[];
} {
  const reqs: { id: string; title?: string }[] = [];
  const jtbds: { id: string; title?: string }[] = [];
  const seenReq = new Set<string>();
  const seenJtbd = new Set<string>();

  // The graph uses *outgoing* derives_from / covers / belongs_to edges from
  // STORY to both REQ and JTBD. (parseStories emits STORY→REQ and
  // STORY→JTBD directly from the story's refs: list.) So JTBDs are siblings
  // of REQs at the story level, not grandparents.
  for (const e of index.out.get(storyNode.id) ?? []) {
    const node = index.byId.get(e.to);
    if (!node) continue;
    if (node.kind === 'REQ' && !seenReq.has(node.id)) {
      seenReq.add(node.id);
      reqs.push({ id: node.id, title: node.title });
    } else if (node.kind === 'JTBD' && !seenJtbd.has(node.id)) {
      seenJtbd.add(node.id);
      jtbds.push({ id: node.id, title: node.title });
    }
  }

  const downstream: { id: string; kind: string; title?: string }[] = [];
  for (const e of index.out.get(storyNode.id) ?? []) {
    const child = index.byId.get(e.to);
    if (!child) continue;
    if (child.kind === 'TEST' || child.kind === 'API' || child.kind === 'DB') {
      downstream.push({ id: child.id, kind: child.kind, title: child.title });
    }
  }

  return { reqs, jtbds, downstream };
}

function loadOrBuildGraph(projectRoot: string, rebuild?: boolean): TraceabilityGraph | null {
  const outputRoot = join(projectRoot, '_wdf_output');
  if (!existsSync(outputRoot)) return null;
  if (rebuild || !existsSync(join(outputRoot, 'traceability.graph.json'))) {
    return buildTraceabilityGraph({ projectRoot, outputRoot });
  }
  return loadGraph(outputRoot) ?? buildTraceabilityGraph({ projectRoot, outputRoot });
}

function makeResult(partial: Partial<TraceBlameResult> & {
  file: string; relFile: string; line: number;
  commit?: string | null; subject?: string | null;
  story_id?: string | null; story_title?: string | null;
  reqs?: { id: string; title?: string }[];
  jtbds?: { id: string; title?: string }[];
  downstream?: { id: string; kind: string; title?: string }[];
  reason?: string;
}): TraceBlameResult {
  const commit = partial.commit ?? null;
  const subject = partial.subject ?? null;
  const story_id = partial.story_id ?? null;
  const story_title = partial.story_title ?? null;
  const reqs = partial.reqs ?? [];
  const jtbds = partial.jtbds ?? [];
  const downstream = partial.downstream ?? [];
  return {
    file: partial.file, relFile: partial.relFile, line: partial.line,
    commit, subject, story_id, story_title,
    reqs, jtbds, downstream,
    traceComplete: reqs.length > 0,
    formatted: formatBlame({
      relFile: partial.relFile, line: partial.line,
      commit, subject,
      story_id, story_title,
      reqs, jtbds, downstream,
      reason: partial.reason,
    }),
  };
}

function formatBlame(p: {
  relFile: string; line: number;
  commit: string | null; subject: string | null;
  story_id: string | null; story_title: string | null;
  reqs: { id: string; title?: string }[];
  jtbds: { id: string; title?: string }[];
  downstream: { id: string; kind: string; title?: string }[];
  reason?: string;
}): string {
  const out: string[] = [];
  const pad = (k: string) => k.padEnd(16);

  out.push(`${pad('file')} ${p.relFile}:${p.line}`);
  out.push(`${pad('commit')} ${p.commit ?? '(untracked)'}${p.subject ? ` (${p.subject})` : ''}`);
  if (p.story_id) {
    out.push(`${pad('story')} ${p.story_id}${p.story_title ? ` "${p.story_title}"` : ''}`);
  } else if (p.reason) {
    out.push(`${pad('story')} — ${p.reason}`);
  }
  if (p.reqs.length > 0) {
    for (const r of p.reqs) {
      out.push(`${pad('REQ')} ${r.id}${r.title ? ` "${r.title}"` : ''}`);
    }
  }
  if (p.jtbds.length > 0) {
    for (const j of p.jtbds) {
      out.push(`${pad('JTBD')} ${j.id}${j.title ? ` "${j.title}"` : ''}`);
    }
  }
  if (p.downstream.length > 0) {
    for (const d of p.downstream) {
      out.push(`${pad(d.kind)} ${d.id}${d.title ? ` "${d.title}"` : ''}`);
    }
  }
  return out.join('\n');
}
