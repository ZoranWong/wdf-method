import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import simpleGit from 'simple-git';
import { StoryRunner } from './story-runner.js';
import { SprintStatusManager } from './sprint-status.js';
import { WorktreeManager } from './worktree.js';
import { GateEvaluator } from './gate-evaluator.js';
import { StoryEntry } from './types.js';

/**
 * StoryRunner SRG integration tests.
 *
 * These tests focus on the Story Ready Gate (SRG) enforcement path inside
 * tryRunStory: a failing SRG must abort before any worktree is created and
 * must record a `story_blocked` audit entry; a passing SRG that flips
 * serial_only must surface the flag back to the orchestrator.
 *
 * The full happy-path execution (worktree → agent → merge) is covered by
 * the engine fixture and e2e suites. Here we mock the worktree manager
 * and agent dispatcher to keep the surface focused on SRG behaviour.
 */

async function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'wdf-srg-runner-'));
  // Initialise a real git repo so SprintStatusManager / WorktreeManager
  // helpers don't blow up on missing .git.
  const git = simpleGit(root);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test');
  // Create an initial commit so worktree commands can branch from "main".
  writeFileSync(join(root, 'README.md'), '# fixture');
  await git.add('.');
  await git.commit('init');

  const out = join(root, '_bmad-output', 'web-dev-flow');
  const statusDir = join(out, 'status');
  const storiesDir = join(out, 'stories');
  mkdirSync(statusDir, { recursive: true });
  mkdirSync(storiesDir, { recursive: true });

  // Pre-create the directory referenced by scope_write so SRG-07 passes.
  mkdirSync(join(root, 'src', 'auth'), { recursive: true });
  mkdirSync(join(root, 'schema', 'migration'), { recursive: true });

  // Story markdown files for SRG-03.
  writeFileSync(join(storiesDir, 'S-1.1.md'), '# Story S-1.1');
  writeFileSync(join(storiesDir, 'S-1.2.md'), '# Story S-1.2');

  return { root, statusDir, storiesDir, out };
}

function makeStory(overrides: Partial<StoryEntry> = {}): StoryEntry {
  return {
    track: 'backend',
    order: 1,
    story_id: 'S-1.1',
    title: 'Test Story',
    scope_write: ['src/auth'],
    acceptance_check: ['npm run test'],
    code_standards_source: ['AGENTS.md'],
    depends_on: [],
    ...overrides,
  } as StoryEntry;
}

async function makeRunner(root: string, statusDir: string, storiesDir: string, opts?: { protectedPaths?: string[] }) {
  // Use the unified-file loader so all four phases (incl. phase_4) are
  // initialised in defaults — loadFromStatusDir only creates phases that have
  // YAML files on disk, which makes updateStoryStatus throw "Phase 4 not found".
  const state = await SprintStatusManager.load(join(statusDir, '..', 'sprint-status.yaml'));
  const worktree = new WorktreeManager(root);
  const gate = new GateEvaluator(root);
  const runner = new StoryRunner(state, worktree, gate, root, storiesDir, join(statusDir, '..'), {
    protectedPaths: opts?.protectedPaths ?? [],
  });
  return { runner, state, worktree };
}

describe('StoryRunner — Story Ready Gate integration', () => {
  let consoleErrSpy: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns null and records a story_blocked audit when SRG fails', async () => {
    const { root, statusDir, storiesDir } = await makeFixture();
    const { runner, state } = await makeRunner(root, statusDir, storiesDir);
    const auditSpy = vi.spyOn(state, 'appendAudit');

    // SRG-09 fail: unsafe acceptance command (rm -rf is on the forbidden list).
    const story = makeStory({ acceptance_check: ['rm -rf /'] });
    const result = await (runner as any).tryRunStory(story);

    expect(result).toBeNull();
    expect(auditSpy).toHaveBeenCalledWith(
      'story_blocked',
      expect.objectContaining({
        story_id: 'S-1.1',
        decision: 'block',
        reason: 'story_ready_gate',
      })
    );
    // Each failing check id should be logged on stderr
    const errLines = consoleErrSpy.mock.calls.map((c: any[]) => String(c[0]));
    expect(errLines.some((l: string) => l.includes('Story Ready Gate failed'))).toBe(true);
    expect(errLines.some((l: string) => /SRG-0\d/.test(l))).toBe(true);
  });

  it('rejects empty scope_write (SRG-01) before any worktree is created', async () => {
    const { root, statusDir, storiesDir } = await makeFixture();
    const { runner, worktree } = await makeRunner(root, statusDir, storiesDir);
    const createSpy = vi.spyOn(worktree, 'createStoryWorktree');

    const story = makeStory({ scope_write: [] });
    const result = await (runner as any).tryRunStory(story);

    expect(result).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('flags scope overlap with active IN_PROGRESS stories (SRG-05)', async () => {
    const { root, statusDir, storiesDir } = await makeFixture();
    const { runner, state } = await makeRunner(root, statusDir, storiesDir);

    // Register the overlapping story in development_order so scope_write is
    // visible to SRG-05 (StoryStatus alone doesn't carry scope info).
    state.data.global_state.development_order = [
      {
        track: 'backend',
        order: 0,
        story_id: 'S-1.0',
        title: 'overlap',
        scope_write: ['src/auth/login'],
        acceptance_check: ['npm run test'],
        code_standards_source: ['AGENTS.md'],
      } as any,
    ];

    // Mark S-1.0 as IN_PROGRESS in phase_4_4.
    await state.updateStoryStatus(4, 'phase_4_4', {
      id: 'S-1.0',
      status: 'IN_PROGRESS' as any,
    } as any);

    const story = makeStory();
    const result = await (runner as any).tryRunStory(story);
    expect(result).toBeNull();
  });

  it('marks protected-path stories as serial_only (SRG-08)', async () => {
    const { root, statusDir, storiesDir } = await makeFixture();
    const { runner } = await makeRunner(root, statusDir, storiesDir, {
      protectedPaths: ['schema/migration'],
    });

    // Stub out worktree + agent dispatch — we only care about the SRG outcome
    // captured on the runner before agent execution begins.
    const w = (runner as any).worktree;
    vi.spyOn(w, 'createStoryWorktree').mockResolvedValue({ path: '/tmp/x', branch: 'b' });
    vi.spyOn(w, 'commitInWorktree').mockResolvedValue(undefined);
    vi.spyOn(w, 'mergeToMain').mockResolvedValue(undefined);
    vi.spyOn(w, 'removeStoryWorktree').mockResolvedValue(undefined);

    const dispatcher = (runner as any).agentDispatcher;
    vi.spyOn(dispatcher, 'dispatchStoryAgent').mockResolvedValue({
      status: 'CODE_ACCEPTED',
      summary: 'ok',
      durationMs: 10,
    });

    const story = makeStory({ scope_write: ['schema/migration'] });
    const result = await (runner as any).tryRunStory(story);

    expect(result).not.toBeNull();
    expect(result.serial_only).toBe(true);
  });

  it('passes protected_paths from constructor option through to SRG', async () => {
    const { root, statusDir, storiesDir } = await makeFixture();
    const { runner } = await makeRunner(root, statusDir, storiesDir, {
      protectedPaths: ['custom/sentinel'],
    });

    // Story touches the configured sentinel directory.
    mkdirSync(join(root, 'custom', 'sentinel'), { recursive: true });
    const story = makeStory({ scope_write: ['custom/sentinel'] });

    const w = (runner as any).worktree;
    vi.spyOn(w, 'createStoryWorktree').mockResolvedValue({ path: '/tmp/x', branch: 'b' });
    vi.spyOn(w, 'commitInWorktree').mockResolvedValue(undefined);
    vi.spyOn(w, 'mergeToMain').mockResolvedValue(undefined);
    vi.spyOn(w, 'removeStoryWorktree').mockResolvedValue(undefined);

    const dispatcher = (runner as any).agentDispatcher;
    vi.spyOn(dispatcher, 'dispatchStoryAgent').mockResolvedValue({
      status: 'CODE_ACCEPTED',
      summary: 'ok',
      durationMs: 10,
    });

    const result = await (runner as any).tryRunStory(story);
    expect(result?.serial_only).toBe(true);
  });

  it('does not create a worktree when SRG fails on path traversal (SRG-04)', async () => {
    const { root, statusDir, storiesDir } = await makeFixture();
    const { runner, worktree } = await makeRunner(root, statusDir, storiesDir);
    const createSpy = vi.spyOn(worktree, 'createStoryWorktree');

    const story = makeStory({ scope_write: ['src/../etc/passwd'] });
    const result = await (runner as any).tryRunStory(story);

    expect(result).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });
});
