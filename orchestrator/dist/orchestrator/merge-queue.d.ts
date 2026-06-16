import { SprintStatusManager } from './sprint-status.js';
import { Track, MergeQueueItem } from './types.js';
/**
 * Validate a merge queue item before it enters the queue.
 * Checks branch name, story_id, queue_item_id, and integration_checks are all safe.
 * @throws Error if any field contains unsafe characters or commands
 */
export declare function validateMergeQueueItem(item: MergeQueueItem): void;
/**
 * Pure helper to detect hidden overlaps between two branches.
 * An overlap is "hidden" when both branches modify the same file,
 * but that file is NOT explicitly declared in either story's scope_write.
 *
 * @param currentFiles Files modified by the current branch
 * @param otherFiles Files modified by the other branch
 * @param currentScope Declared scope_write of the current story
 * @param otherScope Declared scope_write of the other story
 * @returns Array of files that overlap outside both scopes
 */
export declare function detectHiddenOverlapsFromFileLists(currentFiles: string[], otherFiles: string[], currentScope: string[], otherScope: string[]): string[];
/**
 * Dependency-ordered merge queue for Phase 4.
 * Stories enter queue after CODE_ACCEPTED/UI_ACCEPTED, merge in dependency order during Phase 4.13.
 */
export declare class MergeQueueManager {
    private state;
    private projectRoot;
    constructor(state: SprintStatusManager, projectRoot: string);
    /**
     * Enqueue a story after it reaches acceptance state.
     * Validates all identifiers and commands before enqueueing.
     */
    enqueue(storyId: string, track: Track, branch: string, dependsOn: string[], integrationChecks: string[], mergeOrder?: number): Promise<void>;
    /**
     * Re-evaluate dependency statuses and update merge item states.
     */
    reconcileDependencies(): Promise<{
        ready: MergeQueueItem[];
        waiting: MergeQueueItem[];
    }>;
    /**
     * V3.6 Atomic Merge Protocol:
     * git merge --no-commit --no-ff → integration checks → commit OR abort.
     * Zero partial merge state on main branch.
     *
     * Uses spawnSync with argument arrays for shell injection safety.
     * All integration checks are validated via validateCommand before execution.
     */
    attemptAtomicMerge(item: MergeQueueItem): Promise<{
        merged: boolean;
        commitHash?: string;
        error?: string;
    }>;
    /**
     * Get the next ready item from the merge queue (by merge_order).
     */
    getNextReady(): Promise<MergeQueueItem | undefined>;
    /**
     * Mark an item as being merged.
     */
    markMerging(storyId: string): Promise<void>;
    /**
     * Mark a merge as successful.
     */
    markMerged(storyId: string, commitHash: string): Promise<void>;
    /**
     * Mark a merge as failed.
     */
    markFailed(storyId: string, reason: string): Promise<void>;
    /**
     * Calculate the next merge_order value (increments by 10).
     */
    private nextMergeOrder;
    /**
     * Display the merge queue status as a formatted string.
     */
    /**
     * V3.6 Hidden Dependency Detection: Cross-branch diff analysis before merge.
     * Detects files modified by BOTH this story AND any other queued story,
     * where the file is NOT in either story's scope_write.
     *
     * Uses spawnSync with arg arrays for shell injection safety.
     * Uses configured merge base, falling back to smart detection.
     */
    detectHiddenOverlaps(branch: string, scopeWrite: string[], otherScopes: Map<string, string[]>): Promise<string[]>;
    /**
     * Determine the merge base for diff comparisons.
     * Tries: configured base → scope-freeze/pre-implementation tag → detected main branch.
     */
    private getMergeBase;
    displayQueue(): string;
}
//# sourceMappingURL=merge-queue.d.ts.map