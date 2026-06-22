/**
 * Tests for error-handling.ts (L2 worktree rollback + L3 git reset).
 *
 * These tests use real git repositories (created with git init in temp dirs)
 * to verify the snapshot/rollback/reset behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createSnapshot,
  readSnapshot,
  listSnapshots,
  l2WorktreeRollback,
  l3GitReset,
} from './error-handling.js';

function makeTempGitRepo(): string {
  const dir = join(tmpdir(), `wdf-errh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "test"', { cwd: dir, stdio: 'pipe' });
  // Create initial commit
  writeFileSync(join(dir, 'README.md'), '# Test');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: dir, stdio: 'pipe' });
  // Create _wdf_output dir
  mkdirSync(join(dir, '_wdf_output', 'status', 'snapshots'), { recursive: true });
  return dir;
}

describe('error-handling', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTempGitRepo();
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  });

  describe('createSnapshot', () => {
    it('captures branch, commit, and timestamp', () => {
      const snap = createSnapshot({ projectRoot });
      expect(snap.id).toMatch(/^snap-\d+$/);
      expect(snap.branch).toBeDefined();
      expect(snap.commit_sha).toMatch(/^[a-f0-9]{40}$/);
      expect(snap.created_at).toBeDefined();
      expect(new Date(snap.created_at).getTime()).not.toBeNaN();
    });

    it('captures dirty files when there are uncommitted changes', () => {
      // Create a tracked file, then modify it
      writeFileSync(join(projectRoot, 'tracked.txt'), 'original');
      execSync('git add . && git commit -m "add tracked"', { cwd: projectRoot, stdio: 'pipe' });
      writeFileSync(join(projectRoot, 'tracked.txt'), 'modified');

      const snap = createSnapshot({ projectRoot });
      expect(snap.dirty_files).toContain('tracked.txt');
    });

    it('has empty dirty_files when working tree is clean', () => {
      const snap = createSnapshot({ projectRoot });
      expect(snap.dirty_files).toEqual([]);
    });

    it('writes snapshot JSON to disk', () => {
      const snap = createSnapshot({ projectRoot });
      const path = join(projectRoot, '_wdf_output', 'status', 'snapshots', `${snap.id}.json`);
      expect(existsSync(path)).toBe(true);
    });
  });

  describe('readSnapshot', () => {
    it('reads a snapshot by ID', () => {
      const snap = createSnapshot({ projectRoot });
      const loaded = readSnapshot(snap.id, { projectRoot });
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(snap.id);
      expect(loaded!.commit_sha).toBe(snap.commit_sha);
    });

    it('returns null for non-existent snapshot', () => {
      const loaded = readSnapshot('snap-nonexistent', { projectRoot });
      expect(loaded).toBeNull();
    });
  });

  describe('listSnapshots', () => {
    it('lists all snapshots', () => {
      createSnapshot({ projectRoot });
      createSnapshot({ projectRoot });
      createSnapshot({ projectRoot });
      const snaps = listSnapshots({ projectRoot });
      expect(snaps).toHaveLength(3);
    });

    it('returns empty array when no snapshots exist', () => {
      const snaps = listSnapshots({ projectRoot });
      expect(snaps).toEqual([]);
    });
  });

  describe('l2WorktreeRollback', () => {
    it('creates a snapshot before rollback', () => {
      writeFileSync(join(projectRoot, 'src.ts'), 'code');
      execSync('git add . && git commit -m "add src"', { cwd: projectRoot, stdio: 'pipe' });

      // Modify the file
      writeFileSync(join(projectRoot, 'src.ts'), 'modified code');

      const result = l2WorktreeRollback('S-001', ['src.ts'], undefined, { projectRoot });
      expect(result.success).toBe(true);
      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.actions[0]).toMatch(/Created snapshot/);
    });

    it('restores modified files in scope_write', () => {
      // Create a tracked file
      writeFileSync(join(projectRoot, 'src.ts'), 'original');
      execSync('git add . && git commit -m "add src"', { cwd: projectRoot, projectRoot, stdio: 'pipe' });

      // Modify it
      writeFileSync(join(projectRoot, 'src.ts'), 'modified');

      const result = l2WorktreeRollback('S-001', ['src.ts'], undefined, { projectRoot });
      expect(result.success).toBe(true);

      // File should be restored
      const content = readFileSync(join(projectRoot, 'src.ts'), 'utf-8');
      expect(content).toBe('original');
    });

    it('respects dry-run mode', () => {
      writeFileSync(join(projectRoot, 'src.ts'), 'original');
      execSync('git add . && git commit -m "add src"', { cwd: projectRoot, stdio: 'pipe' });
      writeFileSync(join(projectRoot, 'src.ts'), 'modified');

      const result = l2WorktreeRollback('S-001', ['src.ts'], undefined, {
        projectRoot,
        dryRun: true,
      });
      expect(result.success).toBe(true);
      expect(result.actions).toContain('DRY RUN — no changes made');

      // File should NOT be restored in dry-run
      const content = readFileSync(join(projectRoot, 'src.ts'), 'utf-8');
      expect(content).toBe('modified');
    });

    it('writes recovery audit entry', () => {
      const result = l2WorktreeRollback('S-001', ['src.ts'], undefined, { projectRoot });
      expect(result.success).toBe(true);

      const auditPath = join(projectRoot, '_wdf_output', 'status', 'audit', 'recovery-audit.jsonl');
      expect(existsSync(auditPath)).toBe(true);
      const lines = readFileSync(auditPath, 'utf-8').trim().split('\n');
      expect(lines.length).toBe(1);
      const entry = JSON.parse(lines[0]);
      expect(entry.level).toBe('L2');
      expect(entry.story_id).toBe('S-001');
    });
  });

  describe('l3GitReset', () => {
    it('creates snapshot and resets to target commit', () => {
      // Create two commits
      writeFileSync(join(projectRoot, 'a.txt'), 'first');
      execSync('git add . && git commit -m "first"', { cwd: projectRoot, stdio: 'pipe' });
      const firstCommit = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();

      writeFileSync(join(projectRoot, 'b.txt'), 'second');
      execSync('git add . && git commit -m "second"', { cwd: projectRoot, stdio: 'pipe' });

      const result = l3GitReset(firstCommit, { projectRoot, requireConfirmation: false });
      expect(result.success).toBe(true);
      expect(result.executed).toBe(true);
      expect(result.target_commit).toBe(firstCommit);

      // Verify HEAD is at first commit
      const currentHead = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();
      expect(currentHead).toBe(firstCommit);
    });

    it('fails gracefully for non-existent commit', () => {
      const result = l3GitReset('deadbeef12345678', { projectRoot, requireConfirmation: false });
      expect(result.success).toBe(false);
      expect(result.executed).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('respects dry-run mode', () => {
      writeFileSync(join(projectRoot, 'a.txt'), 'first');
      execSync('git add . && git commit -m "first"', { cwd: projectRoot, stdio: 'pipe' });
      const firstCommit = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();

      writeFileSync(join(projectRoot, 'b.txt'), 'second');
      execSync('git add . && git commit -m "second"', { cwd: projectRoot, stdio: 'pipe' });

      const result = l3GitReset(firstCommit, { projectRoot, dryRun: true });
      expect(result.success).toBe(true);
      expect(result.executed).toBe(false);

      // HEAD should still be at second commit
      const currentHead = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();
      expect(currentHead).not.toBe(firstCommit);
    });

    it('writes recovery audit entry', () => {
      writeFileSync(join(projectRoot, 'a.txt'), 'first');
      execSync('git add . && git commit -m "first"', { cwd: projectRoot, stdio: 'pipe' });
      const firstCommit = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();

      l3GitReset(firstCommit, { projectRoot, requireConfirmation: false });

      const auditPath = join(projectRoot, '_wdf_output', 'status', 'audit', 'recovery-audit.jsonl');
      expect(existsSync(auditPath)).toBe(true);
      const lines = readFileSync(auditPath, 'utf-8').trim().split('\n');
      const entry = JSON.parse(lines[0]);
      expect(entry.level).toBe('L3');
      expect(entry.target_commit).toBe(firstCommit);
    });
  });
});
