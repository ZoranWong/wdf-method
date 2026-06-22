import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * tasks.md — multi-session continuity载体.
 *
 * The FSM state files record *what has happened*. They do not record
 * *what to do next* in a form a fresh Claude session can pick up. That
 * loss of intent across session boundaries is the root cause of "where
 * was I?" confusion after `/clear` or context compaction.
 *
 * tasks.md is the补全: a plain markdown file the Claude session writes
 * to (and reads from) at every step. The CLI never writes to it —
 * Claude owns the content. The CLI only parses + summarizes, so
 * `wdf start` and `wdf status` can surface "you have 3 pending tasks,
 * last note from yesterday: paused for env refactor" without the user
 * having to remember to check.
 *
 * File format (see commands/wdf-tasks.md for the canonical spec):
 *
 *   # Tasks — <project name>
 *
 *   Last updated: <ISO timestamp>
 *   Current phase: <number>
 *
 *   ## In Progress
 *   - [ ] <task description>
 *     - last: <most recent step>
 *     - next: <what to do next>
 *
 *   ## Pending
 *   - [ ] <task>
 *
 *   ## Done
 *   - [x] <YYYY-MM-DD> <task>
 *
 *   ## Notes
 *   - <YYYY-MM-DD>: <free-form note>
 *
 * Absence of tasks.md is a soft state — the summarizer returns null
 * and callers (wdf start, wdf status) simply omit the section.
 */

export interface TasksSummary {
  /** Total `- [ ]` checkboxes across all sections. */
  open_count: number;
  /** Total `- [x]` checkboxes across all sections. */
  done_count: number;
  /** First N=5 done items (most recent at top, parsed from line prefix). */
  recent_done: string[];
  /** Headlines under "## In Progress" — what's actively being worked on. */
  in_progress: string[];
  /** Headlines under "## Pending" — queued but not yet started. */
  pending: string[];
  /** Most recent "## Notes" entry (last line). Empty string if section absent. */
  last_note: string;
  /** "Last updated:" header value, ISO timestamp. */
  last_updated?: string;
  /** "Current phase:" header value, number. */
  current_phase?: number;
  /** Raw file path, for diagnostics. */
  path: string;
}

const DEFAULT_RECENT_DONE = 5;

/**
 * Read + summarize a project's tasks.md. Returns null when tasks.md is
 * absent — callers should treat null as "no continuity载体, skip silently".
 */
export function summarizeTasks(projectRoot: string): TasksSummary | null {
  const candidates = [
    join(projectRoot, 'tasks.md'),
    join(projectRoot, '_wdf_output', 'tasks.md'),
  ];
  const path = candidates.find(p => existsSync(p));
  if (!path) return null;

  const raw = readFileSync(path, 'utf8');
  return parseTasksMarkdown(raw, path);
}

/**
 * Pure parser — exposed for unit testing. Does not touch the filesystem.
 */
export function parseTasksMarkdown(raw: string, path = '<memory>'): TasksSummary {
  const lines = raw.split('\n');
  let section: 'header' | 'in_progress' | 'pending' | 'done' | 'notes' | 'other' = 'header';

  const in_progress: string[] = [];
  const pending: string[] = [];
  const recent_done: string[] = [];
  const notes: string[] = [];
  let open_count = 0;
  let done_count = 0;
  let last_updated: string | undefined;
  let current_phase: number | undefined;

  for (const line of lines) {
    // Section detection — top-level `## Foo` only.
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      const heading = h2[1].toLowerCase();
      if (heading.startsWith('in progress')) section = 'in_progress';
      else if (heading === 'pending' || heading.startsWith('todo')) section = 'pending';
      else if (heading === 'done' || heading.startsWith('completed')) section = 'done';
      else if (heading === 'notes') section = 'notes';
      else section = 'other';
      continue;
    }

    // Header metadata (before any `##` section).
    if (section === 'header') {
      const mUpdated = line.match(/^last updated:\s*(.+?)\s*$/i);
      if (mUpdated) {
        last_updated = mUpdated[1];
        continue;
      }
      const mPhase = line.match(/^current phase:\s*(\d+)/i);
      if (mPhase) {
        current_phase = parseInt(mPhase[1], 10);
        continue;
      }
    }

    // Checkbox items.
    const openItem = line.match(/^\s*-\s+\[\s*\]\s+(.+?)\s*$/);
    if (openItem) {
      open_count++;
      const title = stripSubPointers(openItem[1]);
      if (section === 'in_progress') in_progress.push(title);
      else if (section === 'pending') pending.push(title);
      continue;
    }

    const doneItem = line.match(/^\s*-\s+\[x\]\s+(.+?)\s*$/i);
    if (doneItem) {
      done_count++;
      if (section === 'done') {
        recent_done.unshift(doneItem[1]);
      }
      continue;
    }

    // Notes — bullet items under `## Notes`.
    if (section === 'notes') {
      const note = line.match(/^\s*-\s+(.+?)\s*$/);
      if (note) notes.push(note[1]);
    }
  }

  return {
    open_count,
    done_count,
    recent_done: recent_done.slice(0, DEFAULT_RECENT_DONE),
    in_progress,
    pending,
    // Notes are typically written in reverse-chronological order
    // (newest at top of the list), so the first captured note is the
    // most recent. We could parse dates to be fully robust, but that
    // adds complexity without much payoff — convention is strong.
    last_note: notes[0] ?? '',
    last_updated,
    current_phase,
    path,
  };
}

/**
 * Strip "- last:" / "- next:" sub-pointers from a task title so the
 * summary shows the headline rather than the most recent sub-bullet.
 * The sub-bullets are still useful context, but for the headline we
 * want the parent `- [ ]` line.
 *
 * This is a display-time transform — the underlying tasks.md is not
 * modified.
 */
function stripSubPointers(title: string): string {
  // The pattern `- [ ] Foo\n  - last: ...` puts the sub-pointer on
  // a separate line, so `title` already only has the headline. But
  // if a user writes `- [ ] Foo — last: bar` inline, trim that too.
  return title.replace(/\s+—\s+(last|next):.*$/i, '').trim();
}

/**
 * One-line rendering for `wdf start` / `wdf status` banners.
 * Example:
 *   "📋 3 open · 12 done · in progress: S-AUTH-01 dev stage"
 */
export function formatTasksOneLine(s: TasksSummary): string {
  const parts: string[] = [];
  parts.push(`📋 ${s.open_count} open`);
  parts.push(`${s.done_count} done`);
  if (s.in_progress.length > 0) {
    parts.push(`in progress: ${s.in_progress[0]}`);
  }
  return parts.join(' · ');
}

/**
 * Multi-line rendering for `wdf tasks` command output.
 */
export function formatTasksReport(s: TasksSummary): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════╗');
  lines.push('║                 tasks.md summary                 ║');
  lines.push('╚══════════════════════════════════════════════════╝');
  lines.push('');
  if (s.last_updated) lines.push(`  Last updated: ${s.last_updated}`);
  if (s.current_phase !== undefined) lines.push(`  Current phase: ${s.current_phase}`);
  lines.push(`  Open: ${s.open_count}  Done: ${s.done_count}`);
  lines.push('');

  if (s.in_progress.length > 0) {
    lines.push('  In Progress:');
    for (const t of s.in_progress) lines.push(`    → ${t}`);
    lines.push('');
  }

  if (s.pending.length > 0) {
    lines.push(`  Pending (${s.pending.length}):`);
    // Cap at 10 to keep the report scannable.
    for (const t of s.pending.slice(0, 10)) lines.push(`    · ${t}`);
    if (s.pending.length > 10) lines.push(`    … and ${s.pending.length - 10} more`);
    lines.push('');
  }

  if (s.recent_done.length > 0) {
    lines.push('  Recently Done:');
    for (const t of s.recent_done) lines.push(`    ✓ ${t}`);
    lines.push('');
  }

  if (s.last_note) {
    lines.push(`  Last note: ${s.last_note}`);
    lines.push('');
  }

  lines.push(`  Source: ${s.path}`);
  lines.push('');
  return lines.join('\n');
}
