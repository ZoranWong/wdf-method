import { existsSync } from 'fs';
import { resolve } from 'path';

// CHG-2026-005 — re-export the AC ↔ Test binding validator so callers can
// import everything contract-related from this single entrypoint.
export {
  parseAcsFromStory,
  scanTestsForAcBindings,
  parseVitestJson,
  parseJestJson,
  validateAcBindings,
  formatAcBindingReport,
  runAcBindingCheck,
  auditAcCoverage,
  formatAuditReport,
} from './ac-test-binding.js';
export type {
  AcceptanceCriterion,
  TestBinding,
  TestRunResult,
  TestStatus,
  BindingKind,
  AcBindingReport,
  ScanOptions,
  ValidateAcBindingsArgs,
  TestFramework,
  RunAcBindingCheckOptions,
  RunAcBindingCheckResult,
  AuditSuggestion,
  AuditReport,
} from './ac-test-binding.js';

/**
 * Story Contract Freeze Gate — validates 7 contract fields before a story can enter Phase 4.
 * Blocked stories cannot enter implementation until all fields are compliant.
 *
 * V3.1 requirement: Stories with non-compliant contracts are BLOCKED at Phase 3.7.
 */

export interface StoryContract {
  story_id: string;
  title: string;
  scope_write: string[];
  out_of_scope?: string[];
  acceptance_checks: string[];
  code_standards_source: string[];
  dependencies?: { story_id: string; track: string }[];
  parallel_safe: boolean;
  ui_truth_source?: string; // Frontend stories only
  execution_units?: Record<string, any>;
}

export interface ContractValidationResult {
  story_id: string;
  passed: boolean;
  checks: {
    field: string;
    status: 'pass' | 'fail';
    reason?: string;
  }[];
  missing_fields: string[];
}

// Patterns that indicate placeholder/invalid acceptance checks
const PLACEHOLDER_PATTERNS = [
  /^todo$/i, /^tbd$/i, /^待定$/, /^待实现$/,
  /^placeholder/i, /^通过测试$/, /^验证.*正常$/,
  /^测试通过$/, /^无$/, /^none$/i,
  /^npm test$/i, /^yarn test$/i, // Too generic — needs to be specific
];

function isPlaceholderCheck(check: string): boolean {
  const trimmed = check.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

function isExecutableCheck(check: string): boolean {
  if (isPlaceholderCheck(check)) return false;
  // Must start with a known command or format
  const executablePattern = /^(npm|npx|yarn|pnpm|node|python|make|go|cargo|curl|httpie|jest|mocha|vitest|ava|playwright|cypress|axe|lighthouse|tsc|eslint|prettier|docker|kubectl|\.\/|\.\.\/)/;
  return executablePattern.test(check.trim());
}

export class StoryContractValidator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Validate a single story's contract against all 7 required fields.
   */
  validate(story: StoryContract): ContractValidationResult {
    const checks: ContractValidationResult['checks'] = [];
    const missing: string[] = [];

    // 1. scope_write — must be non-empty, paths must have parent dirs
    if (!story.scope_write || story.scope_write.length === 0) {
      checks.push({ field: 'scope_write', status: 'fail', reason: 'scope_write is empty or undefined' });
      missing.push('scope_write');
    } else {
      const missingDirs = story.scope_write.filter(p => {
        const full = resolve(this.projectRoot, p);
        const parent = resolve(full, '..');
        return !existsSync(parent);
      });
      if (missingDirs.length > 0) {
        checks.push({ field: 'scope_write', status: 'fail', reason: `Parent directories of [${missingDirs.join(', ')}] do not exist` });
        missing.push('scope_write (invalid paths)');
      } else {
        checks.push({ field: 'scope_write', status: 'pass' });
      }
    }

    // 2. out_of_scope — must be explicitly defined (V3.1)
    if (!story.out_of_scope || story.out_of_scope.length === 0) {
      checks.push({ field: 'out_of_scope', status: 'fail', reason: 'out_of_scope must explicitly define what is NOT included in this story' });
      missing.push('out_of_scope');
    } else {
      checks.push({ field: 'out_of_scope', status: 'pass' });
    }

    // 3. acceptance_checks — must be executable, no placeholders
    if (!story.acceptance_checks || story.acceptance_checks.length === 0) {
      checks.push({ field: 'acceptance_checks', status: 'fail', reason: 'acceptance_checks is empty' });
      missing.push('acceptance_checks');
    } else {
      const placeholders = story.acceptance_checks.filter(c => isPlaceholderCheck(c));
      const nonExecutable = story.acceptance_checks.filter(c => !isPlaceholderCheck(c) && !isExecutableCheck(c));
      if (placeholders.length > 0) {
        checks.push({
          field: 'acceptance_checks',
          status: 'fail',
          reason: `Found placeholder checks: [${placeholders.join(', ')}]. All checks must be executable commands referencing real scripts or known binaries.`,
        });
        missing.push(`acceptance_checks (${placeholders.length} placeholders)`);
      } else if (nonExecutable.length > 0) {
        checks.push({
          field: 'acceptance_checks',
          status: 'fail',
          reason: `Not executable: [${nonExecutable.join(', ')}]. Must start with npm|npx|yarn|node|python|make|go|cargo|docker|curl|tsc|eslint|lighthouse|axe|playwright|jest`,
        });
        missing.push(`acceptance_checks (${nonExecutable.length} not executable)`);
      } else {
        checks.push({ field: 'acceptance_checks', status: 'pass' });
      }
    }

    // 4. code_standards_source — must be non-empty
    if (!story.code_standards_source || story.code_standards_source.length === 0) {
      checks.push({ field: 'code_standards_source', status: 'fail', reason: 'code_standards_source is empty. Must reference at minimum AGENTS.md or equivalent standards file.' });
      missing.push('code_standards_source');
    } else {
      checks.push({ field: 'code_standards_source', status: 'pass' });
    }

    // 5. dependencies — must be explicit, valid references (if has deps)
    if (story.dependencies && story.dependencies.length > 0) {
      const invalid = story.dependencies.filter(d => !d.story_id || !d.track);
      if (invalid.length > 0) {
        checks.push({ field: 'dependencies', status: 'fail', reason: `Invalid dependency entries: ${JSON.stringify(invalid)}. Each dep must have story_id and track.` });
        missing.push('dependencies (invalid entries)');
      } else {
        checks.push({ field: 'dependencies', status: 'pass' });
      }
    } else {
      checks.push({ field: 'dependencies', status: 'pass' });
    }

    // 6. parallel_safe — must be boolean
    if (typeof story.parallel_safe !== 'boolean') {
      checks.push({ field: 'parallel_safe', status: 'fail', reason: 'parallel_safe must be explicitly set to true or false' });
      missing.push('parallel_safe');
    } else {
      checks.push({ field: 'parallel_safe', status: 'pass' });
    }

    // 7. UI truth source — frontend stories must reference wireframes/design-tokens
    // This is a best-effort check — we don't know the track at the contract level
    if (!story.ui_truth_source) {
      checks.push({
        field: 'ui_truth_source',
        status: 'fail',
        reason: 'UI truth source is required. Must reference wireframes.md, design-tokens.md, or a Figma URL for visual parity verification during Page Parity Gate (Phase 4.10).',
      });
      missing.push('ui_truth_source');
    } else {
      checks.push({ field: 'ui_truth_source', status: 'pass' });
    }

    const passed = missing.length === 0;

    return { story_id: story.story_id, passed, checks, missing_fields: missing };
  }

  /**
   * Validate all stories in development_order. Returns a report.
   */
  validateAll(stories: StoryContract[]): {
    all_pass: boolean;
    blocked_stories: string[];
    results: ContractValidationResult[];
  } {
    const results = stories.map(s => this.validate(s));
    const blocked = results.filter(r => !r.passed).map(r => r.story_id);
    return {
      all_pass: blocked.length === 0,
      blocked_stories: blocked,
      results,
    };
  }

  /**
   * Format validation report as readable text.
   */
  formatReport(results: ContractValidationResult[]): string {
    const lines = ['═══════════════════════════════════════════',
                   'Story Contract Freeze Gate — Validation Report',
                   '═══════════════════════════════════════════'];

    let passCount = 0;
    let failCount = 0;

    for (const result of results) {
      if (result.passed) {
        passCount++;
        lines.push(`  ✓ ${result.story_id} — PASS (7/7 fields)`);
      } else {
        failCount++;
        lines.push(`  ✗ ${result.story_id} — FAIL (${result.missing_fields.length} fields)`);
        for (const field of result.missing_fields) {
          const check = result.checks.find(c => c.field === field || c.field.startsWith(field.split(' ')[0]));
          if (check) {
            lines.push(`      ⊙ ${field}: ${check.reason}`);
          }
        }
      }
    }

    lines.push('───────────────────────────────────────────');
    lines.push(`  Total: ${results.length} | Pass: ${passCount} | Fail: ${failCount}`);
    lines.push(`  Status: ${failCount === 0 ? 'ALL PASS — Stories can enter Phase 4' : `${failCount} BLOCKED — Fix contracts before entering Phase 4`}`);
    lines.push('═══════════════════════════════════════════');

    return lines.join('\n');
  }
}
