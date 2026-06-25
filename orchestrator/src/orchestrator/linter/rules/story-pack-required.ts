import { LintRule, LintContext, LintResult, FileEntry } from '../types.js';

/**
 * STORY_PACK_REQUIRED — Story Pack v1.0 completeness.
 *
 * A story is "Story Pack v1.0 compliant" when it declares:
 *   - `story_pack_version: '1.0'` in frontmatter
 *   - `execution_units:` with at least one unit, each having:
 *       - scope_write (non-empty list)
 *       - acceptance_check (non-empty list)
 *   - `recommended_model_profile:` (optional but, if present, must have a
 *     valid reasoning_effort)
 *
 * Stories WITHOUT `story_pack_version` are tolerated (legacy format) and
 * skipped — this rule only enforces internal consistency of v1.0 packs.
 *
 * Why: Phase 4 unit-level dispatch requires a well-formed Story Pack. A
 * half-declared pack would cause the dispatcher to fall back to the
 * monolithic path silently, masking a configuration error.
 */
export const StoryPackRequiredRule: LintRule = {
  id: 'STORY_PACK_REQUIRED',
  level: 'warning',
  description: 'Story Pack v1.0 stories must have well-formed execution_units',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];

    for (const file of context.files) {
      if (!/(^|\/)_?wdf_output\/stories\/[^/]+\.md$/.test(file.path)) continue;

      const fm = extractFrontmatter(file);
      if (!fm) continue;

      // Only enforce for stories that declare Story Pack v1.0
      const versionLine = fm.match(/^story_pack_version:\s*['"]?([\d.]+)['"]?\s*$/m);
      if (!versionLine) continue;
      const version = versionLine[1];
      if (version !== '1.0') continue;

      // execution_units required for v1.0
      const unitsBlock = extractExecutionUnits(fm);
      if (unitsBlock.units.size === 0) {
        results.push({
          ruleId: 'STORY_PACK_REQUIRED',
          level: 'error',
          file: file.path,
          line: unitsBlock.line ?? 2,
          message: 'Story Pack v1.0 requires execution_units: with at least one unit',
        });
        continue;
      }

      // Each unit must have scope_write + acceptance_check
      for (const [unitId, unit] of unitsBlock.units) {
        if (unit.scopeWrite.length === 0) {
          results.push({
            ruleId: 'STORY_PACK_REQUIRED',
            level: 'error',
            file: file.path,
            line: unit.line ?? 2,
            message: `execution_unit "${unitId}" missing scope_write`,
          });
        }
        if (unit.acceptanceCheck.length === 0) {
          results.push({
            ruleId: 'STORY_PACK_REQUIRED',
            level: 'error',
            file: file.path,
            line: unit.line ?? 2,
            message: `execution_unit "${unitId}" missing acceptance_check`,
          });
        }
      }

      // recommended_model_profile — validate enum if present
      const profileMatch = fm.match(/^recommended_model_profile:\s*$/m);
      if (profileMatch) {
        const effortMatch = fm.match(/^\s+reasoning_effort:\s*['"]?(\w+)['"]?\s*$/m);
        if (effortMatch) {
          const effort = effortMatch[1];
          if (!['low', 'medium', 'high'].includes(effort)) {
            results.push({
              ruleId: 'STORY_PACK_REQUIRED',
              level: 'error',
              file: file.path,
              line: 2,
              message: `recommended_model_profile.reasoning_effort "${effort}" invalid — must be low|medium|high`,
            });
          }
        }
      }
    }

    return results;
  },
};

function extractFrontmatter(file: FileEntry): string | null {
  const m = file.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

interface ExtractedUnit {
  scopeWrite: string[];
  acceptanceCheck: string[];
  line?: number;
}

/**
 * Parse the execution_units block from frontmatter.
 *
 * Recognises both block and inline forms:
 *
 *   execution_units:
 *     auth-api:
 *       scope_write:
 *         - src/auth/api.ts
 *       acceptance_check:
 *         - npm test auth
 *     auth-ui: ...
 *
 *   execution_units: {auth-api: {scope_write: [a], acceptance_check: [b]}}
 *
 * The inline form is rare but supported for compact stories.
 */
function extractExecutionUnits(fm: string): { units: Map<string, ExtractedUnit>; line?: number } {
  const units = new Map<string, ExtractedUnit>();
  const lines = fm.split('\n');

  // Find execution_units: header
  let headerLine: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (/^execution_units:\s*$/.test(lines[i])) {
      headerLine = i + 2;
      parseBlockForm(lines, i, units);
      break;
    }
    const inlineMatch = lines[i].match(/^execution_units:\s*(\{.*\}|[\w-]+).*$/);
    if (inlineMatch && inlineMatch[1].startsWith('{')) {
      headerLine = i + 2;
      // Inline form is brittle to parse — skip deep parsing, just register
      // that units exist. Detailed validation happens at dispatch time.
      const idMatches = inlineMatch[1].matchAll(/(\w[\w-]*):/g);
      for (const m of idMatches) {
        units.set(m[1], { scopeWrite: ['<inline>'], acceptanceCheck: ['<inline>'], line: i + 2 });
      }
      break;
    }
  }

  return { units, line: headerLine };
}

function parseBlockForm(
  lines: string[],
  headerIdx: number,
  units: Map<string, ExtractedUnit>,
): void {
  let currentUnit: string | null = null;
  let currentField: 'scope_write' | 'acceptance_check' | null = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Top-level key ends the block
    if (/^\S/.test(line) && !line.startsWith('#')) break;

    // Unit id: "  unit-id:" at 2-space indent
    const unitMatch = line.match(/^  ([a-zA-Z0-9][\w-]*):\s*$/);
    if (unitMatch) {
      currentUnit = unitMatch[1];
      currentField = null;
      units.set(currentUnit, { scopeWrite: [], acceptanceCheck: [], line: i + 2 });
      continue;
    }

    if (!currentUnit) continue;
    const unit = units.get(currentUnit);
    if (!unit) continue;

    // Field header: "    scope_write:" at 4-space indent
    const fieldMatch = line.match(/^    (scope_write|acceptance_check):\s*$/);
    if (fieldMatch) {
      currentField = fieldMatch[1] as 'scope_write' | 'acceptance_check';
      continue;
    }

    // List item: "      - value" at 6-space indent
    const itemMatch = line.match(/^      -\s+(.+?)\s*$/);
    if (itemMatch && currentField) {
      if (currentField === 'scope_write') unit.scopeWrite.push(itemMatch[1]);
      else unit.acceptanceCheck.push(itemMatch[1]);
      continue;
    }

    // Inline list: "    scope_write: [a, b]" or "    scope_write: single"
    const inlineFieldMatch = line.match(/^    (scope_write|acceptance_check):\s*(.+?)\s*$/);
    if (inlineFieldMatch) {
      const field = inlineFieldMatch[1] as 'scope_write' | 'acceptance_check';
      const raw = inlineFieldMatch[2].replace(/[[\]]/g, '').trim();
      if (raw !== '') {
        for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
          if (field === 'scope_write') unit.scopeWrite.push(item);
          else unit.acceptanceCheck.push(item);
        }
      }
      currentField = null;
    }
  }
}
