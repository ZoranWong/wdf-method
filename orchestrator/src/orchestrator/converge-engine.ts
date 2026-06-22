/**
 * converge-engine — brownfield code/spec gap analysis.
 *
 * Compares declared requirements (in `_wdf_output/specs/<domain>/spec.md` for
 * V3.9+ projects, or `_wdf_output/prd.md` for legacy V3.8 projects) against
 * requirement references found in source code. Emits a gap report:
 *
 *   - IMPLEMENTED  — REQ referenced in code (comment / decorator / route annotation)
 *   - GAP          — REQ declared but no code reference found
 *   - DRIFT        — code references a REQ id that is not declared in specs
 *
 * The scan is intentionally heuristic (regex over file contents), not AST.
 * This keeps the engine language-agnostic and dependency-free. False positives
 * are surfaced in the report so humans can adjudicate.
 *
 * Inspired by SpecKit's `/speckit.converge` flow; differs by reading the
 * wdf-method requirement vocabulary (REQ-NNN) instead of an external spec
 * format.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative, basename } from 'path';
import { createHash } from 'crypto';

const REQ_PATTERN = /\bREQ-(\d{3,4})\b/g;
const DEFAULT_IGNORES = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '_wdf_output',
  '.wdf',
  '_bmad-output',
  '_test-project',
]);

export interface ConvergeOptions {
  projectRoot: string;
  specsDir?: string;
  prdPath?: string;
  sourceDir?: string;
  toStories?: boolean;
}

export interface Requirement {
  id: string;
  name: string;
  domain: string;
  priority?: string;
}

export interface CodeReference {
  reqId: string;
  file: string;
  line: number;
  snippet: string;
}

export interface ConvergeResult {
  generatedAt: string;
  projectRoot: string;
  declaredReqs: Requirement[];
  codeRefs: CodeReference[];
  implemented: string[];
  gaps: string[];
  drift: CodeReference[];
  summary: {
    declared: number;
    implemented: number;
    gaps: number;
    drift: number;
    coveragePercent: number;
  };
}

/** Collect declared requirements from specs/ (V3.9) or prd.md (V3.8 fallback). */
export function collectDeclaredRequirements(opts: ConvergeOptions): Requirement[] {
  const out: Requirement[] = [];
  const seen = new Set<string>();

  const specsDir = opts.specsDir ?? join(opts.projectRoot, '_wdf_output', 'specs');
  if (existsSync(specsDir)) {
    for (const domain of readdirSync(specsDir)) {
      const domainDir = join(specsDir, domain);
      if (!statSync(domainDir).isDirectory()) continue;
      const specFile = join(domainDir, 'spec.md');
      if (!existsSync(specFile)) continue;
      const text = readFileSync(specFile, 'utf8');
      const reqBlocks = text.split(/^(?=#{1,6}\s+REQ-\d)/m);
      for (const block of reqBlocks) {
        const m = block.match(/^#{1,6}\s+(REQ-\d{3,4})(?::\s*(.+))?$/m);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          name: (m[2] ?? '').trim(),
          domain,
          priority: extractPriority(block),
        });
      }
    }
  }

  if (out.length === 0) {
    const prdPath = opts.prdPath ?? join(opts.projectRoot, '_wdf_output', 'prd.md');
    if (existsSync(prdPath)) {
      const text = readFileSync(prdPath, 'utf8');
      const lines = text.split('\n');
      for (const line of lines) {
        const m = line.match(/^#{1,6}\s+(REQ-\d{3,4})(?::\s*(.+))?$/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, name: (m[2] ?? '').trim(), domain: 'legacy-prd' });
      }
    }
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function extractPriority(block: string): string | undefined {
  const m = block.match(/\bpriority\s*:\s*(P[0-2])\b/i);
  return m ? m[1].toUpperCase() : undefined;
}

/** Scan source code for REQ-NNN references. */
export function scanCodeReferences(opts: ConvergeOptions): CodeReference[] {
  const sourceDir = opts.sourceDir ?? join(opts.projectRoot, 'src');
  const roots: string[] = [];
  if (existsSync(sourceDir)) roots.push(sourceDir);
  const backendSrc = join(opts.projectRoot, 'backend', 'src');
  if (existsSync(backendSrc)) roots.push(backendSrc);
  if (roots.length === 0) return [];

  const out: CodeReference[] = [];
  for (const root of roots) walk(root, (file) => scanFile(file, opts.projectRoot, out));
  return out.sort((a, b) => a.reqId.localeCompare(b.reqId) || a.file.localeCompare(b.file));
}

function walk(start: string, visit: (file: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(start);
  } catch {
    return;
  }
  for (const name of entries) {
    if (DEFAULT_IGNORES.has(name)) continue;
    const full = join(start, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, visit);
    else if (isSourceFile(name)) visit(full);
  }
}

function isSourceFile(name: string): boolean {
  return /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/.test(name);
}

function scanFile(absPath: string, projectRoot: string, out: CodeReference[]): void {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return;
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const matches = Array.from(lines[i].matchAll(new RegExp(REQ_PATTERN)));
    for (const m of matches) {
      out.push({
        reqId: `REQ-${m[1]}`,
        file: relative(projectRoot, absPath),
        line: i + 1,
        snippet: lines[i].trim().slice(0, 120),
      });
    }
  }
}

/** Three-way compare: declared × code → implemented / gap / drift. */
export function compare(
  declared: Requirement[],
  refs: CodeReference[],
): Pick<ConvergeResult, 'implemented' | 'gaps' | 'drift'> {
  const declaredIds = new Set(declared.map((r) => r.id));
  const referencedIds = new Set(refs.map((r) => r.reqId));

  const implemented = Array.from(referencedIds).filter((id) => declaredIds.has(id)).sort();
  const gaps = Array.from(declaredIds).filter((id) => !referencedIds.has(id)).sort();
  const drift = refs.filter((r) => !declaredIds.has(r.reqId));

  return { implemented, gaps, drift };
}

export function runConverge(opts: ConvergeOptions): ConvergeResult {
  const declaredReqs = collectDeclaredRequirements(opts);
  const codeRefs = scanCodeReferences(opts);
  const { implemented, gaps, drift } = compare(declaredReqs, codeRefs);

  const declared = declaredReqs.length;
  const implementedCount = implemented.length;
  const coveragePercent = declared === 0 ? 0 : Math.round((implementedCount / declared) * 100);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: opts.projectRoot,
    declaredReqs,
    codeRefs,
    implemented,
    gaps,
    drift,
    summary: {
      declared,
      implemented: implementedCount,
      gaps: gaps.length,
      drift: drift.length,
      coveragePercent,
    },
  };
}

/** Render a ConvergeResult as a markdown report. */
export function renderReport(result: ConvergeResult): string {
  const lines: string[] = [];
  lines.push(`# Converge Report`);
  lines.push('');
  lines.push(`**Generated:** ${result.generatedAt}`);
  lines.push(`**Project:** \`${relative('', result.projectRoot) || '.'}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Declared requirements | ${result.summary.declared} |`);
  lines.push(`| Implemented (code references found) | ${result.summary.implemented} |`);
  lines.push(`| Gaps (spec only, no code) | ${result.summary.gaps} |`);
  lines.push(`| Drift (code references unknown REQ) | ${result.summary.drift} |`);
  lines.push(`| Spec coverage | **${result.summary.coveragePercent}%** |`);
  lines.push('');

  if (result.gaps.length > 0) {
    lines.push('## Gaps — declared but not implemented');
    lines.push('');
    for (const id of result.gaps) {
      const req = result.declaredReqs.find((r) => r.id === id);
      lines.push(`- **${id}**${req?.name ? ` — ${req.name}` : ''}${req?.domain ? ` _(domain: ${req.domain})_` : ''}`);
    }
    lines.push('');
  }

  if (result.drift.length > 0) {
    lines.push('## Drift — code references undeclared REQ');
    lines.push('');
    lines.push('| REQ | File | Line | Snippet |');
    lines.push('|---|---|---|---|');
    for (const ref of result.drift.slice(0, 50)) {
      lines.push(`| ${ref.reqId} | \`${ref.file}\` | ${ref.line} | ${escapeTable(ref.snippet)} |`);
    }
    if (result.drift.length > 50) {
      lines.push(`| ... | _+${result.drift.length - 50} more_ | | |`);
    }
    lines.push('');
  }

  if (result.implemented.length > 0) {
    lines.push('## Implemented');
    lines.push('');
    lines.push('Requirements with at least one code reference:');
    lines.push('');
    for (const id of result.implemented) {
      const req = result.declaredReqs.find((r) => r.id === id);
      lines.push(`- **${id}**${req?.name ? ` — ${req.name}` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Methodology');
  lines.push('');
  lines.push('- Declared requirements are read from `_wdf_output/specs/<domain>/spec.md` (V3.9+)');
  lines.push('  or `_wdf_output/prd.md` (V3.8 legacy).');
  lines.push('- Code references are heuristic regex matches of `REQ-NNN` in source files.');
  lines.push('  Annotation patterns: comments, decorator metadata, route handlers.');
  lines.push('- A REQ with at least one reference counts as IMPLEMENTED; absence is a GAP.');
  lines.push('- False negatives are possible when code implements behavior without citing the REQ id.');
  lines.push('- Recommended workflow: add `// REQ-NNN: <one-line>` to route handlers to enrich this report.');

  return lines.join('\n') + '\n';
}

function escapeTable(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Write report and (optionally) draft stories for each gap. */
export function writeConvergeArtifacts(
  result: ConvergeResult,
  opts: ConvergeOptions,
): { reportPath: string; storiesDir?: string } {
  const outDir = join(opts.projectRoot, '_wdf_output');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const slug = createHash('sha1').update(opts.projectRoot).digest('hex').slice(0, 6);
  const reportPath = join(outDir, `converge-report-${date}-${slug}.md`);
  writeFileSync(reportPath, renderReport(result), 'utf8');

  let storiesDir: string | undefined;
  if (opts.toStories && result.gaps.length > 0) {
    storiesDir = join(outDir, 'stories', `converge-${date}`);
    if (!existsSync(storiesDir)) mkdirSync(storiesDir, { recursive: true });
    for (const id of result.gaps) {
      const req = result.declaredReqs.find((r) => r.id === id);
      const storyPath = join(storiesDir, `${id}-converge.md`);
      writeFileSync(storyPath, renderGapStory(id, req, date), 'utf8');
    }
  }

  return { reportPath, storiesDir };
}

function renderGapStory(id: string, req: Requirement | undefined, date: string): string {
  const title = req?.name || 'Untitled converge gap';
  return [
    '---',
    `story_id: ${id}-CONVERGE`,
    `title: Converge gap — ${title}`,
    'priority: P1',
    `generated_by: wdf converge (${date})`,
    'status: draft',
    '---',
    '',
    `# ${id} — ${title}`,
    '',
    '## Context',
    '',
    `This story was generated automatically by \`wdf converge\` because the`,
    `declared requirement **${id}**${req?.domain ? ` (domain: ${req.domain})` : ''} has no code`,
    'reference in the scanned source tree. A human must review and either:',
    '',
    '1. Implement the requirement (then add a `// REQ-NNN` annotation so future converge runs recognize it),',
    '2. Mark the requirement as obsolete and remove it from the spec, or',
    '3. Adjust converge source roots if the implementation lives elsewhere.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] Implementation exists in source code',
    '- [ ] Code carries a `// REQ-NNN` annotation',
    `- [ ] \`wdf converge\` reports ${id} as IMPLEMENTED`,
    '',
  ].join('\n');
}
