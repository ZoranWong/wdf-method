/**
 * checklist-cmd — "Unit Tests for Requirements".
 *
 * Why this exists:
 *   The existing SRG (SRG-01..09) and linter rules verify "does the story
 *   *exist* with the right shape?" — scope_write, acceptance_check, refs,
 *   etc. They never check "does the story *say something testable*?". A
 *   story with `title: "make system user-friendly"` sails through because
 *   every field is syntactically valid. The ambiguity only surfaces in
 *   Phase 4 when the dev agent gets stuck or the QA stage finds no AC to
 *   verify against.
 *
 *   The checklist fills that gap: a per-story markdown listing CHK###
 *   items the story must pass before dispatch. Two kinds of items:
 *
 *     Mechanical (CLI-generated, always deterministic):
 *       - CHK001: story has a REQ mapping
 *       - CHK002: scope_write is atomic (≤ threshold files)
 *       - CHK003: acceptance_check has ≥ N commands
 *       - CHK004: scope_write paths don't overlap other in-flight stories
 *
 *     Soft (Claude supplements in /wdf-checklist session):
 *       - CHK0XX: title has no ambiguous adjectives
 *       - CHK0XY: each AC is independently verifiable
 *       - CHK0XZ: edge cases considered
 *
 *   The gate is hard: SRG refuses dispatch unless every item is `[x]`.
 *
 * Storage: `_wdf_output/checklists/<story-id>.md`
 *   Frontmatter: story_id, generated_at, generator, status
 *   Body: two sections of markdown checklist items
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { loadConfig, type LoadConfigResult } from './config.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface GenerateChecklistOpts {
  storyId: string;
  projectRoot: string;
  /** Override default config (for tests). */
  config?: LoadConfigResult;
  /** Force overwrite an existing checklist. Default: false (idempotent). */
  force?: boolean;
}

export interface GenerateChecklistResult {
  path: string;
  /** True if we wrote a new file; false if one already existed and we left it. */
  created: boolean;
  items: ChecklistItem[];
  /** The items that the CLI generated mechanically (hard constraints). */
  mechanicalItems: ChecklistItem[];
}

export interface VerifyChecklistOpts {
  storyId: string;
  projectRoot: string;
  config?: LoadConfigResult;
}

export interface VerifyChecklistResult {
  ok: boolean;
  /** True if the file exists at all. */
  exists: boolean;
  path: string;
  /** Every CHK item, with its current state. */
  items: ChecklistItem[];
  /** CHK ids that are still unchecked. */
  unchecked: string[];
  reason?: string;
}

export interface ChecklistItem {
  id: string;            // CHK###
  description: string;
  checked: boolean;
  /** 'mechanical' (CLI-generated) or 'soft' (Claude-generated). */
  source: 'mechanical' | 'soft';
}

interface ParsedChecklist {
  frontmatter: Record<string, unknown>;
  items: ChecklistItem[];
  rawLines: string[];
}

// ─── Public API ─────────────────────────────────────────────────────

export function generateChecklist(opts: GenerateChecklistOpts): GenerateChecklistResult {
  const cfg = opts.config ?? loadConfig(opts.projectRoot);
  const outDir = checklistsDir(cfg, opts.projectRoot);
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${opts.storyId}.md`);

  // Idempotent: if the checklist exists and force isn't set, leave it alone
  // (the user may have already checked items off).
  if (existsSync(path) && !opts.force) {
    const parsed = parseChecklistFile(path);
    return {
      path, created: false, items: parsed.items,
      mechanicalItems: parsed.items.filter(i => i.source === 'mechanical'),
    };
  }

  // Read the story markdown to build mechanical CHK items.
  const storyFile = locateStoryMarkdown(opts.projectRoot, opts.storyId);
  if (!storyFile) {
    throw new Error(`story "${opts.storyId}" not found in ${opts.projectRoot}/_wdf_output/stories/`);
  }
  const storyContent = readFileSync(storyFile, 'utf8');
  const fm = parseFrontmatter(storyContent);
  if (!fm) {
    throw new Error(`story "${opts.storyId}" at ${storyFile} has no YAML frontmatter`);
  }

  const mechanical = buildMechanicalItems(opts.storyId, fm, cfg, opts.projectRoot);

  const soft: ChecklistItem[] = [
    { id: 'CHK-001', description: 'Title is specific (no vague adjectives: "user-friendly", "fast", "robust", "good")', checked: false, source: 'soft' },
    { id: 'CHK-002', description: 'Each acceptance_criteria entry is independently verifiable (pass/fail without ambiguity)', checked: false, source: 'soft' },
    { id: 'CHK-003', description: 'Edge cases considered: empty input, concurrent calls, permission denied, timeout', checked: false, source: 'soft' },
    { id: 'CHK-004', description: 'Dependencies declared: every `depends_on:` story exists and is in a valid upstream state', checked: false, source: 'soft' },
    { id: 'CHK-005', description: 'Out of scope explicit: story states what it deliberately does NOT touch', checked: false, source: 'soft' },
  ];

  const allItems = [...mechanical, ...soft];
  writeFileSync(path, renderChecklist(opts.storyId, allItems), 'utf8');

  return { path, created: true, items: allItems, mechanicalItems: mechanical };
}

export function verifyChecklist(opts: VerifyChecklistOpts): VerifyChecklistResult {
  const cfg = opts.config ?? loadConfig(opts.projectRoot);
  const outDir = checklistsDirectory(cfg, opts.projectRoot);
  const path = join(outDir, `${opts.storyId}.md`);

  if (!existsSync(path)) {
    return {
      ok: false, exists: false, path, items: [], unchecked: [],
      reason: `checklist file not found at ${path} (run \`wdf checklist ${opts.storyId}\` to generate it)`,
    };
  }

  const parsed = parseChecklistFile(path);
  const unchecked = parsed.items.filter(i => !i.checked).map(i => i.id);
  return {
    ok: unchecked.length === 0,
    exists: true, path,
    items: parsed.items,
    unchecked,
    reason: unchecked.length > 0
      ? `unchecked items: ${unchecked.join(', ')}`
      : undefined,
  };
}

/** List every checklist in the project. */
export function listChecklists(opts: { projectRoot: string; config?: LoadConfigResult }): { storyId: string; path: string; ok: boolean; unchecked: number; total: number }[] {
  const cfg = opts.config ?? loadConfig(opts.projectRoot);
  const outDir = checklistsDirectory(cfg, opts.projectRoot);
  if (!existsSync(outDir)) return [];
  const out: { storyId: string; path: string; ok: boolean; unchecked: number; total: number }[] = [];
  for (const entry of readdirSync(outDir)) {
    if (!entry.endsWith('.md')) continue;
    const storyId = entry.slice(0, -3);
    const parsed = parseChecklistFile(join(outDir, entry));
    const unchecked = parsed.items.filter(i => !i.checked).length;
    out.push({ storyId, path: join(outDir, entry), ok: unchecked === 0, unchecked, total: parsed.items.length });
  }
  return out;
}

// ─── Internals ──────────────────────────────────────────────────────

function checklistsDir(cfg: LoadConfigResult, projectRoot: string): string {
  return checklistsDirectory(cfg, projectRoot);
}
function checklistsDirectory(cfg: LoadConfigResult, projectRoot: string): string {
  const wf = cfg.config?.workflow ?? {};
  const custom = (wf as { checklists_output?: string }).checklists_output;
  if (custom) return custom;
  return join(projectRoot, '_wdf_output', 'checklists');
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return null;
  try {
    return yaml.load(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function locateStoryMarkdown(projectRoot: string, storyId: string): string | null {
  const candidates = [
    join(projectRoot, '_wdf_output', 'stories', `${storyId}.md`),
    join(projectRoot, 'wdf-output', 'stories', `${storyId}.md`),
    join(projectRoot, 'docs', 'wdf', 'stories', `${storyId}.md`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function buildMechanicalItems(
  storyId: string,
  fm: Record<string, unknown>,
  cfg: LoadConfigResult,
  projectRoot: string,
): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const scopeMax = cfgChecklistScopeMaxFiles(cfg);
  const acMin = cfgChecklistAcMinCount(cfg);

  // CHK-M01: REQ mapping.
  const reqs = extractReqRefs(fm);
  out.push({
    id: 'CHK-M01',
    description: `Story declares a REQ mapping (maps_to_req: or refs: [REQ-…]). Found: ${reqs.length > 0 ? reqs.join(', ') : 'none'}`,
    checked: reqs.length > 0,
    source: 'mechanical',
  });

  // CHK-M02: scope_write non-empty and atomic (≤ threshold).
  const scope = readFmList(fm, 'scope_write');
  out.push({
    id: 'CHK-M02',
    description: `scope_write is non-empty and ≤ ${scopeMax} files. Found: ${scope.length} file(s)${scope.length > 0 ? ` (${scope.slice(0, 3).join(', ')}${scope.length > 3 ? '…' : ''})` : ''}`,
    checked: scope.length > 0 && scope.length <= scopeMax,
    source: 'mechanical',
  });

  // CHK-M03: acceptance_check has ≥ N commands.
  const ac = readFmList(fm, 'acceptance_check');
  out.push({
    id: 'CHK-M03',
    description: `acceptance_check declares ≥ ${acMin} command(s). Found: ${ac.length}`,
    checked: ac.length >= acMin,
    source: 'mechanical',
  });

  // CHK-M04: REQ mapping resolves (the REQ appears in prd.md).
  const prdPath = join(projectRoot, '_wdf_output', 'prd.md');
  let prdContent: string | null = null;
  if (existsSync(prdPath)) {
    try { prdContent = readFileSync(prdPath, 'utf8'); } catch { prdContent = null; }
  }
  const unresolved = prdContent
    ? reqs.filter(r => !prdContent!.includes(r))
    : reqs.slice(); // no prd → every declared REQ is unresolved
  out.push({
    id: 'CHK-M04',
    description: `Every declared REQ exists in prd.md.${prdContent === null ? ' (prd.md not found)' : ''}${unresolved.length > 0 ? ` Missing: ${unresolved.join(', ')}` : ''}`,
    checked: unresolved.length === 0 && reqs.length > 0 && prdContent !== null,
    source: 'mechanical',
  });

  // CHK-M05: scope_write paths are project-relative (no leading / or ..).
  const unsafe = scope.filter(p => p.startsWith('/') || p.includes('..'));
  out.push({
    id: 'CHK-M05',
    description: `scope_write paths are project-relative (no leading "/" or "..").${unsafe.length > 0 ? ` Unsafe: ${unsafe.join(', ')}` : ''}`,
    checked: unsafe.length === 0,
    source: 'mechanical',
  });

  void storyId; // reserved for future cross-story scope overlap checks
  return out;
}

function readFmList(fm: Record<string, unknown>, key: string): string[] {
  const v = fm[key];
  if (Array.isArray(v)) return v.filter((e): e is string => typeof e === 'string');
  if (typeof v === 'string') return v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  return [];
}

function extractReqRefs(fm: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const key of ['maps_to_req', 'refs']) {
    const raw = fm[key];
    if (typeof raw === 'string') {
      for (const id of raw.split(/[,\s]+/)) {
        if (/^REQ(-[A-Za-z0-9]+)?-\d+$/.test(id.trim())) out.add(id.trim());
      }
    } else if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        for (const id of entry.split(/[,\s]+/)) {
          if (/^REQ(-[A-Za-z0-9]+)?-\d+$/.test(id.trim())) out.add(id.trim());
        }
      }
    }
  }
  return Array.from(out);
}

function cfgChecklistScopeMaxFiles(cfg: LoadConfigResult): number {
  const c = (cfg.config?.workflow ?? {}) as { checklist?: { scope_max_files?: number } };
  return c.checklist?.scope_max_files ?? 8;
}
function cfgChecklistAcMinCount(cfg: LoadConfigResult): number {
  const c = (cfg.config?.workflow ?? {}) as { checklist?: { ac_min_count?: number } };
  return c.checklist?.ac_min_count ?? 1;
}

function parseChecklistFile(path: string): ParsedChecklist {
  const raw = readFileSync(path, 'utf8');
  const fmMatch = raw.match(FRONTMATTER_RE);
  const fm: Record<string, unknown> = fmMatch ? (yaml.load(fmMatch[1]) as Record<string, unknown>) : {};

  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  const items: ChecklistItem[] = [];

  // Each item looks like: `- [x] CHK### description` or `- [ ] CHK### description`.
  const re = /^- \[([ xX])\]\s+(CHK-[A-Z0-9]+)\s+(.+)$/;
  for (const line of body.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const checked = m[1].toLowerCase() === 'x';
    const id = m[2];
    const description = m[3];
    items.push({ id, description, checked, source: id.startsWith('CHK-M') ? 'mechanical' : 'soft' });
  }

  return { frontmatter: fm, items, rawLines: raw.split('\n') };
}

function renderChecklist(storyId: string, items: ChecklistItem[]): string {
  const mech = items.filter(i => i.source === 'mechanical');
  const soft = items.filter(i => i.source === 'soft');
  const lines: string[] = [
    '---',
    `story_id: ${storyId}`,
    `generated_at: ${new Date().toISOString()}`,
    'generator: hybrid(cli+vibe)',
    `status: ${items.every(i => i.checked) ? 'complete' : 'pending'}`,
    '---',
    '',
    `# ${storyId} — Requirements Checklist`,
    '',
    '> Generated mechanically from the story frontmatter. Soft constraints (below) are',
    '> prompts for the planning agent: tick them when you have actually inspected the story',
    '> against each criterion — do NOT auto-check.',
    '',
    '## Hard Constraints (CLI-generated)',
    '',
  ];
  for (const i of mech) lines.push(renderItem(i));
  lines.push('');
  lines.push('## Soft Constraints (Claude-reviewed)');
  lines.push('');
  for (const i of soft) lines.push(renderItem(i));
  lines.push('');
  return lines.join('\n');
}

function renderItem(i: ChecklistItem): string {
  return `- [${i.checked ? 'x' : ' '}] ${i.id} ${i.description}`;
}
