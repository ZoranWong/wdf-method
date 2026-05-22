import { Track } from './types.js';
/**
 * Manages git worktrees for per-story isolation during Phase 4.
 * Each story gets its own worktree + branch → no parallel write conflicts.
 */
export declare class WorktreeManager {
    baseDir: string;
    private git;
    private worktreesDir;
    constructor(projectRoot: string);
    storyWorktreePath(storyId: string, track: Track): string;
    /**
     * Create a new worktree for a story, branching from main.
     */
    createStoryWorktree(storyId: string, track: Track): Promise<{
        path: string;
        branch: string;
    }>;
    /**
     * Remove a story worktree and delete the branch after successful merge.
     */
    removeStoryWorktree(storyId: string, track: Track): Promise<void>;
    /**
     * Commit all changes in the story worktree with a standardized message.
     */
    commitInWorktree(worktreePath: string, storyId: string, title: string, stage: 'IMPLEMENTED' | 'TESTED' | 'SUBMITTED' | 'CODE_ACCEPTED', details?: Record<string, unknown>): Promise<void>;
    /**
     * Merge a story branch into main with --no-ff.
     * First performs a dry-run merge to detect conflicts, then executes the real merge.
     */
    mergeToMain(storyId: string, track: Track, title: string, details?: Record<string, unknown>): Promise<void>;
    private buildMergeMessage;
    /**
     * Check if a worktree for a story already exists.
     */
    worktreeExists(storyId: string, track: Track): boolean;
    /**
     * List all active story worktrees.
     */
    listActiveWorktrees(): Promise<{
        storyId: string;
        track: Track;
        branch: string;
        path: string;
    }[]>;
    /**
     * Create the scope-freeze git tag (Phase 4.1).
     */
    createScopeFreezeTag(): Promise<void>;
    /**
     * Check if a file was modified compared to the scope-freeze tag.
     */
    getChangedFilesSinceScopeFreeze(): Promise<string[]>;
    /**
     * Get changed files in the current worktree (unstaged + staged).
     */
    getChangedFilesInWorktree(worktreePath: string): Promise<string[]>;
}
//# sourceMappingURL=worktree.d.ts.map