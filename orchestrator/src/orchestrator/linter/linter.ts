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
    const exclude = options.exclude ?? ['node_modules/**', '.git/**', '_*/**', 'dist/**'];
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
      // Simple glob matching: **/foo, *.md
      const regex = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
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
