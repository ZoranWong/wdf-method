/**
 * import-cmd.ts — Phase D (V3.10.4) brownfield project onboarding.
 *
 * `wdf import --source=nextjs [--root=path]` orchestrates:
 *   1. reverseEngineerSpec   — code → candidate spec fragments
 *   2. spec-sync reverse      — bootstrap _wdf_output/ from candidates
 *   3. checkSpecDrift         — establish baseline drift for future runs
 *   4. scaffold _bmad-output/ — create the wdf working directory skeleton
 *
 * The goal: take an existing Next.js / Express / etc. project and get it
 * into a state where `wdf start` works on the next code change without
 * manual spec authoring.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { reverseEngineerSpec, type ReverseEngineerResult } from './spec-reverse-engineer.js';
import { checkSpecDrift, type DriftReport } from './spec-drift-checker.js';

export type ImportSource = 'nextjs' | 'express' | 'auto';

export interface ImportOptions {
  source?: ImportSource;
  root?: string;
}

export interface ImportResult {
  projectRoot: string;
  detectedSource: ImportSource;
  reverseEngineer: ReverseEngineerResult;
  driftBaseline: DriftReport;
  /** Path to the import summary report */
  summaryPath: string;
  /** True if a fresh _bmad-output/ skeleton was scaffolded */
  scaffoldedSkeleton: boolean;
}

/**
 * Run a brownfield import on an existing project.
 *
 * Idempotent — running twice produces the same artifacts (overwrites the
 * summary report). Safe to re-run after fixing detected drift.
 */
export async function runImport(opts: ImportOptions = {}): Promise<ImportResult> {
  const projectRoot = opts.root ?? process.cwd();
  const source = opts.source ?? 'auto';
  const detectedSource = source === 'auto' ? detectSource(projectRoot) : source;

  // Step 1: extract spec candidates from source
  const reverseEngineer = reverseEngineerSpec(projectRoot);

  // Step 2: ensure _wdf_output/ exists and seed prd.md if absent so later
  // stages have something to work with. Real spec-sync reverse would
  // convert candidates into actual spec/ artifacts — for now we just
  // surface the candidate count so the user knows what was found.
  ensureOutputDir(projectRoot);
  seedBootstrapPrd(projectRoot);

  // Step 3: baseline drift
  const driftBaseline = checkSpecDrift(projectRoot);

  // Step 4: scaffold _bmad-output skeleton if not present
  const scaffoldedSkeleton = scaffoldBmadOutput(projectRoot);

  // Write summary report
  const summaryPath = join(projectRoot, '_wdf_output', 'import-summary.md');
  writeFileSync(summaryPath, renderSummary({
    projectRoot,
    source: detectedSource,
    reverseEngineer,
    driftBaseline,
    scaffoldedSkeleton,
  }), 'utf-8');

  return {
    projectRoot,
    detectedSource,
    reverseEngineer,
    driftBaseline,
    summaryPath,
    scaffoldedSkeleton,
  };
}

/**
 * Heuristically detect the source framework from filesystem fingerprints.
 */
export function detectSource(projectRoot: string): ImportSource {
  if (existsSync(join(projectRoot, 'next.config.js')) || existsSync(join(projectRoot, 'next.config.mjs'))) {
    return 'nextjs';
  }
  if (existsSync(join(projectRoot, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSafe(join(projectRoot, 'package.json')));
      if (pkg.dependencies?.express || pkg.devDependencies?.express) return 'express';
      if (pkg.dependencies?.next || pkg.devDependencies?.next) return 'nextjs';
    } catch {
      // fallthrough
    }
  }
  return 'express'; // default fallback
}

// ── Internal helpers ────────────────────────────────────────────

function readFileSafe(p: string): string {
  try {
    return require('fs').readFileSync(p, 'utf-8');
  } catch {
    return '{}';
  }
}

function ensureOutputDir(projectRoot: string): void {
  mkdirSync(join(projectRoot, '_wdf_output', 'stories'), { recursive: true });
  mkdirSync(join(projectRoot, '_wdf_output', 'status', 'stories'), { recursive: true });
}

function seedBootstrapPrd(projectRoot: string): void {
  const prdPath = join(projectRoot, '_wdf_output', 'prd.md');
  if (existsSync(prdPath)) return; // don't clobber existing PRD
  writeFileSync(prdPath, [
    `# PRD (auto-bootstrapped by wdf import)`,
    ``,
    `This PRD was seeded by Phase D brownfield import. Replace the`,
    `placeholder REQs below with the project's actual requirements,`,
    `derived from the candidates in \`_wdf_output/brownfield/\`.`,
    ``,
    `## REQ-001: Placeholder`,
    ``,
    `Describe the first requirement here.`,
    ``,
  ].join('\n'), 'utf-8');
}

function scaffoldBmadOutput(projectRoot: string): boolean {
  const bmadDir = join(projectRoot, '_bmad-output');
  if (existsSync(bmadDir)) return false;
  mkdirSync(join(bmadDir, 'web-dev-flow', 'plans'), { recursive: true });
  mkdirSync(join(bmadDir, 'web-dev-flow', 'reviews'), { recursive: true });
  writeFileSync(join(bmadDir, 'README.md'),
    `# _bmad-output\n\nAuto-scaffolded by \`wdf import\` (Phase D / V3.10.4).\n`,
    'utf-8');
  return true;
}

function renderSummary(input: {
  projectRoot: string;
  source: ImportSource;
  reverseEngineer: ReverseEngineerResult;
  driftBaseline: DriftReport;
  scaffoldedSkeleton: boolean;
}): string {
  const { projectRoot, source, reverseEngineer, driftBaseline, scaffoldedSkeleton } = input;
  const lines: string[] = [
    `# Brownfield Import Summary`,
    ``,
    `**Project:** ${projectRoot}`,
    `**Detected source:** ${source}`,
    `**Generated:** ${new Date().toISOString()}`,
    ``,
    `## Reverse-engineered candidates`,
    ``,
    `Total: ${reverseEngineer.candidates.length}`,
    ``,
  ];
  for (const [fw, count] of Object.entries(reverseEngineer.stats)) {
    lines.push(`- ${fw}: ${count}`);
  }
  lines.push('');
  lines.push(`Candidates written to: \`${reverseEngineer.outputDir}\``);
  lines.push('');
  lines.push(`## Drift baseline`);
  lines.push('');
  if (driftBaseline.ok) {
    lines.push(`✅ No drift detected — spec and code aligned.`);
  } else {
    lines.push(`Total drift items: ${driftBaseline.drift.length}`);
    lines.push(`- Orphan endpoints: ${driftBaseline.counts.orphan_endpoints}`);
    lines.push(`- Unspec'd endpoints: ${driftBaseline.counts.unspec_endpoints}`);
    lines.push(`- Missing tests: ${driftBaseline.counts.missing_tests}`);
  }
  lines.push('');
  lines.push(`## Next steps`);
  lines.push('');
  lines.push(`1. Review candidates in \`_wdf_output/brownfield/\` — promote the high-confidence ones to \`_wdf_output/specs/<domain>/spec.md\`.`);
  lines.push(`2. Resolve drift items: add the missing endpoints to \`api-spec.yaml\` or remove the orphan routes.`);
  lines.push(`3. Run \`wdf start\` to begin normal Phase 1-3 planning. The seeded \`prd.md\` is a placeholder — replace it before continuing past Phase 2.`);
  if (scaffoldedSkeleton) {
    lines.push(`4. \`_bmad-output/\` skeleton was scaffolded. Move planning artifacts there as you create them.`);
  }
  return lines.join('\n') + '\n';
}
