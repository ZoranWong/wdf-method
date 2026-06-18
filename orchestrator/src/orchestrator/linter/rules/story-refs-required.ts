import { LintRule, LintContext, LintResult } from '../types.js';

/**
 * STORY_REFS_REQUIRED — every story under `_wdf_output/stories/` must declare
 * a non-empty `refs:` field in its YAML frontmatter so the traceability graph
 * (CHG-2026-003) can join STORY → REQ / EPIC / API / DB.
 *
 * Stories without `refs:` are invisible to CR impact analysis: a change in
 * upstream artefacts won't surface them. The rule fails fast in CI to keep
 * the graph dense.
 */
export const StoryRefsRequiredRule: LintRule = {
  id: 'STORY_REFS_REQUIRED',
  level: 'error',
  description: 'Stories must declare refs: in frontmatter for traceability',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];

    for (const file of context.files) {
      // Only stories
      if (!/(^|\/)stories\/[^/]+\.md$/.test(file.path)) continue;

      const fmMatch = file.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) {
        results.push({
          ruleId: 'STORY_REFS_REQUIRED',
          level: 'error',
          file: file.path,
          line: 1,
          message: `Story missing YAML frontmatter — cannot declare refs:`,
        });
        continue;
      }
      const fm = fmMatch[1];

      // Inline form: refs: [REQ-1, EPIC-2]
      const inline = fm.match(/^refs:\s*\[([^\]]*)\]\s*$/m);
      if (inline) {
        const items = inline[1].split(',').map(s => s.trim()).filter(Boolean);
        if (items.length === 0) {
          results.push({
            ruleId: 'STORY_REFS_REQUIRED',
            level: 'error',
            file: file.path,
            line: lineOf(file, 'refs:'),
            message: `Story has empty refs: [] — must reference at least one REQ/EPIC/JTBD/API/DB`,
          });
        }
        continue;
      }

      // Block list
      const lines = fm.split('\n');
      const idx = lines.findIndex(l => /^refs:\s*$/.test(l));
      if (idx === -1) {
        results.push({
          ruleId: 'STORY_REFS_REQUIRED',
          level: 'error',
          file: file.path,
          line: 1,
          message: `Story missing refs: field — required for traceability graph`,
        });
        continue;
      }
      let count = 0;
      for (let i = idx + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        if (/^\S/.test(lines[i])) break;
        if (/^\s*-\s*\S+/.test(lines[i])) count++;
      }
      if (count === 0) {
        results.push({
          ruleId: 'STORY_REFS_REQUIRED',
          level: 'error',
          file: file.path,
          line: lineOf(file, 'refs:'),
          message: `Story refs: block-list is empty — must reference at least one upstream node`,
        });
      }
    }
    return results;
  },
};

function lineOf(file: { lines: string[] }, needle: string): number {
  for (let i = 0; i < file.lines.length; i++) {
    if (file.lines[i].includes(needle)) return i + 1;
  }
  return 1;
}
