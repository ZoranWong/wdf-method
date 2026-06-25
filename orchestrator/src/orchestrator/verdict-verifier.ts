/**
 * Verdict Verifier — closes the Phase 4 "trust gap".
 *
 * The per-story pipeline (pipeline-runner.ts) decides PASS/FAIL purely from
 * the JSON report an agent writes to disk. A lazy or hallucinating agent can
 * therefore self-certify: write `verdict: "PASS"` without the acceptance
 * checks actually passing, and the story sails through testing → qa → MERGED.
 *
 * This module runs BEFORE the synchronous dispatch evaluator on every
 * `wdf loop` tick. For any story sitting at the `testing` or `qa` stage with
 * an agent-reported PASS that the CLI has not yet confirmed, it independently
 * re-runs the story's `acceptance_check` commands via the sandboxed
 * acceptance-runner (the same executor `wdf accept` uses). If the commands do
 * not actually pass, it rewrites the on-disk report's verdict to FAIL — so the
 * existing report-driven FSM naturally routes the story back to dev for a fix
 * iteration. No change to the synchronous pipeline core is required; we only
 * make the report it reads trustworthy.
 *
 * Design notes / honest limits:
 *   - The CLI verifies EXIT CODES objectively. Coverage thresholds (e.g.
 *     ">= 80%") are NOT re-derived here — parsing coverage from arbitrary tool
 *     output is unreliable. Coverage remains the agent's responsibility; the
 *     CLI cross-checks that the acceptance commands themselves exit 0.
 *   - A story with no `acceptance_check` has no objective signal to contradict
 *     the agent, so its PASS is stamped (not overridden) with a warning.
 *   - Each report is stamped `cli_verified` so we don't re-run the same checks
 *     every tick. A fresh agent dispatch overwrites the report (dropping the
 *     stamp), which re-arms verification for the next attempt.
 */

import { readFileSync, writeFileSync } from 'fs';
import { SprintStatusManager } from './sprint-status.js';
import { runAcceptanceChecks } from './acceptance-runner.js';
import {
  readTestReport,
  readQaReport,
  testReportPath,
  qaReportPath,
} from './pipeline-engine.js';
import { appendAudit } from './audit-logger.js';
import { resolveStoryCwd } from './story-cwd.js';
import type { StoryEntry } from './types.js';

/** Per-command timeout for re-verification (mirrors `wdf accept`). */
const VERIFY_TIMEOUT_MS = 120_000;

export interface VerdictVerification {
  story_id: string;
  stage: 'testing' | 'qa';
  /** What the agent claimed (always 'PASS' — we only re-check claimed passes). */
  agent_verdict: 'PASS';
  /** True if the CLI re-run agreed (all checks exit 0, or no checks to run). */
  cli_passed: boolean;
  /** True if the CLI rewrote the report verdict PASS → FAIL. */
  overridden: boolean;
  /** True when the story declares no acceptance_check (cannot disprove PASS). */
  no_checks: boolean;
  /** Failing commands when overridden. */
  failures: { command: string; exit_code: number; error?: string }[];
}

function subKeyForTrack(track: string): string {
  return track === 'frontend' ? 'phase_4_10' : 'phase_4_4';
}

/**
 * Re-verify every pending PASS verdict and rewrite disagreements to FAIL.
 *
 * Returns one entry per story that was actually checked this tick (skipped
 * stories — wrong stage, no fresh PASS report, already cli_verified — produce
 * no entry). Non-fatal throughout: a failure on one story is swallowed so the
 * dispatch loop keeps running.
 */
export async function verifyPendingVerdicts(
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
): Promise<VerdictVerification[]> {
  const results: VerdictVerification[] = [];
  const devOrder: StoryEntry[] = state.data.global_state.development_order ?? [];

  for (const story of devOrder) {
    try {
      const verification = await verifyOneStory(story, state, outputDir, projectRoot);
      if (verification) results.push(verification);
    } catch {
      // Verification of one story must never break the loop.
    }
  }

  return results;
}

async function verifyOneStory(
  story: StoryEntry,
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
): Promise<VerdictVerification | null> {
  const subKey = subKeyForTrack(story.track);
  const stored = state.getStories(4, subKey).find(s => s.id === story.story_id);
  const stage = stored?.pipeline?.stage;

  // Only re-verify the stages whose verdict the FSM is about to trust. The
  // verifier runs BEFORE the FSM advances, so when stage === 'testing' the
  // testing report has not yet been consumed; same for 'qa'. The explicit
  // comparison (vs a Set.has) also narrows `stage` to the literal union.
  if (stage !== 'testing' && stage !== 'qa') return null;

  const reportPath = stage === 'testing'
    ? testReportPath(story.story_id, outputDir)
    : qaReportPath(story.story_id, outputDir);
  const report = stage === 'testing'
    ? readTestReport(story.story_id, outputDir)
    : readQaReport(story.story_id, outputDir);

  // No report yet, or the agent already reported FAIL → nothing to second-guess.
  if (!report || report.verdict !== 'PASS') return null;
  // Already confirmed/overridden this exact report → don't re-run.
  if (report.cli_verified === true) return null;

  // No acceptance_check means no objective signal. We cannot disprove the
  // agent's PASS, so we stamp (not override) and flag it for the audit trail.
  if (!story.acceptance_check || story.acceptance_check.length === 0) {
    stampVerified(report, reportPath, { cli_passed: true, no_checks: true });
    appendAudit(projectRoot, 'verdict_verification', {
      actor: 'system',
      story_id: story.story_id,
      status: 'info',
      message: `Stage "${stage}" PASS accepted without CLI re-run — story declares no acceptance_check`,
      details: { stage, no_checks: true },
    });
    return {
      story_id: story.story_id,
      stage,
      agent_verdict: 'PASS',
      cli_passed: true,
      overridden: false,
      no_checks: true,
      failures: [],
    };
  }

  // Independently run the acceptance checks in the story's working directory.
  const cwd = resolveStoryCwd(story, projectRoot);
  const cliReport = await runAcceptanceChecks(story.acceptance_check, {
    cwd,
    timeout_ms: VERIFY_TIMEOUT_MS,
  });

  if (cliReport.all_passed) {
    stampVerified(report, reportPath, { cli_passed: true, no_checks: false });
    appendAudit(projectRoot, 'verdict_verification', {
      actor: 'system',
      story_id: story.story_id,
      status: 'pass',
      message: `CLI confirmed stage "${stage}" PASS — ${cliReport.results.length} acceptance check(s) passed`,
      details: { stage, checks: cliReport.results.length, duration_ms: cliReport.total_duration_ms },
    });
    return {
      story_id: story.story_id,
      stage,
      agent_verdict: 'PASS',
      cli_passed: true,
      overridden: false,
      no_checks: false,
      failures: [],
    };
  }

  // Disagreement: agent said PASS, CLI says FAIL. Rewrite the report so the
  // FSM routes this story back to dev with actionable feedback.
  const failures = cliReport.results
    .filter(r => !r.passed)
    .map(r => ({ command: r.command, exit_code: r.exit_code, error: r.error }));

  overrideToFail(report, reportPath, stage, failures, cliReport.results.length);

  appendAudit(projectRoot, 'verdict_verification', {
    actor: 'system',
    story_id: story.story_id,
    status: 'fail',
    message: `CLI OVERRODE agent PASS → FAIL at stage "${stage}": ${failures.length}/${cliReport.results.length} acceptance check(s) failed on re-run`,
    details: {
      stage,
      cli_override: true,
      failed: failures.length,
      total: cliReport.results.length,
      failures: failures.map(f => `${f.command} (exit ${f.exit_code})`),
    },
  });

  return {
    story_id: story.story_id,
    stage,
    agent_verdict: 'PASS',
    cli_passed: false,
    overridden: true,
    no_checks: false,
    failures,
  };
}

/** Stamp a report as CLI-confirmed without changing its verdict. */
function stampVerified(
  report: Record<string, any>,
  reportPath: string,
  opts: { cli_passed: boolean; no_checks: boolean },
): void {
  report.cli_verified = true;
  report.cli_verified_at = new Date().toISOString();
  report.cli_passed = opts.cli_passed;
  if (opts.no_checks) report.cli_no_checks = true;
  writeReport(reportPath, report);
}

/**
 * Rewrite a report's verdict to FAIL and populate the fields the FSM's FAIL
 * branch + feedback formatters consume (test.failed/failures, qa.summary), so
 * the dev agent receives concrete, CLI-sourced feedback on the next dispatch.
 */
function overrideToFail(
  report: Record<string, any>,
  reportPath: string,
  stage: 'testing' | 'qa',
  failures: { command: string; exit_code: number; error?: string }[],
  total: number,
): void {
  report.verdict = 'FAIL';
  report.cli_verified = true;
  report.cli_verified_at = new Date().toISOString();
  report.cli_passed = false;
  report.cli_override = true;

  const failureLines = failures.map(f => ({
    test: f.command,
    command: f.command,
    error: f.error ?? `exit ${f.exit_code}`,
  }));

  if (stage === 'testing') {
    report.failed = failures.length;
    report.passed = Math.max(0, total - failures.length);
    report.failures = failureLines;
  } else {
    report.summary = `CLI re-run of acceptance checks failed: ${failures.length}/${total} command(s) did not pass`;
    report.ac_checks = failureLines;
  }

  writeReport(reportPath, report);
}

function writeReport(reportPath: string, report: unknown): void {
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

/**
 * Re-read a report file from disk (used by callers that need the post-write
 * state). Exposed mainly for tests. Returns null on missing/corrupt file.
 */
export function reReadReport(reportPath: string): any | null {
  try {
    return JSON.parse(readFileSync(reportPath, 'utf-8'));
  } catch {
    return null;
  }
}
