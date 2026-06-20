import { LintRule, LintContext, LintResult } from '../types.js';

/**
 * NO_DEPRECATED_TERMS - Check for outdated terminology
 *
 * Old terms from pre-3.6 should not appear in new code.
 */
export const NoDeprecatedTermsRule: LintRule = {
  id: 'NO_DEPRECATED_TERMS',
  level: 'warning',
  description: 'Deprecated terms should not appear in new code',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];

    const deprecated = [
      {
        term: 'Pure Orchestrator',
        pattern: /Pure Orchestrator/i,
        replacement: 'thin orchestrator',
        since: '3.6.0'
      },
      {
        term: 'sprint_tracking',
        pattern: /sprint_tracking/,
        replacement: 'status directory',
        since: '3.6.0'
      },
      {
        term: 'single-file status',
        pattern: /single-file status/i,
        replacement: 'split-file status',
        since: '3.6.0'
      }
    ];

    for (const file of context.files) {
      // Skip files whose job is to document old terms:
      //   - CHANGELOG / HISTORY files (record of past state)
      //   - variables.md (reference doc — must enumerate every variable,
      //     including deprecated ones, and explain how to migrate)
      // Without this exemption the linter would force reference docs to
      // pretend the deprecated API never existed, which breaks the migration
      // story for users still on v3.5.
      if (/CHANGELOG|HISTORY|changelog/.test(file.path)) continue;
      if (/references\/variables\.md$/.test(file.path)) continue;

      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];

        // Per-line opt-out: a trailing `<!-- lint-ignore-deprecated -->`
        // comment lets docs quote a deprecated term in context (e.g. inside
        // an example block) without disabling the rule for the whole file.
        if (/lint-ignore-deprecated/.test(line)) continue;

        for (const dep of deprecated) {
          if (dep.pattern.test(line)) {
            results.push({
              ruleId: 'NO_DEPRECATED_TERMS',
              level: 'warning',
              file: file.path,
              line: i + 1,
              message: `Deprecated term "${dep.term}" (since v${dep.since}) — use "${dep.replacement}" instead`
            });
          }
        }
      }
    }

    return results;
  }
};
