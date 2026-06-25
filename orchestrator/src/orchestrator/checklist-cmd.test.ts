import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateChecklist, verifyChecklist, listChecklists } from './checklist-cmd.js';
import type { LoadConfigResult } from './config.js';

let tmp: string;
let projectRoot: string;
let storiesDir: string;

// A minimal LoadConfigResult that lets the code path through without reading disk.
const EMPTY_CFG: LoadConfigResult = {
  config: { workflow: {}, defaults: {}, scope_lock: {}, merge_queue: {}, change_request: {}, auto_run: {}, agent_communication: {}, acceptance_gates: {}, acceptance_check_safety: {}, specs: {} } as any,
  warnings: [],
  sources: [],
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wdf-checklist-'));
  projectRoot = join(tmp, 'repo');
  storiesDir = join(projectRoot, '_wdf_output', 'stories');
  mkdirSync(storiesDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeStory(id: string, frontmatter: Record<string, unknown>): void {
  const lines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const e of v) lines.push(`  - ${e}`);
    } else if (typeof v === 'string') {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(`# ${id}`);
  writeFileSync(join(storiesDir, `${id}.md`), lines.join('\n') + '\n', 'utf8');
}

function writePrd(reqs: string[]): void {
  const outRoot = join(projectRoot, '_wdf_output');
  mkdirSync(outRoot, { recursive: true });
  const lines = ['# PRD', ''];
  for (const r of reqs) lines.push(`## ${r} title`);
  writeFileSync(join(outRoot, 'prd.md'), lines.join('\n'));
}

// ─── generateChecklist ──────────────────────────────────────────────

describe('generateChecklist', () => {
  it('creates a checklist with mechanical + soft items', () => {
    writeStory('S-AUTH-01', {
      story_id: 'S-AUTH-01',
      title: 'Login',
      track: 'backend',
      order: 1,
      maps_to_req: 'REQ-001',
      scope_write: ['src/auth.ts'],
      acceptance_check: ['npm test'],
    });
    writePrd(['REQ-001']);

    const r = generateChecklist({ storyId: 'S-AUTH-01', projectRoot, config: EMPTY_CFG });
    expect(r.created).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.mechanicalItems.length).toBe(5); // CHK-M01..M05
    // REQ resolves, scope is atomic, AC non-empty, path is project-relative.
    expect(r.mechanicalItems.find(i => i.id === 'CHK-M01')?.checked).toBe(true);
    expect(r.mechanicalItems.find(i => i.id === 'CHK-M02')?.checked).toBe(true);
    expect(r.mechanicalItems.find(i => i.id === 'CHK-M03')?.checked).toBe(true);
    expect(r.mechanicalItems.find(i => i.id === 'CHK-M04')?.checked).toBe(true);
    expect(r.mechanicalItems.find(i => i.id === 'CHK-M05')?.checked).toBe(true);
    // Soft items are unchecked by default.
    expect(r.items.filter(i => i.source === 'soft').every(i => !i.checked)).toBe(true);
  });

  it('CHK-M01 fails when story has no REQ mapping', () => {
    writeStory('S-AUTH-01', {
      story_id: 'S-AUTH-01',
      title: 'Login',
      track: 'backend',
      order: 1,
      scope_write: ['src/auth.ts'],
      acceptance_check: ['npm test'],
    });
    const r = generateChecklist({ storyId: 'S-AUTH-01', projectRoot, config: EMPTY_CFG });
    expect(r.mechanicalItems.find(i => i.id === 'CHK-M01')?.checked).toBe(false);
  });

  it('CHK-M02 fails when scope_write is empty or too large', () => {
    writeStory('S-A', { story_id: 'S-A', title: 'a', track: 'backend', order: 1, scope_write: [], acceptance_check: ['x'] });
    const r1 = generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    expect(r1.mechanicalItems.find(i => i.id === 'CHK-M02')?.checked).toBe(false);
  });

  it('CHK-M04 fails when a declared REQ is missing from prd.md', () => {
    writeStory('S-A', { story_id: 'S-A', title: 'a', track: 'backend', order: 1, maps_to_req: 'REQ-999', scope_write: ['src/a.ts'], acceptance_check: ['x'] });
    writePrd([]); // no REQs in prd
    const r = generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    expect(r.mechanicalItems.find(i => i.id === 'CHK-M04')?.checked).toBe(false);
  });

  it('CHK-M05 fails when scope_write uses absolute paths or ..', () => {
    writeStory('S-A', { story_id: 'S-A', title: 'a', track: 'backend', order: 1, maps_to_req: 'REQ-1', scope_write: ['/etc/passwd', '../../evil'], acceptance_check: ['x'] });
    writePrd(['REQ-1']);
    const r = generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    expect(r.mechanicalItems.find(i => i.id === 'CHK-M05')?.checked).toBe(false);
  });

  it('is idempotent — existing checklist is not overwritten', () => {
    writeStory('S-A', { story_id: 'S-A', title: 'a', track: 'backend', order: 1, maps_to_req: 'REQ-1', scope_write: ['src/a.ts'], acceptance_check: ['x'] });
    // No prd.md → CHK-M04 starts unchecked.
    const r1 = generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    expect(r1.created).toBe(true);
    // Simulate a user checking CHK-M04 by hand.
    const raw = readFileSync(r1.path, 'utf8');
    expect(raw).toContain('- [ ] CHK-M04');
    writeFileSync(r1.path, raw.replace('- [ ] CHK-M04', '- [x] CHK-M04'));
    const r2 = generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    expect(r2.created).toBe(false);
    expect(readFileSync(r2.path, 'utf8')).toContain('- [x] CHK-M04');
  });

  it('honours --force to overwrite', () => {
    writeStory('S-A', { story_id: 'S-A', title: 'a', track: 'backend', order: 1, maps_to_req: 'REQ-1', scope_write: ['src/a.ts'], acceptance_check: ['x'] });
    // Deliberately no prd.md so CHK-M04 (REQ-resolves) starts unchecked.
    const r1 = generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    // Sanity: CHK-M04 is unchecked because prd.md is absent.
    const raw = readFileSync(r1.path, 'utf8');
    expect(raw).toContain('- [ ] CHK-M04');
    // Simulate a user checking CHK-M04 by hand.
    writeFileSync(r1.path, raw.replace('- [ ] CHK-M04', '- [x] CHK-M04'));
    // --force should regenerate and re-uncheck CHK-M04.
    const r2 = generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG, force: true });
    expect(r2.created).toBe(true);
    expect(readFileSync(r2.path, 'utf8')).toContain('- [ ] CHK-M04');
  });

  it('throws when story does not exist', () => {
    expect(() => generateChecklist({ storyId: 'S-MISSING', projectRoot, config: EMPTY_CFG }))
      .toThrow(/not found/);
  });
});

// ─── verifyChecklist ────────────────────────────────────────────────

describe('verifyChecklist', () => {
  it('fails when checklist file is missing', () => {
    const r = verifyChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    expect(r.ok).toBe(false);
    expect(r.exists).toBe(false);
    expect(r.reason).toMatch(/not found/);
  });

  it('passes when every item is checked', () => {
    writeStory('S-A', { story_id: 'S-A', title: 'a', track: 'backend', order: 1, maps_to_req: 'REQ-1', scope_write: ['src/a.ts'], acceptance_check: ['x'] });
    writePrd(['REQ-1']);
    const gen = generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    // Check every item.
    let raw = readFileSync(gen.path, 'utf8');
    raw = raw.replace(/- \[ \]/g, '- [x]');
    writeFileSync(gen.path, raw);
    const r = verifyChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    expect(r.ok).toBe(true);
    expect(r.unchecked).toEqual([]);
  });

  it('fails with a list of unchecked ids', () => {
    writeStory('S-A', { story_id: 'S-A', title: 'a', track: 'backend', order: 1, maps_to_req: 'REQ-1', scope_write: ['src/a.ts'], acceptance_check: ['x'] });
    writePrd(['REQ-1']);
    const gen = generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    // Leave everything unchecked (the default). Mechanical CHK items are
    // auto-checked only when the story fails their condition; here the story
    // is clean so M01..M05 pass. The soft CHK-001..005 are always unchecked.
    const r = verifyChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    expect(r.ok).toBe(false);
    expect(r.unchecked).toEqual(expect.arrayContaining(['CHK-001', 'CHK-005']));
  });
});

// ─── listChecklists ─────────────────────────────────────────────────

describe('listChecklists', () => {
  it('returns empty when no checklists exist', () => {
    expect(listChecklists({ projectRoot, config: EMPTY_CFG })).toEqual([]);
  });

  it('enumerates every checklist in the dir', () => {
    writeStory('S-A', { story_id: 'S-A', title: 'a', track: 'backend', order: 1, maps_to_req: 'REQ-1', scope_write: ['a.ts'], acceptance_check: ['x'] });
    writeStory('S-B', { story_id: 'S-B', title: 'b', track: 'backend', order: 2, maps_to_req: 'REQ-2', scope_write: ['b.ts'], acceptance_check: ['x'] });
    writePrd(['REQ-1', 'REQ-2']);
    generateChecklist({ storyId: 'S-A', projectRoot, config: EMPTY_CFG });
    generateChecklist({ storyId: 'S-B', projectRoot, config: EMPTY_CFG });
    const list = listChecklists({ projectRoot, config: EMPTY_CFG });
    expect(list.map(e => e.storyId).sort()).toEqual(['S-A', 'S-B']);
    expect(list.every(e => e.total > 0)).toBe(true);
  });
});
