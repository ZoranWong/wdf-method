import { describe, it, expect } from 'vitest';
import { parseTasksMarkdown, formatTasksOneLine, formatTasksReport } from './tasks-md.js';

/**
 * Tasks.md summarizer unit tests.
 *
 * The summarizer is the read-side of the cross-session continuity
 * contract: Claude writes tasks.md in a stable shape, the CLI parses
 * it for `wdf start` / `wdf status` / `wdf tasks` banners.
 */
describe('tasks-md parser', () => {
  const sample = `# Tasks — Demo

Last updated: 2026-06-22T15:30:00Z
Current phase: 4

## In Progress
- [ ] S-AUTH-01: dev stage
  - last: dev-agent dispatched
  - next: read review report
- [ ] S-AUTH-02: review stage

## Pending
- [ ] S-TODO-01: depends on S-AUTH-02
- [ ] S-TODO-02: CRUD

## Done
- [x] 2026-06-22 Phase 3.7 stories written
- [x] 2026-06-21 Phase 2.5 PRD frozen

## Notes
- 2026-06-22: paused for env refactor
- 2026-06-21: design tokens locked
`;

  it('counts open + done items across all sections', () => {
    const s = parseTasksMarkdown(sample);
    expect(s.open_count).toBe(4); // 2 in_progress + 2 pending
    expect(s.done_count).toBe(2);
  });

  it('extracts in_progress + pending headlines', () => {
    const s = parseTasksMarkdown(sample);
    expect(s.in_progress).toEqual([
      'S-AUTH-01: dev stage',
      'S-AUTH-02: review stage',
    ]);
    expect(s.pending).toEqual([
      'S-TODO-01: depends on S-AUTH-02',
      'S-TODO-02: CRUD',
    ]);
  });

  it('parses header metadata (last_updated + current_phase)', () => {
    const s = parseTasksMarkdown(sample);
    expect(s.last_updated).toBe('2026-06-22T15:30:00Z');
    expect(s.current_phase).toBe(4);
  });

  it('picks the first note as last_note (reverse-chrono convention)', () => {
    const s = parseTasksMarkdown(sample);
    expect(s.last_note).toBe('2026-06-22: paused for env refactor');
  });

  it('returns empty arrays when sections are absent', () => {
    const minimal = `# Tasks\n\n## Pending\n- [ ] only one\n`;
    const s = parseTasksMarkdown(minimal);
    expect(s.open_count).toBe(1);
    expect(s.in_progress).toEqual([]);
    expect(s.recent_done).toEqual([]);
    expect(s.last_note).toBe('');
  });

  it('caps recent_done at 5 items', () => {
    const doneheavy = `# Tasks\n\n## Done\n` +
      Array.from({ length: 10 }, (_, i) => `- [x] 2026-06-0${i} item ${i}`).join('\n');
    const s = parseTasksMarkdown(doneheavy);
    expect(s.done_count).toBe(10);
    expect(s.recent_done.length).toBe(5);
  });

  it('formats one-line banner', () => {
    const s = parseTasksMarkdown(sample);
    const line = formatTasksOneLine(s);
    expect(line).toContain('4 open');
    expect(line).toContain('2 done');
    expect(line).toContain('in progress: S-AUTH-01: dev stage');
  });

  it('formats full report', () => {
    const s = parseTasksMarkdown(sample);
    const report = formatTasksReport(s);
    expect(report).toContain('Open: 4');
    expect(report).toContain('In Progress:');
    expect(report).toContain('Pending (2):');
    expect(report).toContain('Recently Done:');
    expect(report).toContain('Last note:');
  });
});
