import { readFileSync, promises as fs } from 'fs';
import { join, relative } from 'path';
import { LintOptions, LintReport, LintRule, LintContext, LintResult, FileEntry } from './types.js';

/**
 * Specification Linter Engine
 * Validates consistency across 53K lines of wdf-method documentation
 */
export class SpecLinter {
  private rules: Map<string, LintRule> = new Map();
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  registerRule(rule: LintRule): void {
    this.rules.set(rule.id, rule);
  }

  registerRules(rules: LintRule[]): void {
    rules.forEach(r => this.registerRule(r));
  }

  getRuleIds(): string[] {
    return Array.from(this.rules.keys());
  }

  /**
   * Main lint entry point
   */
  async lint(options: LintOptions = {}): Promise<LintReport> {
    const startTime = Date.now();
    // 1. Collect files
    const files = await this.collectFiles(options);
    // 2. Build context
    const context: LintContext = {
      projectRoot: this.projectRoot,
      files,
      config: null // TODO: load linter config
    };
    // 3. Apply rules
    let results: LintResult[] = [];
    const activeRules = this.getActiveRules(options);
    for (const rule of activeRules) {
      try {
        const ruleResults = await rule.check(context);
        results = results.concat(ruleResults.map(r => ({
          ...r,
          ruleId: rule.id,
          level: rule.level
        })));
      }
      catch (err) {
        results.push({
          ruleId: rule.id,
          level: 'error',
          file: 'SYSTEM',
          message: `Rule execution failed: ${(err as Error).message}`
        });
      }
    }
    // 4. Auto-fix if requested
    if (options.fix) {
      await this.applyFixes(results);
    }
    // 5. Strict mode: promote warnings to errors. The rule's own level is
    // preserved on the result (so the report still shows the original
    // severity), but `errors` reflects the strict-adjusted count. This
    // keeps CI exit codes honest without lying about which rule fired.
    if (options.strict) {
      for (const r of results) {
        if (r.level === 'warning') r.level = 'error';
      }
    }
    return {
      results,
      errors: results.filter(r => r.level === 'error').length,
      warnings: results.filter(r => r.level === 'warning').length,
      filesChecked: files.length,
      rulesApplied: activeRules.length,
      durationMs: Date.now() - startTime
    };
  }

  private getActiveRules(options: LintOptions): LintRule[] {
    let rules = Array.from(this.rules.values());
    if (options.onlyRules?.length) {
      rules = rules.filter(r => options.onlyRules!.includes(r.id));
    }
    if (options.skipRules?.length) {
      rules = rules.filter(r => !options.skipRules!.includes(r.id));
    }
    return rules;
  }

  private async collectFiles(options: LintOptions): Promise<FileEntry[]> {
    const include = options.include ?? ['**/*.md', '**/*.toml', '**/*.yaml', '**/*.yml', '**/*.ts', '**/*.json'];
    // Default exclude list — tuned to scan spec artefacts (stories, prd,
    // epics, api-spec, db-schema) while skipping transient state.
    //
    // The previous default `_*/**` was too aggressive: it also skipped
    // `_wdf_output/stories/*.md`, `_wdf_output/prd.md` etc., which meant
    // STORY_REFS_REQUIRED / STORY_REFS_RESOLVE never actually ran against
    // real projects. We now enumerate the transient subdirs instead.
    //
    // Patterns use `**/<dir>/**` so they match nested cases like
    // `examples/todo-app/backend/node_modules/...` — plain `node_modules/**`
    // would only catch top-level node_modules.
    const exclude = options.exclude ?? [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/_wdf_output/.dispatch/**',
      '**/_wdf_output/.prompts/**',
      '**/_wdf_output/status/**',
      '**/_wdf_output/audit/**',
      '**/_wdf_output/backup/**',
      '**/_wdf_output/signals/**',
      '**/_wdf_output/test-reports/**',
      '**/_wdf_output/qa/**',
      '**/_wdf_output/review/**',
      '**/_wdf_output/party/**',
      '**/_wdf_output/_output/**',
      '**/.wdf-story-workspaces/**',
      '**/.claude/**',
      '**/.DS_Store',
    ];
    const entries: FileEntry[] = [];
    // Simple recursive walk (no glob dependency)
    const walk = async (dir: string): Promise<void> => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = join(dir, item.name);
        const relPath = relative(this.projectRoot, fullPath);
        // Check exclude
        if (this.matchesPatterns(relPath, exclude)) {
          continue;
        }
        if (item.isDirectory()) {
          await walk(fullPath);
        }
        else if (item.isFile() && this.matchesPatterns(relPath, include)) {
          try {
            const content = readFileSync(fullPath, 'utf8');
            entries.push({
              path: relPath,
              content,
              lines: content.split('\n')
            });
          }
          catch {
            // Skip unreadable files
          }
        }
      }
    };
    await walk(this.projectRoot);
    return entries;
  }

  private matchesPatterns(path: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      // Glob → regex translation.
      //
      // The previous implementation did three sequential `.replace` calls
      // which produced incorrect output for `**/*.md`-style patterns: it
      // translated `**/*` into `.[^/]*/[^/]*`, which only matched paths
      // with exactly one directory segment. As a result, deeply nested
      // artefacts like `_wdf_output/stories/S-001.md` were silently
      // skipped by every rule keyed on `**/*.md`.
      //
      // The transform below handles the cases this codebase actually uses:
      //   `*`    → `[^/]*`  (no slash)
      //   `**/`  → `(.*/)?` (zero or more directory segments + slash)
      //   `**`   → `.*`     (anything, including slashes)
      //   `?`    → `[^/]`   (single non-slash)
      // Regex metacharacters in the source pattern are escaped first.
      const escaped = pattern.replace(/[\\^$.|?*+()[\]{}]/g, ch => {
        if (ch === '*') return ch; // handled below
        if (ch === '?') return ch; // handled below
        return '\\' + ch;
      });
      let regex = '';
      let i = 0;
      while (i < escaped.length) {
        const c = escaped[i];
        if (c === '*' && escaped[i + 1] === '*') {
          // ** — check for trailing slash
          if (escaped[i + 2] === '/') {
            regex += '(.*\\/)?';
            i += 3;
          } else {
            regex += '.*';
            i += 2;
          }
        } else if (c === '*') {
          regex += '[^/]*';
          i++;
        } else if (c === '?') {
          regex += '[^/]';
          i++;
        } else if (c === '\\' && escaped[i + 1]) {
          // Preserved escape (e.g. `\.`)
          regex += '\\' + escaped[i + 1];
          i += 2;
        } else {
          regex += c;
          i++;
        }
      }
      return new RegExp(`^${regex}$`).test(path);
    });
  }

  private async applyFixes(results: LintResult[]): Promise<void> {
    for (const result of results) {
      if (result.fix) {
        try {
          await result.fix();
          result.message += ' [FIXED]';
        }
        catch (err) {
          result.message += ` [FIX FAILED: ${(err as Error).message}]`;
        }
      }
    }
  }

  /**
   * Format report for CLI output
   */
  formatReport(report: LintReport, options: LintOptions = {}): string {
    const lines: string[] = [];
    // Header
    lines.push('');
    lines.push('╔══════════════════════════════════════════════════╗');
    lines.push('║         wdf-method Specification Linter          ║');
    if (options.strict) {
      lines.push('║  (strict mode: warnings promoted to errors)     ║');
    }
    lines.push('╚══════════════════════════════════════════════════╝');
    lines.push('');
    // Summary
    lines.push(`  Files checked: ${report.filesChecked}`);
    lines.push(`  Rules applied: ${report.rulesApplied}`);
    lines.push(`  Duration: ${report.durationMs}ms`);
    lines.push('');
    // Results by file
    const byFile = new Map<string, LintResult[]>();
    for (const r of report.results) {
      const existing = byFile.get(r.file) ?? [];
      existing.push(r);
      byFile.set(r.file, existing);
    }
    for (const [file, fileResults] of byFile) {
      lines.push(`  📄 ${file}`);
      for (const r of fileResults) {
        const icon = r.level === 'error' ? '❌' : '⚠️';
        const loc = r.line ? `:${r.line}` : '';
        lines.push(`     ${icon} [${r.ruleId}]${loc} ${r.message}`);
      }
      lines.push('');
    }
    // Summary
    const hasErrors = report.errors > 0;
    const hasWarnings = report.warnings > 0;
    if (!hasErrors && !hasWarnings) {
      lines.push('  ✅ All checks passed!');
    }
    else {
      lines.push(`  Summary: ${report.errors} errors, ${report.warnings} warnings`);
    }
    lines.push('');
    return lines.join('\n');
  }
}
