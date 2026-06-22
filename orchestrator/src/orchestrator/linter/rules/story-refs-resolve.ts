import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { LintRule, LintContext, LintResult, FileEntry } from '../types.js';

/**
 * STORY_REFS_RESOLVE — every cross-artifact reference in a story must
 * resolve to an ID that actually exists upstream.
 *
 * Surfaces dangling references like:
 *   - `maps_to_req: REQ-999` when prd.md only defines REQ-001..010
 *   - `depends_on: S-FOO-99` when no such story exists
 *   - `refs: [EPIC-NONEXISTENT]`
 *
 * Existing STORY_REFS_REQUIRED only checks that `refs:` is non-empty —
 * it does not verify the IDs resolve. This rule closes that gap and also
 * accepts the field names actually used in the wild (`maps_to_req`,
 * `depends_on`) in addition to the spec-canonical `refs:`.
 *
 * Upstream sources scanned for known IDs:
 *   - `_wdf_output/prd.md`         → REQ-XXX, JTBD-XXX
 *   - `_wdf_output/epics.md`       → EPIC-XXX (named or numeric)
 *   - `_wdf_output/api-spec.yaml`  → operationId + path
 *   - `_wdf_output/db-schema.md`   → TBL: table_name
 *   - `_wdf_output/stories/*.md`   → S-XXX (cross-story deps)
 */
export const StoryRefsResolveRule: LintRule = {
  id: 'STORY_REFS_RESOLVE',
  level: 'error',
  description: 'Story references must resolve to upstream IDs',

  check(context: LintContext): LintResult[] {
    const results: LintResult[] = [];

    const stories = context.files.filter(f => /(^|\/)_?wdf_output\/stories\/[^/]+\.md$/.test(f.path));
    if (stories.length === 0) return results;

    const knownIds = collectKnownIds(context.files);

    for (const file of stories) {
      const fm = extractFrontmatter(file);
      if (!fm) continue;

      const refs = extractRefs(fm);

      for (const { id, line, field } of refs) {
        if (!id) continue;
        const kind = classifyId(id);
        if (!kind) continue; // unknown format — skip silently
        if (!knownIds[kind].has(id)) {
          results.push({
            ruleId: 'STORY_REFS_RESOLVE',
            level: 'error',
            file: file.path,
            line,
            message: `Dangling ${field}: "${id}" not found in any ${kind} source`,
          });
        }
      }
    }

    return results;
  },
};

type RefKind = 'req' | 'epic' | 'api' | 'db' | 'story';

function collectKnownIds(files: FileEntry[]): Record<RefKind, Set<string>> {
  const sets: Record<RefKind, Set<string>> = {
    req: new Set(),
    epic: new Set(),
    api: new Set(),
    db: new Set(),
    story: new Set(),
  };

  for (const file of files) {
    // PRD: REQ-XXX, JTBD-XXX
    if (/prd\.md$/i.test(file.path)) {
      for (const m of file.content.matchAll(/\b(REQ-\d+)\b/g)) sets.req.add(m[1]);
      for (const m of file.content.matchAll(/\b(JTBD-\d+)\b/g)) sets.req.add(m[1]);
    }
    // Epics: EPIC-XXX (named like EPIC-AUTH or numeric like EPIC-1)
    if (/epics\.md$/i.test(file.path)) {
      for (const m of file.content.matchAll(/\b(EPIC-[A-Z0-9]+)\b/g)) sets.epic.add(m[1]);
    }
    // API spec: operationId + paths
    if (/api-spec\.ya?ml$/i.test(file.path)) {
      for (const m of file.content.matchAll(/operationId:\s*([A-Za-z0-9_]+)/g)) sets.api.add(m[1]);
      for (const m of file.content.matchAll(/^\s*(\/[A-Za-z0-9/_{}-]+):/gm)) sets.api.add(m[1]);
    }
    // DB schema: table identifiers
    if (/db-schema\.md$/i.test(file.path)) {
      // Markdown headings like ## users / ### users
      for (const m of file.content.matchAll(/^#+\s+([a-z_][a-z0-9_]*)\s*$/gm)) sets.db.add(m[1]);
      // CREATE TABLE foo / table: foo
      for (const m of file.content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) sets.db.add(m[1]);
    }
    // Stories: cross-story deps
    if (/stories\/[^/]+\.md$/.test(file.path)) {
      const fmMatch = file.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const mStory = fmMatch?.[1].match(/story_id:\s*(\S+)/);
      if (mStory) sets.story.add(mStory[1]);
    }
  }

  return sets;
}

function extractFrontmatter(file: FileEntry): string | null {
  const m = file.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

interface ExtractedRef {
  id: string;
  line: number;
  field: string;
}

function extractRefs(fm: string): ExtractedRef[] {
  const refs: ExtractedRef[] = [];
  const lines = fm.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // maps_to_req: REQ-001 (single)
    // maps_to_req: REQ-001, REQ-004 (comma list)
    const maps = line.match(/^maps_to_req:\s*(.+?)\s*$/);
    if (maps) {
      for (const id of maps[1].split(',').map(s => s.trim()).filter(Boolean)) {
        refs.push({ id, line: i + 2, field: 'maps_to_req' }); // +2: frontmatter line offset
      }
      continue;
    }

    // depends_on: S-FOO-01 (single)
    // depends_on: [S-FOO-01, S-FOO-02] (inline list)
    const deps = line.match(/^depends_on:\s*(.+?)\s*$/);
    if (deps) {
      const cleaned = deps[1].replace(/[[\]]/g, '');
      for (const id of cleaned.split(',').map(s => s.trim()).filter(Boolean)) {
        refs.push({ id, line: i + 2, field: 'depends_on' });
      }
      continue;
    }

    // refs: [REQ-1, EPIC-2] (inline)
    const refsInline = line.match(/^refs:\s*\[([^\]]*)\]\s*$/);
    if (refsInline) {
      for (const id of refsInline[1].split(',').map(s => s.trim()).filter(Boolean)) {
        refs.push({ id, line: i + 2, field: 'refs' });
      }
      continue;
    }

    // Block-list items: `  - REQ-001`
    const blockItem = line.match(/^\s+-\s+(\S+)\s*$/);
    if (blockItem && i > 0 && /^(maps_to_req|depends_on|refs):\s*$/.test(lines[i - 1].trim())) {
      refs.push({ id: blockItem[1], line: i + 2, field: 'block-list' });
    }
  }

  return refs;
}

function classifyId(id: string): RefKind | null {
  if (/^REQ-\d+$/i.test(id)) return 'req';
  if (/^JTBD-\d+$/i.test(id)) return 'req';
  if (/^EPIC-/i.test(id)) return 'epic';
  if (/^S-[A-Z0-9-]+$/i.test(id)) return 'story';
  if (/^TBL:/.test(id)) return 'db';
  if (id.startsWith('/')) return 'api';
  return null;
}
