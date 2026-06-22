import { LintRule, LintContext, LintResult, FileEntry } from '../types.js';

/**
 * STORY_SCOPE_REQUIRED — every story must declare:
 *   - `scope_write:` with at least one path (where the dev agent is allowed
 *     to write). Paths must be project-relative (no leading `/`, no `..`).
 *   - `acceptance_check:` with at least one verifiable check (a shell
 *     command, an AC id, or a test path).
 *
 * Without scope_write, the pipeline's permission injector has nothing to
 * tag — the dev agent runs with blanket project access, violating the
 * "scoped writes" constitution principle. Without acceptance_check, the
 * QA stage has no machine-verifiable gate to run.
 *
 * This rule is paired with STORY_REFS_REQUIRED / STORY_REFS_RESOLVE:
 * together they enforce that a story is traceable (has refs), scoped
 * (has write paths), and verifiable (has acceptance checks).
 */
export const StoryScopeRequiredRule: LintRule = {
  id: 'STORY_SCOPE_REQUIRED',
  level: 'error',
  description: 'Stories must declare scope_write + acceptance_check',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];

    for (const file of context.files) {
      if (!/(^|\/)_?wdf_output\/stories\/[^/]+\.md$/.test(file.path)) continue;

      const fm = extractFrontmatter(file);
      if (!fm) continue;

      // scope_write
      const scopeWrite = collectListField(fm, 'scope_write');
      if (scopeWrite.values.length === 0) {
        results.push({
          ruleId: 'STORY_SCOPE_REQUIRED',
          level: 'error',
          file: file.path,
          line: scopeWrite.line ?? 2,
          message: 'Story missing scope_write: — must declare at least one write path',
        });
      } else {
        // Path hygiene check
        for (const path of scopeWrite.values) {
          if (/^\/[^/]/.test(path) || path.startsWith('/')) {
            results.push({
              ruleId: 'STORY_SCOPE_REQUIRED',
              level: 'error',
              file: file.path,
              line: scopeWrite.line ?? 2,
              message: `scope_write path "${path}" is absolute — must be project-relative`,
            });
          }
          if (path.includes('..')) {
            results.push({
              ruleId: 'STORY_SCOPE_REQUIRED',
              level: 'error',
              file: file.path,
              line: scopeWrite.line ?? 2,
              message: `scope_write path "${path}" contains ".." — escapes project root`,
            });
          }
        }
      }

      // acceptance_check
      const acceptance = collectListField(fm, 'acceptance_check');
      if (acceptance.values.length === 0) {
        results.push({
          ruleId: 'STORY_SCOPE_REQUIRED',
          level: 'error',
          file: file.path,
          line: acceptance.line ?? 2,
          message: 'Story missing acceptance_check: — must declare at least one verifiable check',
        });
      }
    }

    return results;
  },
};

function extractFrontmatter(file: FileEntry): string | null {
  const m = file.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

function collectListField(fm: string, fieldName: string): { values: string[]; line?: number } {
  const lines = fm.split('\n');
  const values: string[] = [];
  let fieldLine: number | undefined;

  // Inline form: fieldName: [a, b, c]  OR  fieldName: single-value
  const inlineRe = new RegExp(`^${fieldName}:\\s*(.+?)\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(inlineRe);
    if (!m) continue;
    fieldLine = i + 2;
    const raw = m[1].replace(/[[\]]/g, '').trim();
    if (raw === '' || raw === '[]') return { values: [], line: fieldLine };
    for (const item of raw.split(',').map(s => s.trim()).filter(Boolean)) {
      values.push(item);
    }
    return { values, line: fieldLine };
  }

  // Block-list form:
  //   fieldName:
  //     - item1
  //     - item2
  const blockHeaderRe = new RegExp(`^${fieldName}:\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (!blockHeaderRe.test(lines[i])) continue;
    fieldLine = i + 2;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (/^\S/.test(next)) break; // next top-level key
      const item = next.match(/^\s+-\s+(\S.*?)\s*$/);
      if (item) values.push(item[1]);
    }
    return { values, line: fieldLine };
  }

  return { values, line: fieldLine };
}
