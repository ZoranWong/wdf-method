import { SprintStatusManager } from './sprint-status.js';
import { Track, MergeQueueItem } from './types.js';
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
     */
    detectHiddenOverlaps(branch: string, scopeWrite: string[]): Promise<string[]>;
    displayQueue(): string;
}
//# sourceMappingURL=merge-queue.d.ts.map