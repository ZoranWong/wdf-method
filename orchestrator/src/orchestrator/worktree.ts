import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { Track } from './types.js';

/**
 * Manages git worktrees for per-story isolation during Phase 4.
 * Each story gets its own worktree + branch → no parallel write conflicts.
 */
export class WorktreeManager {
  baseDir: string;
  private git: SimpleGit;
  private worktreesDir: string;

  constructor(projectRoot: string) {
    this.baseDir = projectRoot;
    this.git = simpleGit(projectRoot);
    this.worktreesDir = join(projectRoot, '.claude', 'worktrees', 'story');
  }

  storyWorktreePath(storyId: string, track: Track): string {
    return join(this.worktreesDir, `${storyId}-${track.slice(0, 2)}`);
  }

  /**
   * Create a new worktree for a story, branching from main.
   */
  async createStoryWorktree(storyId: string, track: Track): Promise<{ path: string; branch: string }> {
    const branchName = `story/${storyId}-${track.slice(0, 2)}`;
    const worktreePath = this.storyWorktreePath(storyId, track);

    if (existsSync(worktreePath)) {
      // Worktree already exists — just ensure it's on the right branch
      return { path: worktreePath, branch: branchName };
    }

    mkdirSync(this.worktreesDir, { recursive: true });

    await this.git.raw('worktree', 'add', '-b', branchName, worktreePath, 'main');

    return { path: worktreePath, branch: branchName };
  }

  /**
   * Remove a story worktree and delete the branch after successful merge.
   */
  async removeStoryWorktree(storyId: string, track: Track): Promise<void> {
    const worktreePath = this.storyWorktreePath(storyId, track);
    const branchName = `story/${storyId}-${track.slice(0, 2)}`;

    if (existsSync(worktreePath)) {
      await this.git.raw('worktree', 'remove', worktreePath, '--force');
    }

    try {
      await this.git.raw('branch', '-D', branchName);
    } catch {
      // Branch may already be deleted
    }
  }

  /**
   * Commit all changes in the story worktree with a standardized message.
   */
  async commitInWorktree(
    worktreePath: string,
    storyId: string,
    title: string,
    stage: 'IMPLEMENTED' | 'TESTED' | 'SUBMITTED' | 'CODE_ACCEPTED',
    details: Record<string, unknown> = {}
  ): Promise<void> {
    const git = simpleGit(worktreePath);

    // Stage all changes
    await git.raw('add', '-A');

    const detailLines = Object.entries(details)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const message = `${storyId}: ${title} — ${stage}\n\n${detailLines}`;
    await git.commit(message);
  }

  /**
   * Merge a story branch into main with --no-ff.
   * First performs a dry-run merge to detect conflicts, then executes the real merge.
   */
  async mergeToMain(storyId: string, track: Track, title: string, details: Record<string, unknown> = {}): Promise<void> {
    const branchName = `story/${storyId}-${track.slice(0, 2)}`;
    const git = this.git;

    // Ensure we're on main
    const currentBranch = await git.raw('rev-parse', '--abbrev-ref', 'HEAD');
    if (currentBranch.trim() !== 'main') {
      await git.raw('checkout', 'main');
    }

    // Step 1: Dry-run merge to detect conflicts (MG-09)
    try {
      await git.raw('merge', '--no-commit', '--no-ff', branchName, '--no-edit');
    } catch (dryRunErr: any) {
      // Conflict detected — abort and report
      try { await git.raw('merge', '--abort'); } catch {}
      throw new Error(`Merge conflict for ${storyId}: ${dryRunErr.message ?? dryRunErr}`);
    }

    // Step 2: Dry-run succeeded — finalize the merge commit
    try {
      await git.raw('commit', '--allow-empty', '-m', this.buildMergeMessage(storyId, title, details));
    } catch (commitErr: any) {
      try { await git.raw('merge', '--abort'); } catch {}
      throw new Error(`Merge commit failed for ${storyId}: ${commitErr.message ?? commitErr}`);
    }
  }

  private buildMergeMessage(storyId: string, title: string, details: Record<string, unknown>): string {
    const detailLines = Object.entries(details)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    return `Merge ${storyId}: ${title} — MERGED\n\n${detailLines}`;
  }

  /**
   * Check if a worktree for a story already exists.
   */
  worktreeExists(storyId: string, track: Track): boolean {
    return existsSync(this.storyWorktreePath(storyId, track));
  }

  /**
   * List all active story worktrees.
   */
  async listActiveWorktrees(): Promise<{ storyId: string; track: Track; branch: string; path: string }[]> {
    const output = await this.git.raw('worktree', 'list', '--porcelain');
    const results: Array<{ storyId: string; track: Track; branch: string; path: string }> = [];

    for (const line of output.split('\n')) {
      if (line.startsWith('branch ') && line.includes('story/')) {
        const branchMatch = line.match(/branch\s+(.+?)\s*$/);
        if (branchMatch) {
          const branch = branchMatch[1];
          const storyMatch = branch.match(/story\/(.+?)-(be|fe)$/);
          if (storyMatch) {
            results.push({
              storyId: storyMatch[1],
              track: storyMatch[2] === 'be' ? 'backend' : 'frontend',
              branch,
              path: '',
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Create the scope-freeze git tag (Phase 4.1).
   */
  async createScopeFreezeTag(): Promise<void> {
    try {
      await this.git.raw('tag', '-a', 'scope-freeze/pre-implementation', '-m',
        'Scope freeze: implementation boundary locked before Phase 4 execution');
    } catch {
      // Tag may already exist
    }
  }

  /**
   * Check if a file was modified compared to the scope-freeze tag.
   */
  async getChangedFilesSinceScopeFreeze(): Promise<string[]> {
    try {
      const output = await this.git.raw('diff', '--name-only', 'scope-freeze/pre-implementation', 'HEAD');
      return output.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Get changed files in the current worktree (unstaged + staged).
   */
  async getChangedFilesInWorktree(worktreePath: string): Promise<string[]> {
    const git = simpleGit(worktreePath);
    const output = await git.raw('diff', '--name-only', 'HEAD');
    return output.split('\n').filter(Boolean);
  }
}
