/**
 * clarify-cmd — structured clarification of an underspecified PRD.
 *
 * Why this exists:
 *   The PRD (phase_2_5) is the what/why. Architecture, epics, stories and
 *   the API spec are all derived from it downstream. If the PRD says "the
 *   system should be fast" or "handle errors appropriately", that ambiguity
 *   propagates silently — the architect guesses, the story inherits the
 *   guess, and the gap only surfaces in Phase 4 QA (or production).
 *
 *   SpecKit solves this with a `/clarify` step that records underspecified
 *   areas before planning. This is wdf's equivalent: a deterministic scan
 *   that surfaces ambiguity markers and emits a persisted artifact —
 *   `_wdf_output/clarifications.md` — that Claude (or a human) answers
 *   before solutioning proceeds.
 *
 *   Two kinds of finding, all CLI-detected and deterministic:
 *     - ambiguity        : non-measurable adjective ("fast", "scalable", …)
 *     - placeholder      : TBD / TODO / "etc." / "as appropriate" markers
 *     - non_measurable   : a REQ-NNN whose section has no number/threshold
 *
 *   `wdf clarify verify` exits non-zero while any clarification is open —
 *   usable as a soft gate before Phase 3 solutioning.
 *
 * Storage: `_wdf_output/clarifications.md`
 *   Idempotent: re-running rescans the PRD but preserves resolved answers
 *   (matched by a stable per-item key embedded as an HTML comment). Fixed
 *   PRD lines drop out of the Open section automatically.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── Types ──────────────────────────────────────────────────────────

export type ClarifyCategory = 'ambiguity' | 'placeholder' | 'non_measurable';

export interface ClarificationItem {
  id: string;             // CL###
  category: ClarifyCategory;
  source: string;         // e.g. "prd.md:12"
  question: string;
  status: 'open' | 'resolved';
  answer?: string;
  /** Suggested answers — guidance only, not a decision. */
  options?: string[];
  /** Why the chosen answer was selected (decision rationale). */
  rationale?: string;
  /** Stable identity across rescans (category + offending token). */
  key: string;
}

export interface ScanClarificationsOpts {
  projectRoot: string;
  /** Override the PRD path (for tests). Default: _wdf_output/prd.md */
  prdPath?: string;
  outputRoot?: string;
}

export interface ScanClarificationsResult {
  path: string;
  items: ClarificationItem[];
  open: number;
  resolved: number;
  /** True if the artifact file did not exist before this scan. */
  created: boolean;
}

export interface VerifyClarificationsResult {
  ok: boolean;
  exists: boolean;
  path: string;
  open: string[];   // CL ids still open
  total: number;
}

// Non-measurable adjectives that need a concrete target to be testable.
const AMBIGUOUS_TERMS = [
  'fast', 'slow', 'scalable', 'user-friendly', 'user friendly', 'intuitive',
  'robust', 'flexible', 'simple', 'easy', 'secure', 'efficient', 'seamless',
  'modern', 'performant', 'reliable', 'lightweight', 'responsive', 'smooth',
];

// Incompleteness markers — the spec defers a decision. Prose markers match
// case-insensitively; code markers (TODO/FIXME) are matched case-SENSITIVELY
// as uppercase whole words so a domain noun like "todo" (a Todo app!) or
// "fixme@example.com" doesn't trip them.
const PLACEHOLDER_TERMS = [
  'tbd', 'to be determined', '???',
  'etc.', 'etc ', 'and so on', 'as needed', 'as appropriate', 'as required',
];
const CODE_MARKERS = ['TODO', 'FIXME'];

// ─── Public API ─────────────────────────────────────────────────────

export function scanClarifications(opts: ScanClarificationsOpts): ScanClarificationsResult {
  const outRoot = opts.outputRoot ?? join(opts.projectRoot, '_wdf_output');
  const prdPath = opts.prdPath ?? join(outRoot, 'prd.md');
  const artifactPath = join(outRoot, 'clarifications.md');

  const existed = existsSync(artifactPath);
  const prior = existed ? parseClarifications(readFileSync(artifactPath, 'utf-8')) : [];

  const findings = existsSync(prdPath)
    ? detectFindings(readFileSync(prdPath, 'utf-8'))
    : [];

  const merged = mergeFindings(findings, prior);

  mkdirSync(outRoot, { recursive: true });
  writeFileSync(artifactPath, renderClarifications(merged), 'utf-8');

  return {
    path: artifactPath,
    items: merged,
    open: merged.filter(i => i.status === 'open').length,
    resolved: merged.filter(i => i.status === 'resolved').length,
    created: !existed,
  };
}

export function verifyClarifications(opts: { projectRoot: string; outputRoot?: string }): VerifyClarificationsResult {
  const outRoot = opts.outputRoot ?? join(opts.projectRoot, '_wdf_output');
  const artifactPath = join(outRoot, 'clarifications.md');

  if (!existsSync(artifactPath)) {
    return { ok: false, exists: false, path: artifactPath, open: [], total: 0 };
  }

  const items = parseClarifications(readFileSync(artifactPath, 'utf-8'));
  // Standardized resolution: a checked box ALONE is not enough — a resolved
  // item must carry a non-empty **Answer:**. A `- [x]` with no answer means
  // "marked done but the decision was never recorded", which we treat as
  // still open so the gate keeps failing until the answer is written.
  const openItems = items.filter(
    i => i.status === 'open' || !i.answer || i.answer.trim().length === 0,
  );
  const open = openItems.map(i => i.id);
  return {
    ok: open.length === 0,
    exists: true,
    path: artifactPath,
    open,
    total: items.length,
  };
}

// ─── Detection ──────────────────────────────────────────────────────

interface Finding {
  category: ClarifyCategory;
  source: string;
  question: string;
  key: string;
  options?: string[];
}

/**
 * Suggested answers per finding — guidance only, never a decision. The author
 * picks one (or writes their own) and records it as the **Answer:** plus a
 * **Rationale:**. Ambiguity options are tailored to the offending term's
 * quality dimension; placeholder / non_measurable use category templates.
 */
function optionsFor(category: ClarifyCategory, term?: string): string[] {
  if (category === 'placeholder') {
    return ['fill concrete value', 'drop if out of scope', 'defer to a change request (CR)'];
  }
  if (category === 'non_measurable') {
    return [
      'add a numeric threshold (e.g. < 200ms)',
      'add a count / percentage target',
      'add a unit of measure',
      'other (specify)',
    ];
  }
  // ambiguity — map the adjective to its quality dimension.
  const t = (term ?? '').toLowerCase();
  const perf = ['fast', 'slow', 'performant', 'responsive', 'efficient', 'smooth', 'lightweight'];
  const scale = ['scalable'];
  const reliability = ['reliable', 'robust'];
  const security = ['secure'];
  const usability = ['user-friendly', 'user friendly', 'intuitive', 'easy', 'simple', 'seamless', 'modern', 'flexible'];
  if (perf.includes(t)) {
    return ['p95 latency < 200ms', 'p95 latency < 500ms', 'throughput ≥ N req/s', 'other (specify)'];
  }
  if (scale.includes(t)) {
    return ['supports N concurrent users', 'horizontal scaling to N nodes', 'throughput ≥ N req/s', 'other (specify)'];
  }
  if (reliability.includes(t)) {
    return ['uptime ≥ 99.9%', 'error rate < 0.1%', 'recovers from failure within N s', 'other (specify)'];
  }
  if (security.includes(t)) {
    return ['meets OWASP ASVS L2', 'all endpoints require authn + authz', 'data encrypted at rest + in transit', 'other (specify)'];
  }
  if (usability.includes(t)) {
    return ['task completion rate ≥ N%', 'time-on-task < N s', 'SUS score ≥ N', 'other (specify)'];
  }
  return ['define a numeric threshold', 'define a unit / count', 'other (specify)'];
}

export function detectFindings(prd: string): Finding[] {
  const findings: Finding[] = [];
  const seenKeys = new Set<string>();
  const lines = prd.split('\n');

  // Track REQ sections to evaluate measurability.
  let currentReq: { id: string; line: number; bodyHasNumber: boolean } | null = null;
  const flushReq = () => {
    if (currentReq && !currentReq.bodyHasNumber) {
      const key = `non_measurable::${currentReq.id}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        findings.push({
          category: 'non_measurable',
          source: `prd.md:${currentReq.line}`,
          question: `${currentReq.id} has no measurable acceptance criterion — add a concrete target (a number, threshold, or unit).`,
          key,
          options: optionsFor('non_measurable'),
        });
      }
    }
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const lower = line.toLowerCase();
    const lineNo = i + 1;

    // REQ section boundary
    const reqMatch = line.match(/^#+\s*(REQ-\d+)\b/);
    if (reqMatch) {
      flushReq();
      currentReq = { id: reqMatch[1], line: lineNo, bodyHasNumber: /\d/.test(line.replace(reqMatch[1], '')) };
    } else if (currentReq) {
      if (/^#+\s/.test(line)) {
        // a new heading ends the REQ section
        flushReq();
        currentReq = null;
      } else if (/\d/.test(line)) {
        currentReq.bodyHasNumber = true;
      }
    }

    // Placeholder markers (prose, case-insensitive)
    for (const term of PLACEHOLDER_TERMS) {
      if (lower.includes(term)) {
        const key = `placeholder::${term.trim()}::${lineNo}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          findings.push({
            category: 'placeholder',
            source: `prd.md:${lineNo}`,
            question: `Incompleteness marker "${term.trim()}" — replace the deferred decision with a concrete specification.`,
            key,
            options: optionsFor('placeholder'),
          });
        }
        break; // one placeholder finding per line is enough
      }
    }

    // Code markers (TODO / FIXME) — uppercase, case-sensitive, word-boundary
    for (const marker of CODE_MARKERS) {
      if (new RegExp(`\\b${marker}\\b`).test(raw)) {
        const key = `placeholder::${marker}::${lineNo}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          findings.push({
            category: 'placeholder',
            source: `prd.md:${lineNo}`,
            question: `Incompleteness marker "${marker}" — replace the deferred decision with a concrete specification.`,
            key,
            options: optionsFor('placeholder'),
          });
        }
        break;
      }
    }

    // Ambiguous adjectives (word-boundary match to avoid substrings)
    for (const term of AMBIGUOUS_TERMS) {
      const re = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (re.test(line)) {
        const key = `ambiguity::${term}::${lineNo}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          findings.push({
            category: 'ambiguity',
            source: `prd.md:${lineNo}`,
            question: `"${term}" is not measurable — define a concrete, testable target (e.g. a latency, a count, a percentage).`,
            key,
            options: optionsFor('ambiguity', term),
          });
        }
      }
    }
  });

  flushReq();
  return findings;
}

// ─── Merge (idempotent) ─────────────────────────────────────────────

function mergeFindings(findings: Finding[], prior: ClarificationItem[]): ClarificationItem[] {
  const priorByKey = new Map(prior.map(p => [p.key, p]));

  // Resolved items are a historical record — carry them forward verbatim.
  const resolved = prior.filter(p => p.status === 'resolved');
  const resolvedKeys = new Set(resolved.map(r => r.key));

  // Open items are regenerated from the current scan: a finding whose key is
  // already resolved is suppressed; otherwise it reuses the prior id if it
  // was already open, else gets a fresh id.
  const open: ClarificationItem[] = [];
  let maxId = prior.reduce((m, p) => Math.max(m, parseInt(p.id.replace(/\D/g, ''), 10) || 0), 0);

  for (const f of findings) {
    if (resolvedKeys.has(f.key)) continue;
    const existing = priorByKey.get(f.key);
    const id = existing?.id ?? `CL${String(++maxId).padStart(3, '0')}`;
    open.push({
      id,
      category: f.category,
      source: f.source,
      question: f.question,
      status: 'open',
      // Fresh options from the current scan; preserve any answer/rationale the
      // author already typed even if they haven't checked the box yet.
      options: f.options,
      answer: existing?.answer,
      rationale: existing?.rationale,
      key: f.key,
    });
  }

  return [...open, ...resolved];
}

// ─── Parse / Render ─────────────────────────────────────────────────

const KEY_RE = /<!--\s*key:(.+?)\s*-->/;
const ITEM_RE = /^- \[( |x)\]\s+(CL\d+)\s+\[(\w+)\]\s+(\S+)\s+—\s+(.*?)(?:\s*<!--.*)?$/;

export function parseClarifications(content: string): ClarificationItem[] {
  const items: ClarificationItem[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ITEM_RE);
    if (!m) continue;
    const [, check, id, category, source, question] = m;
    const keyMatch = lines[i].match(KEY_RE);

    // Scan the indented continuation lines beneath the item for
    // `- Options:`, `**Answer:**`, `**Rationale:**`. Stop at the next item,
    // a section heading, or a non-indented / blank line.
    let answer: string | undefined;
    let rationale: string | undefined;
    let options: string[] | undefined;
    for (let j = i + 1; j < lines.length; j++) {
      const cont = lines[j];
      if (!/^\s+/.test(cont)) break;        // dedent ends the item block
      if (ITEM_RE.test(cont)) break;         // next item
      const trimmed = cont.trim();
      const ans = trimmed.match(/^\*\*Answer:\*\*\s*(.*)$/);
      if (ans) { answer = ans[1].trim() || undefined; continue; }
      const rat = trimmed.match(/^\*\*Rationale:\*\*\s*(.*)$/);
      if (rat) { rationale = rat[1].trim() || undefined; continue; }
      const opt = trimmed.match(/^- Options:\s*(.*)$/);
      if (opt) { options = parseOptions(opt[1]); continue; }
    }

    items.push({
      id,
      category: category as ClarifyCategory,
      source,
      question: question.trim(),
      status: check === 'x' ? 'resolved' : 'open',
      answer,
      rationale,
      options,
      key: keyMatch ? keyMatch[1].trim() : `${category}::${source}`,
    });
  }

  return items;
}

/** Parse a rendered "(a) X (b) Y (c) Z" options string back into a list. */
function parseOptions(raw: string): string[] | undefined {
  const out: string[] = [];
  const re = /\([a-z]\)\s*(.*?)(?=\s*\([a-z]\)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

export function renderClarifications(items: ClarificationItem[]): string {
  const open = items.filter(i => i.status === 'open');
  const resolved = items.filter(i => i.status === 'resolved');

  const lines: string[] = [];
  lines.push('---');
  lines.push(`generated_at: ${new Date().toISOString()}`);
  lines.push('generator: wdf-cli');
  lines.push(`status: ${open.length === 0 ? 'resolved' : 'open'}`);
  lines.push(`open_count: ${open.length}`);
  lines.push(`total_count: ${items.length}`);
  lines.push('---');
  lines.push('');
  lines.push('# Clarifications');
  lines.push('');
  lines.push('Underspecified areas detected in the PRD. Each open item lists');
  lines.push('suggested `Options` (guidance only). Resolve an item by checking the');
  lines.push('box AND filling a non-empty `**Answer:**` (a `[x]` with no answer still');
  lines.push('counts as open), then reflect the decision back into `prd.md`.');
  lines.push('');

  lines.push('## Open');
  lines.push('');
  if (open.length === 0) {
    lines.push('_(none — all clarifications resolved)_');
  } else {
    for (const i of open) lines.push(...renderItem(i));
  }
  lines.push('');

  lines.push('## Resolved');
  lines.push('');
  if (resolved.length === 0) {
    lines.push('_(none yet)_');
  } else {
    for (const i of resolved) lines.push(...renderItem(i));
  }
  lines.push('');

  return lines.join('\n');
}

function renderItem(i: ClarificationItem): string[] {
  const box = i.status === 'resolved' ? 'x' : ' ';
  const out = [`- [${box}] ${i.id} [${i.category}] ${i.source} — ${i.question} <!-- key:${i.key} -->`];
  if (i.options && i.options.length > 0) {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const rendered = i.options.map((o, idx) => `(${letters[idx] ?? '?'}) ${o}`).join(' ');
    out.push(`  - Options: ${rendered}`);
  }
  // Always render Answer/Rationale lines so the author has a slot to fill.
  // A resolved item MUST carry a non-empty Answer (enforced by verify).
  out.push(`  **Answer:** ${i.answer ?? ''}`);
  out.push(`  **Rationale:** ${i.rationale ?? ''}`);
  return out;
}
