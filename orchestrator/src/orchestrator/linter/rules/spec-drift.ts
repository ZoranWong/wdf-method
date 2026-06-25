import { LintRule, LintContext, LintResult } from '../types.js';
import { checkSpecDrift } from '../../spec-drift-checker.js';

/**
 * SPEC_DRIFT — the spec and the code must not diverge.
 *
 * Wraps `checkSpecDrift()` (Phase D, V3.10.4) as a lint rule so drift is
 * surfaced at `wdf lint` / CI / pre-merge time, not only as a one-shot
 * baseline at brownfield `import`. Without this rule, an endpoint added to
 * the code after import (or a story AC that loses its test) drifts silently
 * and never trips a gate.
 *
 * Drift kinds map to results 1:1:
 *   - orphan_endpoint  → spec declares an endpoint the code doesn't implement
 *   - unspec_endpoint  → code exposes a route the spec never declared
 *   - missing_test     → a story AC has no test binding
 *
 * Defaults to warning so existing projects aren't broken on first upgrade
 * (and pre-spec greenfield projects, where the code legitimately leads the
 * spec, aren't spammed). Strict mode promotes to error — the right setting
 * for a pre-merge gate where "unspec'd endpoints never land on main".
 */
export const SpecDriftRule: LintRule = {
  id: 'SPEC_DRIFT',
  level: 'warning',
  description: 'Spec and code must not drift (orphan/unspec endpoints, missing AC tests)',

  check(context: LintContext): LintResult[] {
    const report = checkSpecDrift(context.projectRoot);
    if (report.ok || report.drift.length === 0) return [];

    return report.drift.map(item => ({
      ruleId: 'SPEC_DRIFT',
      level: 'warning' as const,
      file: item.source,
      message: `[${item.kind}] ${item.identifier}: ${item.message}`,
    }));
  },
};
