/**
 * converge-engine — brownfield code/spec gap analysis + runtime drift detection.
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
 * Also supports runtime drift detection via `detectRuntimeDrift()`, which
 * checks FSM state consistency:
 *   - Phase artifacts match declared phase state
 *   - Story states match actual progress (code exists, tests pass)
 *   - Pipeline stages have corresponding reports on disk
 *   - Story dependencies are satisfied
 *
 * Inspired by SpecKit's `/speckit.converge` flow; differs by reading the
 * wdf-method requirement vocabulary (REQ-NNN) instead of an external spec
 * format.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative, basename } from 'path';
import { createHash } from 'crypto';
import { load as yamlLoad } from 'js-yaml';
import { SprintStatusManager } from './sprint-status.js';

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

// ── Runtime Drift Detection ──────────────────────────────────────────────────

export interface DriftIssue {
  type: 'phase_artifact_missing' | 'story_state_mismatch' | 'pipeline_report_missing' | 'dependency_not_met';
  severity: 'error' | 'warning';
  message: string;
  phase?: number;
  sub_phase?: string;
  story_id?: string;
  expected?: string;
  actual?: string;
}

export interface DriftReport {
  generatedAt: string;
  projectRoot: string;
  issues: DriftIssue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
  };
}

/**
 * Detect runtime drift: inconsistencies between FSM state and actual project state.
 *
 * Checks:
 *   1. Phase artifacts match declared phase state (e.g., PRD exists if Phase 2 is DONE)
 *   2. Story states match actual progress (e.g., MERGED stories have code files)
 *   3. Pipeline stages have corresponding reports on disk
 *   4. Story dependencies are satisfied (dependency stories are MERGED)
 */
export async function detectRuntimeDrift(projectRoot: string): Promise<DriftReport> {
  const issues: DriftIssue[] = [];
  const outputDir = join(projectRoot, '_wdf_output');

  // Load sprint status
  const statusPath = join(outputDir, 'sprint-status.yaml');
  if (!existsSync(statusPath)) {
    return {
      generatedAt: new Date().toISOString(),
      projectRoot,
      issues: [{
        type: 'phase_artifact_missing',
        severity: 'error',
        message: 'sprint-status.yaml not found — project not initialized or state corrupted',
      }],
      summary: { total: 1, errors: 1, warnings: 0 },
    };
  }

  const state = await SprintStatusManager.load(statusPath);
  const globalState = state.data.global_state;
  const currentPhase = globalState.current_phase ?? 1;

  // ── Check 1: Phase artifacts ─────────────────────────────────────────────
  if (currentPhase >= 2) {
    const prdPath = join(outputDir, 'prd.md');
    if (!existsSync(prdPath)) {
      issues.push({
        type: 'phase_artifact_missing',
        severity: 'error',
        message: `Phase 2 PRD missing (current phase: ${currentPhase})`,
        phase: 2,
        expected: '_wdf_output/prd.md',
        actual: 'not found',
      });
    }
  }

  if (currentPhase >= 3) {
    const epicsPath = join(outputDir, 'epics.md');
    const storiesDir = join(outputDir, 'stories');
    if (!existsSync(epicsPath)) {
      issues.push({
        type: 'phase_artifact_missing',
        severity: 'warning',
        message: `Phase 3 epics.md missing (current phase: ${currentPhase})`,
        phase: 3,
        expected: '_wdf_output/epics.md',
        actual: 'not found',
      });
    }
    if (!existsSync(storiesDir) || readdirSync(storiesDir).length === 0) {
      issues.push({
        type: 'phase_artifact_missing',
        severity: 'warning',
        message: `Phase 3 stories directory empty or missing (current phase: ${currentPhase})`,
        phase: 3,
        expected: '_wdf_output/stories/*.md',
        actual: 'no stories found',
      });
    }
  }

  // ── Check 2: Story states ────────────────────────────────────────────────
  const devOrder = globalState.development_order ?? [];
  for (const storyEntry of devOrder) {
    const storyId = storyEntry.story_id;
    const track = storyEntry.track;
    const subKey = track === 'frontend' ? 'phase_4_10' : 'phase_4_4';

    const stories = state.getStories(4, subKey);
    const story = stories.find(s => s.id === storyId);

    if (!story) {
      // Story in development_order but not in phase_4 state
      issues.push({
        type: 'story_state_mismatch',
        severity: 'warning',
        message: `Story ${storyId} in development_order but not in phase 4 state`,
        phase: 4,
        story_id: storyId,
        expected: 'story entry in phase_4 state',
        actual: 'not found',
      });
      continue;
    }

    // Check MERGED stories have code
    if (story.status === 'MERGED') {
      const scopeFiles = storyEntry.scope_write ?? [];
      if (scopeFiles.length > 0) {
        const missingFiles = scopeFiles.filter(f => !existsSync(join(projectRoot, f)));
        if (missingFiles.length > 0) {
          issues.push({
            type: 'story_state_mismatch',
            severity: 'error',
            message: `Story ${storyId} marked MERGED but scope_write files missing`,
            phase: 4,
            sub_phase: subKey,
            story_id: storyId,
            expected: 'all scope_write files exist',
            actual: `${missingFiles.length} file(s) missing: ${missingFiles.slice(0, 3).join(', ')}`,
          });
        }
      }
    }

    // Check pipeline stages have reports
    if (story.pipeline) {
      const pipeline = story.pipeline;
      const stage = pipeline.stage;

      // If pipeline is at review/testing/qa, check for reports
      if (stage === 'review' || stage === 'testing' || stage === 'qa') {
        const reportDir = stage === 'review' ? 'review' : stage === 'testing' ? 'test-reports' : 'qa';
        const reportFile = join(outputDir, reportDir, `${storyId}-${stage === 'review' ? 'review' : stage === 'testing' ? 'test' : 'qa'}.json`);
        if (!existsSync(reportFile)) {
          issues.push({
            type: 'pipeline_report_missing',
            severity: 'warning',
            message: `Story ${storyId} pipeline at ${stage} but no ${stage} report found`,
            phase: 4,
            sub_phase: subKey,
            story_id: storyId,
            expected: reportFile,
            actual: 'not found',
          });
        }
      }
    }

    // Check dependencies are satisfied
    const deps = storyEntry.depends_on ?? [];
    for (const dep of deps) {
      const depSubKey = dep.track === 'frontend' ? 'phase_4_10' : 'phase_4_4';
      const depStories = state.getStories(4, depSubKey);
      const depStory = depStories.find(s => s.id === dep.story_id);

      if (!depStory || depStory.status !== 'MERGED') {
        issues.push({
          type: 'dependency_not_met',
          severity: 'error',
          message: `Story ${storyId} depends on ${dep.story_id} which is not MERGED`,
          phase: 4,
          story_id: storyId,
          expected: `dependency ${dep.story_id} status = MERGED`,
          actual: depStory ? depStory.status : 'not found',
        });
      }
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    issues,
    summary: {
      total: issues.length,
      errors,
      warnings,
    },
  };
}

/** Render a DriftReport as a markdown report. */
export function renderDriftReport(report: DriftReport): string {
  const lines: string[] = [];
  lines.push('# Runtime Drift Report');
  lines.push('');
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Project:** \`${relative('', report.projectRoot) || '.'}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Total issues | ${report.summary.total} |`);
  lines.push(`| Errors | ${report.summary.errors} |`);
  lines.push(`| Warnings | ${report.summary.warnings} |`);
  lines.push('');

  if (report.issues.length === 0) {
    lines.push('✅ **No drift detected.** FSM state is consistent with project artifacts.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // Group by type
  const byType = new Map<string, DriftIssue[]>();
  for (const issue of report.issues) {
    const list = byType.get(issue.type) ?? [];
    list.push(issue);
    byType.set(issue.type, list);
  }

  const typeLabels: Record<string, string> = {
    phase_artifact_missing: 'Phase Artifacts Missing',
    story_state_mismatch: 'Story State Mismatches',
    pipeline_report_missing: 'Pipeline Reports Missing',
    dependency_not_met: 'Unsatisfied Dependencies',
  };

  for (const [type, issues] of byType) {
    lines.push(`## ${typeLabels[type] ?? type}`);
    lines.push('');

    if (type === 'phase_artifact_missing' || type === 'story_state_mismatch') {
      lines.push('| Severity | Message | Phase | Story | Expected | Actual |');
      lines.push('|---|---|---|---|---|---|');
      for (const issue of issues) {
        const sev = issue.severity === 'error' ? '🔴' : '🟡';
        const phase = issue.phase ? `Phase ${issue.phase}` : '-';
        const story = issue.story_id ?? '-';
        const expected = issue.expected ? `\`${issue.expected}\`` : '-';
        const actual = issue.actual ? `\`${issue.actual}\`` : '-';
        lines.push(`| ${sev} | ${issue.message} | ${phase} | ${story} | ${expected} | ${actual} |`);
      }
    } else if (type === 'pipeline_report_missing') {
      lines.push('| Story | Stage | Expected Report |');
      lines.push('|---|---|---|');
      for (const issue of issues) {
        lines.push(`| ${issue.story_id} | ${issue.expected?.split('/').pop()?.replace('.json', '')} | \`${issue.expected}\` |`);
      }
    } else if (type === 'dependency_not_met') {
      lines.push('| Story | Dependency | Expected | Actual |');
      lines.push('|---|---|---|---|');
      for (const issue of issues) {
        const depId = issue.expected?.match(/(\S+) status/)?.[1] ?? '-';
        lines.push(`| ${issue.story_id} | ${depId} | ${issue.expected} | ${issue.actual} |`);
      }
    }
    lines.push('');
  }

  lines.push('## Recommendations');
  lines.push('');
  if (report.summary.errors > 0) {
    lines.push('🔴 **Errors must be resolved before proceeding.** These indicate state corruption or incomplete work.');
    lines.push('');
  }
  if (report.summary.warnings > 0) {
    lines.push('🟡 **Warnings should be reviewed.** These may indicate missing artifacts or incomplete transitions.');
    lines.push('');
  }
  lines.push('Run `wdf doctor` for automated diagnostics, or manually inspect the flagged items.');

  return lines.join('\n') + '\n';
}
