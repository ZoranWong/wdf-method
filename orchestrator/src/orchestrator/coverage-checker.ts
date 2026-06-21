// Constitution coverage gate — enforces quality_redlines.test_coverage.
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

export interface CoverageThresholds {
  core_orchestration?: number;
  per_feature_positive?: number;
  per_feature_negative?: number;
  per_feature_edge?: number;
}

export interface CoverageSummaryEntry {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

export interface VitestCoverageSummary {
  total: CoverageSummaryEntry;
  [key: string]: CoverageSummaryEntry | any;
}

export interface CoverageCheckResult {
  ok: boolean;
  constitution_path: string;
  coverage_report_path: string | null;
  threshold: number;
  actual_pct: number | null;
  by_directory: Array<{
    directory: string;
    pct: number;
    covered: number;
    total: number;
  }>;
  failing_directories: string[];
  error?: string;
}

const DEFAULT_THRESHOLD = 90;

function findConstitution(projectRoot: string): string | null {
  const candidates = [
    join(projectRoot, 'constitution.yaml'),
    join(projectRoot, '..', 'constitution.yaml'),
    join(projectRoot, '..', '..', 'constitution.yaml'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  let dir = projectRoot;
  for (let i = 0; i < 6; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    const candidate = join(parent, 'constitution.yaml');
    const skillMarker = join(parent, 'SKILL.md');
    if (existsSync(candidate) && existsSync(skillMarker)) return candidate;
    dir = parent;
  }
  return null;
}

function readCoreOrchestrationThreshold(constitutionPath: string): number {
  const content = readFileSync(constitutionPath, 'utf8');
  const match = content.match(/core_orchestration:\s*(\d+)/);
  return match ? parseInt(match[1], 10) : DEFAULT_THRESHOLD;
}

function findCoverageSummary(projectRoot: string): string | null {
  const candidates = [
    join(projectRoot, 'orchestrator', 'coverage', 'coverage-summary.json'),
    join(projectRoot, 'coverage', 'coverage-summary.json'),
    join(projectRoot, 'orchestrator', 'coverage', 'coverage-final.json'),
    join(projectRoot, 'coverage', 'coverage-final.json'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

interface CoverageBreakdown {
  total_pct: number;
  by_directory: Array<{ directory: string; pct: number; covered: number; total: number }>;
}

function readCoverage(reportPath: string): CoverageBreakdown {
  const raw = readFileSync(reportPath, 'utf-8');
  const data = JSON.parse(raw);

  if (data.total && typeof data.total === 'object') {
    const linesPct = data.total.lines?.pct;
    const stmtsPct = data.total.statements?.pct;
    const totalPct: number | null = typeof linesPct === 'number' ? linesPct
      : typeof stmtsPct === 'number' ? stmtsPct
        : null;
    if (totalPct !== null) {
      const byDir = new Map<string, { covered: number; total: number }>();
      for (const [file, entry] of Object.entries<any>(data)) {
        if (file === 'total') continue;
        const lines = entry?.lines;
        if (!lines || typeof lines.total !== 'number') continue;
        const dir = dirname(file).replace(/^.*\/orchestrator\//, '');
        const cur = byDir.get(dir) ?? { covered: 0, total: 0 };
        cur.covered += lines.covered ?? 0;
        cur.total += lines.total ?? 0;
        byDir.set(dir, cur);
      }
      const by_directory = Array.from(byDir.entries())
        .map(([directory, v]) => ({
          directory,
          pct: v.total > 0 ? (v.covered / v.total) * 100 : 0,
          covered: v.covered,
          total: v.total,
        }))
        .sort((a, b) => a.pct - b.pct);
      return { total_pct: totalPct, by_directory };
    }
  }

  const fileEntries = Object.entries<any>(data).filter(([k]) => k !== 'total');
  if (fileEntries.length === 0) return { total_pct: 0, by_directory: [] };

  let totalStatements = 0;
  let totalCovered = 0;
  const byDir = new Map<string, { covered: number; total: number }>();
  for (const [file, entry] of fileEntries) {
    const stmts = entry?.s ?? {};
    const statementCount = Object.keys(stmts).length;
    const coveredCount = Object.values(stmts).filter((v: any) => v > 0).length;
    totalStatements += statementCount;
    totalCovered += coveredCount;
    const dir = dirname(file).replace(/^.*\/orchestrator\//, '');
    const cur = byDir.get(dir) ?? { covered: 0, total: 0 };
    cur.covered += coveredCount;
    cur.total += statementCount;
    byDir.set(dir, cur);
  }
  const total_pct = totalStatements > 0 ? (totalCovered / totalStatements) * 100 : 0;
  const by_directory = Array.from(byDir.entries())
    .map(([directory, v]) => ({
      directory,
      pct: v.total > 0 ? (v.covered / v.total) * 100 : 0,
      covered: v.covered,
      total: v.total,
    }))
    .sort((a, b) => a.pct - b.pct);
  return { total_pct, by_directory };
}

export function checkCoverage(projectRoot: string): CoverageCheckResult {
  const constitutionPath = findConstitution(projectRoot);
  if (!constitutionPath) {
    return {
      ok: false,
      constitution_path: '(not found)',
      coverage_report_path: null,
      threshold: DEFAULT_THRESHOLD,
      actual_pct: null,
      by_directory: [],
      failing_directories: [],
      error: 'constitution.yaml not found — cannot determine coverage threshold',
    };
  }
  const threshold = readCoreOrchestrationThreshold(constitutionPath);
  const coveragePath = findCoverageSummary(projectRoot);
  if (!coveragePath) {
    return {
      ok: false,
      constitution_path: constitutionPath,
      coverage_report_path: null,
      threshold,
      actual_pct: null,
      by_directory: [],
      failing_directories: [],
      error: 'Coverage report not found. Run: cd orchestrator && npx vitest run --coverage',
    };
  }
  let actualPct: number;
  let by_directory: CoverageCheckResult['by_directory'];
  try {
    const r = readCoverage(coveragePath);
    actualPct = r.total_pct;
    by_directory = r.by_directory;
  } catch (err: any) {
    return {
      ok: false,
      constitution_path: constitutionPath,
      coverage_report_path: coveragePath,
      threshold,
      actual_pct: null,
      by_directory: [],
      failing_directories: [],
      error: `Failed to parse coverage report: ${err?.message ?? err}`,
    };
  }
  const failing = by_directory
    .filter(d => d.pct < threshold)
    .map(d => `${d.directory} (${d.pct.toFixed(1)}%)`);
  return {
    ok: actualPct >= threshold,
    constitution_path: constitutionPath,
    coverage_report_path: coveragePath,
    threshold,
    actual_pct: actualPct,
    by_directory,
    failing_directories: failing,
  };
}

export function formatCoverageReport(r: CoverageCheckResult): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════');
  lines.push('Constitution Coverage Gate');
  lines.push('═══════════════════════════════════════════');
  if (r.error) {
    lines.push(`  ❌ ${r.error}`);
    lines.push('');
    lines.push(`  Constitution: ${r.constitution_path}`);
    return lines.join('\n');
  }
  const icon = r.ok ? '✅' : '❌';
  lines.push(`  ${icon} Overall: ${r.actual_pct?.toFixed(2)}% (threshold: ${r.threshold}%)`);
  lines.push('');
  lines.push(`  Constitution: ${r.constitution_path}`);
  lines.push(`  Report:       ${r.coverage_report_path}`);
  if (r.by_directory.length > 0) {
    lines.push('');
    lines.push('  By directory (lowest first):');
    for (const d of r.by_directory.slice(0, 15)) {
      const dIcon = d.pct >= r.threshold ? '✓' : '✗';
      lines.push(`    ${dIcon} ${d.directory.padEnd(40)} ${d.pct.toFixed(1)}% (${d.covered}/${d.total})`);
    }
  }
  if (r.failing_directories.length > 0) {
    lines.push('');
    lines.push(`  ❌ Failing directories (${r.failing_directories.length}):`);
    for (const f of r.failing_directories.slice(0, 10)) {
      lines.push(`     • ${f}`);
    }
  }
  return lines.join('\n');
}
