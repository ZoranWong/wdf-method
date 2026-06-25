/**
 * semantic-consistency.ts — cross-artifact "meaning" checks.
 *
 * `wdf check` (artifact-checker.ts) validates each artifact's FORM in
 * isolation: does the PRD have REQ entries, does a story have a scope, does
 * api-spec.yaml parse. What it cannot see — because it reads one file at a
 * time — is whether the artifacts AGREE with each other:
 *
 *   - REQ_COVERAGE        every PRD REQ is covered by ≥1 story
 *   - API_SCOPE_MAPPING   every api-spec endpoint is claimed by some story
 *   - DB_API_CONSISTENCY  every entity an endpoint references exists in the schema
 *   - AC_TEST_BINDING     every story acceptance criterion is bound to a TEST
 *
 * These four already exist as traceability-graph-backed lint rules. This
 * module is the single place that runs them and adapts their results so two
 * callers can share one implementation:
 *
 *   - `wdf check` (step 3) renders them as ADVISORY warnings — surfaced early
 *     in Phase 1-3 so authors fix gaps before implementation, without
 *     hard-blocking.
 *   - the Phase 3.9 → Phase 4 entry gate (step 2) treats any finding as a
 *     BLOCKING gap.
 *
 * The rules read the traceability graph straight from disk (projectRoot), so
 * the LintContext only needs `projectRoot`; `files`/`config` are unused by
 * these four and passed empty.
 */

import { ReqCoverageRule } from './linter/rules/req-coverage.js';
import { ApiScopeMappingRule } from './linter/rules/api-scope-mapping.js';
import { DbApiConsistencyRule } from './linter/rules/db-api-consistency.js';
import { AcTestBindingRule } from './linter/rules/ac-test-binding.js';
import type { LintRule, LintResult } from './linter/types.js';
import type { CheckResult, CheckIssue } from './artifact-checker.js';

/** The four cross-artifact semantic rules, in reporting order. */
const SEMANTIC_RULES: LintRule[] = [
  ReqCoverageRule,
  ApiScopeMappingRule,
  DbApiConsistencyRule,
  AcTestBindingRule,
];

/**
 * Rules whose signal depends on TEST nodes existing. These cannot run at the
 * Phase 4 ENTRY boundary: tests are authored DURING implementation (dev →
 * testing), so before Phase 4 starts every AC is trivially "unbound" and the
 * rule would block entry unconditionally. The Phase 4 entry gate excludes
 * them; `wdf check` and post-implementation gates keep them.
 */
const TEST_DEPENDENT_RULE_IDS = new Set<string>(['AC_TEST_BINDING']);

export interface RunSemanticRulesOptions {
  /** Skip rules that require TEST nodes (for pre-implementation gates). */
  excludeTestDependent?: boolean;
}

export interface SemanticFinding {
  ruleId: string;
  /** The rule's declared level (always 'warning' for the current four). */
  level: 'error' | 'warning';
  file: string;
  line?: number;
  message: string;
}

/**
 * Run every semantic rule against the project and flatten the results.
 *
 * Synchronous: all four rules resolve their data from the on-disk
 * traceability graph and return arrays directly. A rule that throws is
 * swallowed and reported as a single SYSTEM-level finding so one broken rule
 * never hides the others.
 */
export function runSemanticRules(
  projectRoot: string,
  opts: RunSemanticRulesOptions = {},
): SemanticFinding[] {
  const findings: SemanticFinding[] = [];
  const rules = opts.excludeTestDependent
    ? SEMANTIC_RULES.filter(r => !TEST_DEPENDENT_RULE_IDS.has(r.id))
    : SEMANTIC_RULES;
  for (const rule of rules) {
    try {
      const raw = rule.check({ projectRoot, files: [], config: null }) as LintResult[];
      for (const r of raw) {
        findings.push({
          ruleId: rule.id,
          level: rule.level,
          file: r.file,
          line: r.line,
          message: r.message,
        });
      }
    } catch (err) {
      findings.push({
        ruleId: rule.id,
        level: 'error',
        file: 'SYSTEM',
        message: `Semantic rule ${rule.id} failed to run: ${(err as Error).message}`,
      });
    }
  }
  return findings;
}

/**
 * Adapt semantic findings into a single `wdf check` CheckResult.
 *
 * `blocking` controls severity escalation: in advisory mode (default) the
 * findings keep their warning level, so `wdf check` surfaces them without a
 * non-zero exit. The Phase 4 entry gate calls with `blocking: true`, which
 * promotes every finding to `error` so `passed` becomes false.
 */
export function semanticFindingsToCheckResult(
  findings: SemanticFinding[],
  opts: { blocking?: boolean } = {},
): CheckResult {
  const issues: CheckIssue[] = findings.map(f => ({
    severity: opts.blocking ? 'error' : f.level,
    file: f.file,
    rule: f.ruleId,
    message: f.message,
    expected: 'Artifacts agree across the traceability graph (REQ↔story↔API↔DB↔test)',
    actual: f.message,
  }));
  return {
    artifact: 'semantic-consistency',
    passed: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    checkedAt: new Date().toISOString(),
    standards: SEMANTIC_RULES.map(r => r.id),
  };
}

/**
 * Convenience for `wdf check`: run the rules and return an advisory
 * CheckResult ready to append to the artifact report.
 */
export function runSemanticConsistency(projectRoot: string): CheckResult {
  return semanticFindingsToCheckResult(runSemanticRules(projectRoot), { blocking: false });
}
