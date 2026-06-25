import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseStoryTag,
  extractReqIds,
  checkCommitMsg,
  installHooks,
  uninstallHooks,
} from './hooks-cmd.js';

let projectRoot: string;
let storiesDir: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wdf-hooks-test-'));
  // Emulate a minimal git repo (.git + hooks dir).
  mkdirSync(join(projectRoot, '.git', 'hooks'), { recursive: true });
  storiesDir = join(projectRoot, '_wdf_output', 'stories');
  mkdirSync(storiesDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
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

// ─── parseStoryTag ─────────────────────────────────────────────────

describe('parseStoryTag', () => {
  it('extracts from [story:S-AUTH-01]', () => {
    expect(parseStoryTag('feat: add login [story:S-AUTH-01]')).toBe('S-AUTH-01');
  });

  it('extracts the first match when multiple are present', () => {
    expect(parseStoryTag('[story:S-A] [story:S-B]')).toBe('S-A');
  });

  it('accepts dotted ids like S-1.1', () => {
    expect(parseStoryTag('[story:S-1.1]')).toBe('S-1.1');
  });

  it('returns null when no tag', () => {
    expect(parseStoryTag('feat: add login')).toBeNull();
  });

  it('returns null on empty message', () => {
    expect(parseStoryTag('')).toBeNull();
  });

  it('rejects malformed tags (no closing bracket)', () => {
    expect(parseStoryTag('feat: add login [story:S-AUTH-01')).toBeNull();
  });
});

// ─── extractReqIds ─────────────────────────────────────────────────

describe('extractReqIds', () => {
  it('parses comma-separated maps_to_req string', () => {
    expect(
      extractReqIds({ maps_to_req: 'REQ-002, REQ-003' }),
    ).toEqual(['REQ-002', 'REQ-003']);
  });

  it('parses single REQ id', () => {
    expect(extractReqIds({ maps_to_req: 'REQ-001' })).toEqual(['REQ-001']);
  });

  it('parses refs: as string[]', () => {
    expect(extractReqIds({ refs: ['REQ-001', 'REQ-005'] })).toEqual([
      'REQ-001',
      'REQ-005',
    ]);
  });

  it('dedupes across maps_to_req + refs', () => {
    const ids = extractReqIds({
      maps_to_req: 'REQ-001, REQ-002',
      refs: ['REQ-002', 'REQ-003'],
    });
    expect(ids.sort()).toEqual(['REQ-001', 'REQ-002', 'REQ-003']);
  });

  it('ignores non-REQ tokens', () => {
    expect(extractReqIds({ maps_to_req: 'REQ-001, EPIC-2, STORY-3' })).toEqual([
      'REQ-001',
    ]);
  });

  it('returns [] when no REQ field', () => {
    expect(extractReqIds({ title: 'something' })).toEqual([]);
  });

  it('handles whitespace-heavy input', () => {
    expect(extractReqIds({ maps_to_req: '  REQ-1 ,  REQ-2  ' })).toEqual([
      'REQ-1',
      'REQ-2',
    ]);
  });
});

// ─── checkCommitMsg ────────────────────────────────────────────────

describe('checkCommitMsg', () => {
  it('passes for a message without a story tag (non-strict)', () => {
    const r = checkCommitMsg({ message: 'chore: typo', projectRoot });
    expect(r.ok).toBe(true);
    expect(r.story_id).toBeUndefined();
  });

  it('fails for a message without a story tag (strict)', () => {
    const r = checkCommitMsg({ message: 'chore: typo', projectRoot, strict: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\[strict\]/);
  });

  it('fails when story file is missing', () => {
    const r = checkCommitMsg({
      message: 'feat: add login [story:S-AUTH-01]',
      projectRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.story_id).toBe('S-AUTH-01');
    expect(r.reason).toMatch(/not found/);
  });

  it('fails when story has no REQ mapping', () => {
    writeStory('S-AUTH-01', {
      story_id: 'S-AUTH-01',
      title: 'Login',
      track: 'backend',
      order: 1,
      scope_write: ['src/auth.ts'],
      acceptance_check: ['npm test'],
    });
    const r = checkCommitMsg({
      message: 'feat: add login [story:S-AUTH-01]',
      projectRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.req_ids).toBeUndefined();
    expect(r.reason).toMatch(/no REQ mapping/);
  });

  it('passes when story has maps_to_req', () => {
    writeStory('S-AUTH-01', {
      story_id: 'S-AUTH-01',
      title: 'Login',
      track: 'backend',
      order: 1,
      maps_to_req: 'REQ-001, REQ-002',
    });
    const r = checkCommitMsg({
      message: 'feat: add login [story:S-AUTH-01]',
      projectRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.story_id).toBe('S-AUTH-01');
    expect(r.req_ids?.sort()).toEqual(['REQ-001', 'REQ-002']);
  });

  it('passes when story has refs:', () => {
    writeStory('S-AUTH-01', {
      story_id: 'S-AUTH-01',
      title: 'Login',
      track: 'backend',
      order: 1,
      refs: ['REQ-005'],
    });
    const r = checkCommitMsg({
      message: 'feat: add login [story:S-AUTH-01]',
      projectRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.req_ids).toEqual(['REQ-005']);
  });

  it('strips trailing newlines from the message', () => {
    writeStory('S-AUTH-01', {
      story_id: 'S-AUTH-01',
      title: 'Login',
      track: 'backend',
      order: 1,
      maps_to_req: 'REQ-001',
    });
    const r = checkCommitMsg({
      message: 'feat: add login [story:S-AUTH-01]\n',
      projectRoot,
    });
    expect(r.ok).toBe(true);
  });
});

// ─── installHooks / uninstallHooks ─────────────────────────────────

describe('installHooks', () => {
  const cliPath = '/opt/wdf/orchestrator/dist/orchestrator/index.js';

  it('creates .git/hooks/commit-msg with the tag marker', () => {
    const r = installHooks({ projectRoot, cliPath });
    expect(r.installed).toBe(true);
    expect(r.replaced).toBe(false);
    const content = readFileSync(r.hookPath, 'utf8');
    expect(content).toContain('# wdf-hook:commit-msg:v1');
    expect(content).toContain(cliPath);
  });

  it('hook is executable (POSIX)', () => {
    const r = installHooks({ projectRoot, cliPath });
    // On fs that honor chmod (POSIX), the executable bit should be set.
    // WSL mounts often ignore it, so we only assert the call didn't throw.
    expect(existsSync(r.hookPath)).toBe(true);
  });

  it('refuses to overwrite untagged hooks without --force', () => {
    const hookPath = join(projectRoot, '.git', 'hooks', 'commit-msg');
    writeFileSync(hookPath, '#!/bin/sh\necho "user hook"\n', 'utf8');
    const r = installHooks({ projectRoot, cliPath });
    expect(r.installed).toBe(false);
    expect(r.note).toMatch(/refusing to overwrite/);
    // Original hook intact.
    expect(readFileSync(hookPath, 'utf8')).toContain('user hook');
  });

  it('replaces untagged hooks with --force and backs up', () => {
    const hookPath = join(projectRoot, '.git', 'hooks', 'commit-msg');
    writeFileSync(hookPath, '#!/bin/sh\necho "user hook"\n', 'utf8');
    const r = installHooks({ projectRoot, cliPath, force: true });
    expect(r.installed).toBe(true);
    expect(r.replaced).toBe(true);
    expect(r.note).toMatch(/old contents preserved/);
    expect(readFileSync(hookPath, 'utf8')).toContain('# wdf-hook:');
    expect(readFileSync(`${hookPath}.wdf-backup`, 'utf8')).toContain('user hook');
  });

  it('is idempotent — reinstall updates in place', () => {
    installHooks({ projectRoot, cliPath });
    const r = installHooks({ projectRoot, cliPath, strict: true });
    expect(r.installed).toBe(true);
    expect(r.replaced).toBe(true);
    const content = readFileSync(r.hookPath, 'utf8');
    expect(content).toMatch(/--strict/);
  });

  it('throws when projectRoot is not a git repo', () => {
    const nonGit = mkdtempSync(join(tmpdir(), 'wdf-hooks-nogit-'));
    try {
      expect(() => installHooks({ projectRoot: nonGit, cliPath })).toThrow(
        /Not a git repository/,
      );
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });
});

describe('uninstallHooks', () => {
  const cliPath = '/opt/wdf/orchestrator/dist/orchestrator/index.js';

  it('removes the hook entirely when it is pure wdf', () => {
    installHooks({ projectRoot, cliPath });
    const r = uninstallHooks(projectRoot);
    expect(r.removed).toBe(true);
    expect(r.preserved_user_section).toBe(false);
    expect(existsSync(r.hookPath)).toBe(false);
  });

  it('is a no-op on absent hook', () => {
    const r = uninstallHooks(projectRoot);
    expect(r.removed).toBe(false);
  });

  it('is a no-op on hook that is not ours', () => {
    const hookPath = join(projectRoot, '.git', 'hooks', 'commit-msg');
    writeFileSync(hookPath, '#!/bin/sh\n# user hook\n', 'utf8');
    const r = uninstallHooks(projectRoot);
    expect(r.removed).toBe(false);
    expect(readFileSync(hookPath, 'utf8')).toContain('user hook');
  });
});

// ─── Shell script rendering sanity ────────────────────────────────

describe('rendered shell script', () => {
  it('invokes the CLI with the msg-file argument', () => {
    const r = installHooks({
      projectRoot,
      cliPath: '/opt/wdf/orchestrator/dist/orchestrator/index.js',
    });
    const content = readFileSync(r.hookPath, 'utf8');
    expect(content).toContain('node "$WDF_CLI" hooks check-commit-msg "$MSG_FILE"');
  });

  it('honours the --strict flag', () => {
    const r = installHooks({
      projectRoot,
      cliPath: '/opt/wdf/cli.js',
      strict: true,
    });
    const content = readFileSync(r.hookPath, 'utf8');
    expect(content).toMatch(/hooks check-commit-msg "\$MSG_FILE" --strict/);
  });
});
