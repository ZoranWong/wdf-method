import { LintRule, LintContext, LintResult } from '../types.js';

/**
 * VERSION_CONSISTENCY - All files declaring a version must agree on the current version
 *
 * Scans all files for "version = X.Y.Z" or "version: X.Y.Z" patterns
 * and ensures they all match the canonical version in package.json
 */
export const VersionConsistencyRule: LintRule = {
  id: 'VERSION_CONSISTENCY',
  level: 'error',
  description: 'All files declaring version must agree with canonical version',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];
    const versionPatterns = [
      /version\s*[=:]\s*["']?(\d+\.\d+\.\d+)["']?/i,
      /#\s*Version:\s*(\d+\.\d+\.\d+)/i,
      />\s*v?(\d+\.\d+\.\d+)\s*</i, // HTML version tags
    ];
    // Find canonical version from package.json first
    let canonicalVersion: string | null = null;
    // Canonical version comes from the framework's own package.json (name
    // `wdf-method` / `@wdf-method/*`). Example and template apps under
    // examples/ and templates/ carry their OWN independent versions (e.g.
    // the todo-app backend at 0.0.1) — picking the first package.json in
    // walk order would let an example app dictate the framework version and
    // flag every real doc as a mismatch.
    for (const file of context.files) {
      if (file.path.endsWith('package.json') && !file.path.includes('node_modules')) {
        try {
          const pkg = JSON.parse(file.content);
          if (pkg.name && !pkg.name.includes('wdf-method')) continue;
          if (pkg.version) {
            canonicalVersion = pkg.version;
            break; // Use first framework package.json found
          }
        }
        catch {
          // Skip invalid JSON files
        }
      }
    }
    if (!canonicalVersion) {
      results.push({
        ruleId: 'VERSION_CONSISTENCY',
        level: 'error',
        file: 'orchestrator/package.json',
        message: 'Cannot determine canonical version'
      });
      return results;
    }
    // Only check version consistency in specific files that should
    // have the project version number
    const versionedFiles = [
      'customize.toml',
      'module.yaml',
      'package.json',
      'orchestrator/package.json',
      'SKILL.md',
      'README.md',
      'CONSTITUTION.md',
    ];
    // Check all files
    for (const file of context.files) {
      // Skip files that don't need version check
      if (!versionedFiles.some(vf => file.path.endsWith(vf))) {
        continue;
      }
      // Skip package.json files that don't have the orchestrator name prefix
      // (they have their own versioning)
      if (file.path.endsWith('package.json')) {
        try {
          const pkg = JSON.parse(file.content);
          if (pkg.name && !pkg.name.includes('wdf-method')) {
            continue;
          }
        }
        catch {
          continue;
        }
      }
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        for (const pattern of versionPatterns) {
          const match = line.match(pattern);
          if (match && match[1]) {
            const foundVersion = match[1];
            if (foundVersion !== canonicalVersion) {
              results.push({
                ruleId: 'VERSION_CONSISTENCY',
                level: 'error',
                file: file.path,
                line: i + 1,
                message: `Version mismatch: found ${foundVersion}, expected ${canonicalVersion}`
              });
            }
          }
        }
      }
    }
    return results;
  }
};

function skipFile(path: string): boolean {
  // Skip known non-versioned files
  const skipPatterns = [
    /package-lock\.json$/,
    /node_modules\//,
    /\.git\//,
    /\.md$/i, // Skip .md for now - too many false positives
    /\.test\.ts$/i,
    /CHANGELOG/i,
    /HISTORY/i
  ];
  return skipPatterns.some(p => p.test(path));
}
