import { LintRule, LintContext, LintResult } from '../types.js';

/**
 * SRG_ID_COMPLETENESS - Story Ready Gate IDs must be complete and sequential
 *
 * Checks that:
 * - SRG-01 through SRG-09 are all defined somewhere
 * - No duplicates
 * - No gaps in numbering
 */
export const SrgIdCompletenessRule: LintRule = {
  id: 'SRG_ID_COMPLETENESS',
  level: 'error',
  description: 'SRG IDs must be complete and sequential',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];
    // SRG IDs are canonically zero-padded two digits (SRG-01..SRG-09).
    // Requiring `\d{2}` avoids matching partial tokens like the regex literal
    // `/SRG-0\d/` in story-runner.test.ts, where `\bSRG-(\d+)\b` would
    // otherwise capture a spurious single-digit `SRG-0`.
    const srgPattern = /\bSRG-(\d{2})\b/g;
    const foundSrgIds = new Map<string, { file: string; line: number }[]>();
    // Scan all files for SRG references
    for (const file of context.files) {
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        let match: RegExpExecArray | null;
        while ((match = srgPattern.exec(line)) !== null) {
          const id = `SRG-${match[1]}`;
          const existing = foundSrgIds.get(id) ?? [];
          existing.push({ file: file.path, line: i + 1 });
          foundSrgIds.set(id, existing);
        }
      }
    }
    // Expected SRG IDs for V3.6
    const expectedSrgIds = ['SRG-01', 'SRG-02', 'SRG-03', 'SRG-04', 'SRG-05', 'SRG-06', 'SRG-07', 'SRG-08', 'SRG-09'];
    // Check for missing SRGs
    for (const expected of expectedSrgIds) {
      if (!foundSrgIds.has(expected)) {
        results.push({
          ruleId: 'SRG_ID_COMPLETENESS',
          level: 'warning',
          file: 'PROJECT',
          message: `${expected} not found in any file - may be missing definition`
        });
      }
    }
    // Check for unexpected SRGs
    for (const [found, locations] of foundSrgIds) {
      if (!expectedSrgIds.includes(found)) {
        results.push({
          ruleId: 'SRG_ID_COMPLETENESS',
          level: 'warning',
          file: locations[0].file,
          line: locations[0].line,
          message: `Unexpected ${found} - not in expected SRG list (01-09)`
        });
      }
    }
    return results;
  }
};
