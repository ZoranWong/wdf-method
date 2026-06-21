/**
 * ac-test-binding.ts — Acceptance Criteria ↔ Test binding validator.
 *
 * CHG-2026-005 (OPT-04): a story declares its acceptance criteria as
 * `acceptance_criteria: [AC-1, AC-2, …]` in its frontmatter. Each AC must be
 * bound to at least one test case that PASSED in the latest run.
 *
 * Two binding conventions are supported:
 *
 *   1. Name-prefix:        it('AC-1: validates input', () => {…})
 *   2. Comment annotation: // @ac AC-1
 *                          it('validates input', () => {…})
 *
 * Both are detected by a line-oriented scanner — no AST parser dependency.
 *
 * Test outcomes come from vitest / jest JSON reporters. The validator then
 * joins ACs ↔ bindings ↔ outcomes and produces an AcBindingReport.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { spawn } from 'child_process';

// ─── Types ───────────────────────────────────────────────────────────

export interface AcceptanceCriterion {
  id: string;              // canonical "AC-1", "AC-2", …
  description?: string;    // optional human-readable text from frontmatter
}

export type BindingKind = 'name_prefix' | 'comment_annotation';

export interface TestBinding {
  ac_id: string;           // "AC-1"
  test_name: string;       // raw it/test argument
  file: string;            // relative path
  line: number;            // 1-based
  binding_kind: BindingKind;
}

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'todo';

export interface TestRunResult {
  test_name: string;
  status: TestStatus;
  duration_ms?: number;
  failure_message?: string;
  file?: string;
}

export interface AcBindingReport {
  story_id: string;
  acs: AcceptanceCriterion[];
  bindings: TestBinding[];
  unbound_acs: string[];          // ACs with zero matching bindings
  failing_acs: string[];          // ACs whose bound tests had ≥1 fail
  skipped_acs: string[];          // ACs whose bound tests were only skipped
  unknown_bindings: TestBinding[]; // bindings to AC IDs not declared on the story
  missing_test_results: string[]; // test_names matched in scan but absent from reporter output
  all_pass: boolean;
}

// ─── Story frontmatter parser ───────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Extract `acceptance_criteria` from a story markdown file's YAML
 * frontmatter. Supports two YAML shapes:
 *
 *   acceptance_criteria: [AC-1, AC-2, AC-3]
 *
 *   acceptance_criteria:
 *     - AC-1
 *     - AC-2: optional description
 *     - id: AC-3
 *       description: another shape
 *
 * Returns an empty array if no AC list is present.
 */
export function parseAcsFromStory(content: string): AcceptanceCriterion[] {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return [];
  const fm = m[1];

  // Inline list:  acceptance_criteria: [AC-1, AC-2]
  const inline = fm.match(/^acceptance_criteria:\s*\[([^\]]*)\]\s*$/m);
  if (inline) {
    return inline[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(id => ({ id: normalizeAcId(stripQuotes(id)) }))
      .filter(ac => isValidAcId(ac.id));
  }

  // Block list — line-scan for indented children of `acceptance_criteria:`
  const fmLines = fm.split('\n');
  const headerIdx = fmLines.findIndex(l => /^acceptance_criteria:\s*$/.test(l));
  if (headerIdx === -1) return [];
  const childLines: string[] = [];
  for (let i = headerIdx + 1; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (!line.trim()) { childLines.push(line); continue; }
    if (/^\S/.test(line)) break; // back to top-level key
    childLines.push(line);
  }
  const out: AcceptanceCriterion[] = [];
  for (const line of childLines) {
    if (!line.trim()) continue;
    // - AC-1
    // - AC-2: description text
    let m = line.match(/^\s*-\s*(?:id:\s*)?["']?(AC[-_]?\d+)["']?\s*(?::\s*(.*))?\s*$/i);
    if (m) {
      const id = normalizeAcId(m[1]);
      if (isValidAcId(id)) {
        const desc = (m[2] ?? '').trim() || undefined;
        out.push({ id, description: stripQuotes(desc ?? '') || undefined });
      }
      continue;
    }
    // description: ...   (continuation of previous mapping form)
    m = line.match(/^\s+description:\s*(.*)$/);
    if (m && out.length > 0) {
      out[out.length - 1].description = stripQuotes(m[1].trim());
    }
  }
  return out;
}

function normalizeAcId(s: string): string {
  return s.trim().toUpperCase().replace(/^AC[-_]?(\d+)$/, 'AC-$1');
}

function isValidAcId(s: string): boolean {
  return /^AC-\d+$/.test(s);
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, '');
}

// ─── Test scanner ────────────────────────────────────────────────────

const TEST_FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const DEFAULT_IGNORES = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

const NAME_PREFIX_RE =
  /\b(?:it|test)(?:\.\w+)?\s*\(\s*(['"`])((?:AC-\d+)\s*:[^'"`]*)\1/g;
const COMMENT_ANNOT_RE = /\/\/\s*@ac\s+(AC-\d+)\b/i;
const TEST_CALL_RE =
  /\b(?:it|test)(?:\.\w+)?\s*\(\s*(['"`])([^'"`]+)\1/;

export interface ScanOptions {
  /** Roots to scan. Each may be a directory or a single file. */
  roots: string[];
  /** Optional project root for relative paths in output. */
  projectRoot?: string;
  /** Directory names to skip. Defaults: node_modules, dist, build, .git, coverage. */
  ignoreDirs?: Set<string>;
}

/**
 * Walk the test roots and return every AC ↔ test binding found.
 * The scanner is line-based, deterministic, and does not execute any code.
 */
export function scanTestsForAcBindings(opts: ScanOptions): TestBinding[] {
  const ignores = opts.ignoreDirs ?? DEFAULT_IGNORES;
  const projectRoot = opts.projectRoot ?? process.cwd();
  const out: TestBinding[] = [];

  for (const root of opts.roots) {
    if (!existsSync(root)) continue;
    walk(root, ignores, file => {
      if (!TEST_FILE_EXTS.has(extname(file))) return;
      scanFile(file, projectRoot, out);
    });
  }
  return out;
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

function scanFile(absPath: string, projectRoot: string, out: TestBinding[]): void {
  let content: string;
  try { content = readFileSync(absPath, 'utf8'); } catch { return; }
  const rel = relative(projectRoot, absPath) || absPath;
  const lines = content.split('\n');

  // Pass 1: name-prefix bindings (regex with line offset reconstruction)
  let charOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    NAME_PREFIX_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NAME_PREFIX_RE.exec(line)) !== null) {
      const inside = m[2];
      const acMatch = inside.match(/^(AC-\d+)\s*:/);
      if (!acMatch) continue;
      out.push({
        ac_id: normalizeAcId(acMatch[1]),
        test_name: inside,
        file: rel,
        line: i + 1,
        binding_kind: 'name_prefix',
      });
    }
    charOffset += line.length + 1;
  }

  // Pass 2: comment annotations — // @ac AC-N on a line, then nearest
  // it()/test() call within the next 5 non-blank lines (allows
  // describe blocks or multi-line test definitions).
  for (let i = 0; i < lines.length; i++) {
    const cm = lines[i].match(COMMENT_ANNOT_RE);
    if (!cm) continue;
    const acId = normalizeAcId(cm[1]);
    let look = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      if (!lines[j].trim()) continue;
      look++;
      const tm = lines[j].match(TEST_CALL_RE);
      if (tm) {
        // Skip if this test was already captured by name_prefix pass for the same AC
        const dup = out.some(b =>
          b.file === rel && b.line === j + 1 && b.ac_id === acId);
        if (!dup) {
          out.push({
            ac_id: acId,
            test_name: tm[2],
            file: rel,
            line: j + 1,
            binding_kind: 'comment_annotation',
          });
        }
        break;
      }
      if (look >= 5) break;
    }
  }
}

// ─── Reporter parsers ────────────────────────────────────────────────

interface VitestJsonShape {
  testResults?: Array<{
    name?: string;
    assertionResults?: Array<{
      title?: string;
      fullName?: string;
      status?: string;
      duration?: number;
      failureMessages?: string[];
    }>;
  }>;
  numTotalTests?: number;
}

/**
 * Parse vitest's `--reporter=json` output. Vitest follows jest's reporter
 * shape closely, so the same parser handles both — but we expose a named
 * function for documentation clarity.
 */
export function parseVitestJson(raw: string | object): TestRunResult[] {
  return parseJestLikeJson(raw);
}

/** Parse jest's `--json` output. */
export function parseJestJson(raw: string | object): TestRunResult[] {
  return parseJestLikeJson(raw);
}

function parseJestLikeJson(raw: string | object): TestRunResult[] {
  let obj: VitestJsonShape;
  try {
    obj = typeof raw === 'string' ? JSON.parse(raw) : (raw as VitestJsonShape);
  } catch (e) {
    throw new Error(`reporter JSON parse error: ${(e as Error).message}`);
  }
  if (!obj || !Array.isArray(obj.testResults)) {
    throw new Error('reporter JSON missing testResults[]');
  }
  const out: TestRunResult[] = [];
  for (const tr of obj.testResults) {
    const file = tr.name;
    for (const a of tr.assertionResults ?? []) {
      const status = mapStatus(a.status);
      out.push({
        test_name: a.title ?? a.fullName ?? '<unnamed>',
        status,
        duration_ms: typeof a.duration === 'number' ? a.duration : undefined,
        failure_message: a.failureMessages?.[0],
        file,
      });
    }
  }
  return out;
}

function mapStatus(s: string | undefined): TestStatus {
  switch ((s ?? '').toLowerCase()) {
    case 'passed':
    case 'pass':
      return 'passed';
    case 'failed':
    case 'fail':
      return 'failed';
    case 'pending':
    case 'skipped':
    case 'skip':
      return 'skipped';
    case 'todo':
      return 'todo';
    default:
      return 'failed';
  }
}

// ─── Validator ───────────────────────────────────────────────────────

export interface ValidateAcBindingsArgs {
  story_id: string;
  acs: AcceptanceCriterion[];
  bindings: TestBinding[];
  test_results: TestRunResult[];
}

/**
 * Join ACs ↔ bindings ↔ test outcomes. An AC is considered satisfied
 * iff at least one bound test was found AND every bound test PASSED in
 * the latest run.
 */
export function validateAcBindings(args: ValidateAcBindingsArgs): AcBindingReport {
  const acIds = new Set(args.acs.map(a => a.id));
  const bindingsByAc = new Map<string, TestBinding[]>();
  const unknownBindings: TestBinding[] = [];

  for (const b of args.bindings) {
    if (!acIds.has(b.ac_id)) {
      unknownBindings.push(b);
      continue;
    }
    const list = bindingsByAc.get(b.ac_id) ?? [];
    list.push(b);
    bindingsByAc.set(b.ac_id, list);
  }

  // Index test results by name. Vitest may report nested describe paths
  // separated by spaces; we match on the trailing it/test argument.
  const resultsByName = new Map<string, TestRunResult[]>();
  for (const r of args.test_results) {
    const list = resultsByName.get(r.test_name) ?? [];
    list.push(r);
    resultsByName.set(r.test_name, list);
  }

  const unboundAcs: string[] = [];
  const failingAcs: string[] = [];
  const skippedAcs: string[] = [];
  const missingTestResults: string[] = [];

  for (const ac of args.acs) {
    const bs = bindingsByAc.get(ac.id) ?? [];
    if (bs.length === 0) {
      unboundAcs.push(ac.id);
      continue;
    }
    let anyPassed = false;
    let anyFailed = false;
    let anySkipped = false;
    for (const b of bs) {
      const matches = matchResults(b, args.test_results);
      if (matches.length === 0) {
        missingTestResults.push(`${ac.id} → ${b.test_name} (${b.file}:${b.line})`);
        continue;
      }
      for (const r of matches) {
        if (r.status === 'passed') anyPassed = true;
        else if (r.status === 'failed') anyFailed = true;
        else anySkipped = true;
      }
    }
    if (anyFailed) failingAcs.push(ac.id);
    else if (!anyPassed && anySkipped) skippedAcs.push(ac.id);
    else if (!anyPassed) {
      // No matching test results at all
      if (!unboundAcs.includes(ac.id)) {
        // It had bindings on disk but none ran — treat as failing (fail-closed)
        failingAcs.push(ac.id);
      }
    }
  }

  const all_pass =
    unboundAcs.length === 0 &&
    failingAcs.length === 0 &&
    skippedAcs.length === 0 &&
    unknownBindings.length === 0;

  return {
    story_id: args.story_id,
    acs: args.acs,
    bindings: args.bindings,
    unbound_acs: unboundAcs,
    failing_acs: failingAcs,
    skipped_acs: skippedAcs,
    unknown_bindings: unknownBindings,
    missing_test_results: missingTestResults,
    all_pass,
  };
}

function matchResults(binding: TestBinding, results: TestRunResult[]): TestRunResult[] {
  // Two match modes:
  //   1. Exact match on test_name
  //   2. Suffix match — vitest may report "AC-1: validates input" while the
  //      binding scanner captured the same string; suffix is a safety net for
  //      describe-prefixed reporter output.
  const exact = results.filter(r => r.test_name === binding.test_name);
  if (exact.length) return exact;
  const ending = results.filter(r => r.test_name.endsWith(binding.test_name));
  if (ending.length) return ending;
  // Final fallback: AC-prefix match
  const acPrefix = `${binding.ac_id}:`;
  return results.filter(r => r.test_name.includes(acPrefix));
}

// ─── Formatter ───────────────────────────────────────────────────────

export function formatAcBindingReport(r: AcBindingReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════');
  lines.push(`AC ↔ Test Binding — ${r.story_id}`);
  lines.push('═══════════════════════════════════════════');
  lines.push(`  ACs declared: ${r.acs.length}`);
  lines.push(`  Bindings:     ${r.bindings.length}`);
  lines.push('');

  for (const ac of r.acs) {
    const bs = r.bindings.filter(b => b.ac_id === ac.id);
    if (r.unbound_acs.includes(ac.id)) {
      lines.push(`  ✗ ${ac.id} — UNBOUND (no test refers to this AC)`);
    } else if (r.failing_acs.includes(ac.id)) {
      lines.push(`  ✗ ${ac.id} — FAILING (${bs.length} binding${bs.length === 1 ? '' : 's'}, at least one fail/missing)`);
      for (const b of bs) lines.push(`      └ ${b.file}:${b.line}  ${b.test_name}`);
    } else if (r.skipped_acs.includes(ac.id)) {
      lines.push(`  ⊘ ${ac.id} — SKIPPED (only skipped tests bound)`);
    } else {
      lines.push(`  ✓ ${ac.id} — OK (${bs.length} binding${bs.length === 1 ? '' : 's'})`);
    }
  }

  if (r.unknown_bindings.length) {
    lines.push('');
    lines.push(`  ! Unknown bindings (test refers to AC not declared on story):`);
    for (const b of r.unknown_bindings) lines.push(`      └ ${b.ac_id} ← ${b.file}:${b.line}`);
  }

  lines.push('───────────────────────────────────────────');
  lines.push(`  Status: ${r.all_pass ? 'ALL PASS — AC binding gate satisfied' : 'BLOCKED — fix bindings before acceptance'}`);
  lines.push('═══════════════════════════════════════════');
  return lines.join('\n');
}

// ─── High-level runner (Phase 4.6 / 4.12 integration) ────────────────

export type TestFramework = 'vitest' | 'jest';

export interface RunAcBindingCheckOptions {
  /** Absolute path to the story markdown file. */
  storyPath: string;
  /** Story ID for the report header (defaults to filename). */
  storyId?: string;
  /** Roots to scan for test files. Usually [`<projectRoot>/test`] or repo root. */
  testRoots: string[];
  /** Project root (used to resolve relative paths in the report). */
  projectRoot: string;
  /** Framework to invoke. Defaults to 'vitest'. */
  framework?: TestFramework;
  /**
   * Pre-collected reporter JSON. When provided, the runner does NOT spawn
   * a test process — useful when CI already produced a reporter file.
   */
  reporterJson?: string | object;
  /**
   * Test command to run. Defaults to `npx vitest run --reporter=json`
   * (or `npx jest --json` for jest). Override for monorepo setups.
   */
  command?: string;
  /** Per-command timeout in ms. Defaults to 5 min. */
  timeoutMs?: number;
  /** Optional env overrides merged onto process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface RunAcBindingCheckResult {
  report: AcBindingReport;
  /** Raw reporter JSON used (string form) — useful for audit logs. */
  reporter_json: string;
  /** Exit code of the spawned test process, or 0 if reporterJson supplied. */
  exit_code: number;
}

/**
 * End-to-end check used by acceptance gates 4.6 (BE Code Acceptance) and
 * 4.12 (FE UI Acceptance).
 *
 * Steps:
 *   1. Read story frontmatter → declared ACs
 *   2. Scan test files → AC bindings
 *   3. Run (or load) test reporter JSON → outcomes
 *   4. Join → AcBindingReport
 *
 * The function never throws on AC validation failures — it returns a
 * report whose `all_pass` flag tells the gate caller whether to block.
 * It does throw on infrastructure errors (missing story, malformed JSON).
 */
export async function runAcBindingCheck(
  opts: RunAcBindingCheckOptions,
): Promise<RunAcBindingCheckResult> {
  if (!existsSync(opts.storyPath)) {
    throw new Error(`story file not found: ${opts.storyPath}`);
  }
  const storyContent = readFileSync(opts.storyPath, 'utf8');
  const acs = parseAcsFromStory(storyContent);
  const storyId = opts.storyId ?? deriveStoryId(opts.storyPath, storyContent);

  const bindings = scanTestsForAcBindings({
    roots: opts.testRoots,
    projectRoot: opts.projectRoot,
  });

  let reporterJson: string;
  let exit = 0;
  if (opts.reporterJson !== undefined) {
    reporterJson = typeof opts.reporterJson === 'string'
      ? opts.reporterJson
      : JSON.stringify(opts.reporterJson);
  } else {
    const framework = opts.framework ?? 'vitest';
    const cmd = opts.command ?? defaultCommand(framework);
    const out = await runTestCommand(cmd, opts.projectRoot, opts.timeoutMs, opts.env);
    reporterJson = out.stdout;
    exit = out.exitCode;
  }

  const test_results = parseJestLikeJson(reporterJson);
  const report = validateAcBindings({ story_id: storyId, acs, bindings, test_results });
  return { report, reporter_json: reporterJson, exit_code: exit };
}

function defaultCommand(framework: TestFramework): string {
  return framework === 'jest'
    ? 'npx jest --json'
    : 'npx vitest run --reporter=json';
}

function deriveStoryId(storyPath: string, content: string): string {
  const fmMatch = content.match(FRONTMATTER_RE);
  if (fmMatch) {
    const idMatch = fmMatch[1].match(/^story_id:\s*["']?([^"'\n]+)["']?/m);
    if (idMatch) return idMatch[1].trim();
  }
  return storyPath.replace(/^.*[\\/]/, '').replace(/\.md$/, '');
}

interface CmdOut { stdout: string; stderr: string; exitCode: number; }

function runTestCommand(
  rawCmd: string,
  cwd: string,
  timeoutMs = 5 * 60_000,
  env?: NodeJS.ProcessEnv,
): Promise<CmdOut> {
  // Whitespace-aware splitter; rejects shell metacharacters to keep us in
  // the no-shell-spawn regime that acceptance-runner uses.
  if (/[;&|<>`$]/.test(rawCmd)) {
    return Promise.reject(new Error(`unsafe shell metacharacter in test command: ${rawCmd}`));
  }
  const argv = rawCmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (argv.length === 0) return Promise.reject(new Error('empty test command'));
  const file = argv[0]!;
  const args = argv.slice(1).map(a => a.replace(/^["']|["']$/g, ''));

  return new Promise<CmdOut>((resolve, reject) => {
    const child: import('child_process').ChildProcess = spawn(file, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (killed) return reject(new Error(`test command timed out after ${timeoutMs}ms`));
      // Exit code can be non-zero (failing tests) — still resolve, the
      // validator joins by status from reporter JSON.
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

// ─── Codemod / audit (CHG-005 Task 7) ────────────────────────────────

export interface AuditSuggestion {
  kind: 'unbound_ac' | 'unannotated_test' | 'unknown_binding';
  message: string;
  hint?: string;
  /** File:line reference when applicable (unannotated_test, unknown_binding) */
  location?: string;
}

export interface AuditReport {
  story_id: string;
  declared_acs: AcceptanceCriterion[];
  found_bindings: TestBinding[];
  suggestions: AuditSuggestion[];
}

/**
 * Audit a story's AC coverage WITHOUT running tests.
 *
 * Scans test files for unannotated `it()` / `test()` calls in test files
 * adjacent to bound tests — those are likely candidates for an AC
 * annotation. The output is a list of human-readable suggestions; this
 * function does NOT mutate any file.
 *
 * Used by `wdf cr ac-check --report-only` to help projects migrate to
 * the strict gate before flipping `contract_strict_mode = true`.
 */
export function auditAcCoverage(opts: {
  storyPath: string;
  testRoots: string[];
  projectRoot: string;
}): AuditReport {
  if (!existsSync(opts.storyPath)) {
    throw new Error(`story file not found: ${opts.storyPath}`);
  }
  const storyContent = readFileSync(opts.storyPath, 'utf8');
  const acs = parseAcsFromStory(storyContent);
  const storyId = deriveStoryId(opts.storyPath, storyContent);

  const bindings = scanTestsForAcBindings({
    roots: opts.testRoots,
    projectRoot: opts.projectRoot,
  });

  const acIds = new Set(acs.map(a => a.id));
  const boundLocations = new Set(bindings.map(b => `${b.file}:${b.line}`));
  const filesWithBindings = new Set(bindings.map(b => b.file));

  const suggestions: AuditSuggestion[] = [];

  // 1. Unbound ACs
  for (const ac of acs) {
    if (!bindings.some(b => b.ac_id === ac.id)) {
      suggestions.push({
        kind: 'unbound_ac',
        message: `${ac.id} has no bound test${ac.description ? ` — "${ac.description}"` : ''}`,
        hint: `Add a test named "${ac.id}: ..." or annotate an existing one with "// @ac ${ac.id}".`,
      });
    }
  }

  // 2. Unknown bindings (test refers to AC not on the story)
  for (const b of bindings) {
    if (!acIds.has(b.ac_id)) {
      suggestions.push({
        kind: 'unknown_binding',
        message: `${b.ac_id} bound at ${b.file}:${b.line} but not declared on story`,
        hint: `Either add ${b.ac_id} to the story's acceptance_criteria, or rename the binding to match a declared AC.`,
        location: `${b.file}:${b.line}`,
      });
    }
  }

  // 3. Unannotated tests in files that already have bindings — likely
  //    candidates for missing annotations.
  for (const file of filesWithBindings) {
    const abs = opts.testRoots
      .map(r => join(r, relative(opts.projectRoot, abs0(file, opts.projectRoot))))
      .find(p => existsSync(p)) ?? abs0(file, opts.projectRoot);
    let content: string;
    try { content = readFileSync(abs, 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const tm = lines[i].match(TEST_CALL_RE);
      if (!tm) continue;
      const testName = tm[2];
      // Already AC-prefixed?
      if (/^AC-\d+:/.test(testName)) continue;
      // Already bound at this line?
      if (boundLocations.has(`${file}:${i + 1}`)) continue;
      // Skip describe / utility helpers
      if (lines[i].match(/\bdescribe\s*\(/)) continue;
      suggestions.push({
        kind: 'unannotated_test',
        message: `Unannotated test "${testName}" in a file with AC bindings — add "// @ac AC-N" if it covers an AC.`,
        location: `${file}:${i + 1}`,
      });
    }
  }

  return {
    story_id: storyId,
    declared_acs: acs,
    found_bindings: bindings,
    suggestions,
  };
}

function abs0(rel: string, root: string): string {
  return rel.startsWith('/') ? rel : join(root, rel);
}

export function formatAuditReport(r: AuditReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════');
  lines.push(`AC Coverage Audit — ${r.story_id}`);
  lines.push('═══════════════════════════════════════════');
  lines.push(`  Declared ACs: ${r.declared_acs.length}`);
  lines.push(`  Bindings:     ${r.found_bindings.length}`);
  lines.push(`  Suggestions:  ${r.suggestions.length}`);
  lines.push('');
  if (r.suggestions.length === 0) {
    lines.push('  ✓ No issues found.');
  } else {
    for (const s of r.suggestions) {
      const tag = { unbound_ac: 'UNBOUND', unannotated_test: 'HINT', unknown_binding: 'UNKNOWN' }[s.kind];
      lines.push(`  • [${tag}] ${s.message}`);
      if (s.location) lines.push(`      at ${s.location}`);
      if (s.hint) lines.push(`      → ${s.hint}`);
    }
  }
  lines.push('═══════════════════════════════════════════');
  return lines.join('\n');
}
