import { LintRule, LintContext, LintResult, FileEntry } from '../types.js';

/**
 * AGENT_SAFETY — enforces WDF-004 + WDF-005 from the constitution.
 *
 *   WDF-004: every references/agents/*.md must have valid YAML frontmatter
 *            with at least name, description, default_permissions.
 *   WDF-005: default_permissions must include bash_deny with at minimum
 *            `git push` and `rm -rf` — the safety floor that keeps a
 *            misbehaving agent from rewriting shared history or wiping
 *            the worktree.
 *
 * Without enforcement, an agent without bash_deny could run `git push
 * --force` or `rm -rf .wdf-story-workspaces/*` and the permission
 * injector would happily forward those commands to the shell. This rule
 * makes the safety floor a CI gate rather than a documentation promise.
 *
 * The rule tolerates the YAML shape actually used in references/agents/:
 *   default_permissions:
 *     bash_allow: [...]
 *     bash_deny:  [...]
 *     scope_read: [...]
 * It does NOT require bash_allow — read-only agents (architect, qa-verifier)
 * legitimately have empty allow lists.
 */
export const AgentSafetyRule: LintRule = {
  id: 'AGENT_SAFETY',
  level: 'error',
  description: 'Agent frontmatter + bash_deny safety floor (WDF-004/005)',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];

    for (const file of context.files) {
      if (!/(^|\/)references\/agents\/[^/]+\.md$/.test(file.path)) continue;

      const fm = extractFrontmatter(file);
      if (!fm) {
        results.push({
          ruleId: 'AGENT_SAFETY',
          level: 'error',
          file: file.path,
          line: 1,
          message: 'Agent file missing YAML frontmatter (WDF-004)',
        });
        continue;
      }

      // Required scalar fields
      const requiredFields = ['name', 'description', 'default_permissions'];
      for (const field of requiredFields) {
        const re = new RegExp(`^${field}:\\s*(\\S.*?)\\s*$`, 'm');
        if (!re.test(fm)) {
          // default_permissions may appear as `default_permissions:` with
          // nested block. Treat presence of the key as fulfillment.
          const blockRe = new RegExp(`^${field}:\\s*$`, 'm');
          if (!blockRe.test(fm)) {
            results.push({
              ruleId: 'AGENT_SAFETY',
              level: 'error',
              file: file.path,
              line: 1,
              message: `Agent missing required frontmatter field: ${field} (WDF-004)`,
            });
          }
        }
      }

      // bash_deny floor check
      const bashDeny = collectListField(fm, 'bash_deny');
      if (bashDeny.values.length === 0) {
        results.push({
          ruleId: 'AGENT_SAFETY',
          level: 'error',
          file: file.path,
          line: bashDeny.line ?? 1,
          message: 'Agent missing default_permissions.bash_deny (WDF-005)',
        });
      } else {
        // Must contain both `git push` and `rm -rf` (or globs covering them).
        const hasGitPush = bashDeny.values.some(v =>
          v === 'git push' || v === 'git push*' || /git\s+push/.test(v),
        );
        const hasRmRf = bashDeny.values.some(v =>
          v === 'rm -rf' || v === 'rm -rf*' || v === 'rm -rf /*' || /^rm\s+-rf/.test(v),
        );
        if (!hasGitPush) {
          results.push({
            ruleId: 'AGENT_SAFETY',
            level: 'error',
            file: file.path,
            line: bashDeny.line ?? 1,
            message: 'Agent bash_deny must include "git push" (WDF-005 safety floor)',
          });
        }
        if (!hasRmRf) {
          results.push({
            ruleId: 'AGENT_SAFETY',
            level: 'error',
            file: file.path,
            line: bashDeny.line ?? 1,
            message: 'Agent bash_deny must include "rm -rf" (WDF-005 safety floor)',
          });
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

function collectListField(fm: string, fieldName: string): { values: string[]; line?: number } {
  const lines = fm.split('\n');
  const values: string[] = [];
  let fieldLine: number | undefined;

  // Inline: fieldName: [a, b]
  const inlineRe = new RegExp(`^\\s*${fieldName}:\\s*(.+?)\\s*$`);
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

  // Block: fieldName:\n  - a\n  - b
  const blockHeaderRe = new RegExp(`^\\s*${fieldName}:\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (!blockHeaderRe.test(lines[i])) continue;
    fieldLine = i + 2;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      // Stop at next sibling or shallower indent
      if (/^\S/.test(next)) break;
      if (next.trim() === '') continue;
      const item = next.match(/^\s+-\s+(\S.*?)\s*$/);
      if (item) {
        values.push(item[1]);
      } else if (/^\s{2}\S/.test(next) && !/^\s+-/.test(next)) {
        // Hit a different sub-key at same indent — field is over.
        break;
      }
    }
    return { values, line: fieldLine };
  }

  return { values, line: fieldLine };
}
