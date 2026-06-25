import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { traceBlame } from './trace-blame.js';

let tmp: string;
let projectRoot: string;
let outRoot: string;
let storiesDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wdf-blame-'));
  projectRoot = join(tmp, 'repo');
  outRoot = join(projectRoot, '_wdf_output');
  storiesDir = join(outRoot, 'stories');
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(storiesDir, { recursive: true });
  execSync('git init -q', { cwd: projectRoot, stdio: 'ignore' });
  execSync('git config user.email "t@t"', { cwd: projectRoot, stdio: 'ignore' });
  execSync('git config user.name "t"', { cwd: projectRoot, stdio: 'ignore' });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writePrd(reqs: { id: string; title: string }[]): void {
  const lines = ['# PRD', ''];
  for (const r of reqs) lines.push(`## ${r.id} ${r.title}`);
  writeFileSync(join(outRoot, 'prd.md'), lines.join('\n'));
}

function writeJtbd(cards: { id: string; title: string }[]): void {
  const dir = join(outRoot, '_output', 'planning');
  mkdirSync(dir, { recursive: true });
  const lines = ['# JTBD Cards', ''];
  for (const c of cards) lines.push(`## ${c.id} ${c.title}`);
  writeFileSync(join(dir, 'jtbd-cards.md'), lines.join('\n'));
}

function writeStory(id: string, title: string, refs: string[]): void {
  const fm = [
    '---',
    `story_id: ${id}`,
    `title: ${title}`,
    `track: backend`,
    `order: 1`,
    'refs:',
  ];
  for (const r of refs) fm.push(`  - ${r}`);
  fm.push('scope_write:', `  - src/${id.toLowerCase()}.ts`);
  fm.push('acceptance_check:', `  - "true"`);
  fm.push('---');
  fm.push('');
  fm.push(`# ${title}`);
  writeFileSync(join(storiesDir, `${id}.md`), fm.join('\n'));
}

function commitFile(relPath: string, content: string, message: string): void {
  const full = join(projectRoot, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  execSync(`git add "${relPath}"`, { cwd: projectRoot, stdio: 'ignore' });
  execSync(`git commit -q -m "${message}"`, { cwd: projectRoot, stdio: 'ignore' });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('traceBlame', () => {
  it('returns file-not-found for missing files', async () => {
    const r = await traceBlame({ file: 'missing.ts', line: 1, projectRoot });
    expect(r.commit).toBeNull();
    expect(r.formatted).toMatch(/file not found/);
  });

  it('returns untracked for files not in git', async () => {
    writeFileSync(join(projectRoot, 'a.ts'), 'hello\n');
    const r = await traceBlame({ file: 'a.ts', line: 1, projectRoot });
    expect(r.commit).toBeNull();
    expect(r.formatted).toMatch(/not tracked by git/);
  });

  it('returns the commit + parsed story but no REQ when graph is absent', async () => {
    // No _wdf_output (no prd.md / stories).
    commitFile('a.ts', 'x = 1\n', 'feat: add x [story:S-AUTH-01]');
    const r = await traceBlame({ file: 'a.ts', line: 1, projectRoot });
    expect(r.commit).not.toBeNull();
    expect(r.story_id).toBe('S-AUTH-01');
    expect(r.reqs).toEqual([]);
    expect(r.traceComplete).toBe(false);
    // Story line is present (tag parsed), but REQ/JTBD lines are absent.
    expect(r.formatted).toMatch(/story.*S-AUTH-01/);
    expect(r.formatted).not.toMatch(/^REQ\b/m);
    expect(r.formatted).not.toMatch(/^JTBD\b/m);
  });

  it('resolves REQ and JTBD from a tagged commit', async () => {
    writePrd([{ id: 'REQ-1', title: 'login' }]);
    writeJtbd([{ id: 'JTBD-1', title: 'secure access' }]);
    writeStory('S-AUTH-01', 'User login', ['REQ-1', 'JTBD-1']);

    commitFile('src/auth.ts', 'const x = 1\nconst y = 2\n', 'feat: login [story:S-AUTH-01]');

    const r = await traceBlame({ file: 'src/auth.ts', line: 1, projectRoot });
    expect(r.commit).toMatch(/^[0-9a-f]{12}$/);
    expect(r.subject).toBe('feat: login [story:S-AUTH-01]');
    expect(r.story_id).toBe('S-AUTH-01');
    expect(r.story_title).toBe('User login');
    expect(r.reqs.map(r2 => r2.id)).toEqual(['REQ-1']);
    expect(r.jtbds.map(j => j.id)).toEqual(['JTBD-1']);
    expect(r.traceComplete).toBe(true);
  });

  it('handles commits without a story tag gracefully', async () => {
    writePrd([{ id: 'REQ-1', title: 'login' }]);
    commitFile('a.ts', 'x\n', 'chore: cleanup');
    const r = await traceBlame({ file: 'a.ts', line: 1, projectRoot });
    expect(r.commit).not.toBeNull();
    expect(r.story_id).toBeNull();
    expect(r.reqs).toEqual([]);
    expect(r.traceComplete).toBe(false);
  });

  it('rejects negative line numbers', async () => {
    writeFileSync(join(projectRoot, 'a.ts'), 'x\n');
    const r = await traceBlame({ file: 'a.ts', line: 0, projectRoot });
    expect(r.commit).toBeNull();
    expect(r.formatted).toMatch(/line must be >= 1/);
  });
});
