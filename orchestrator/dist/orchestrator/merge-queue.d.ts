import { SprintStatusManager } from './sprint-status.js';
import { Track } from './types.js';
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
        ready: typeof this.state.data.global_state.merge_queue.items;
        waiting: typeof this.state.data.global_state.merge_queue.items;
    }>;
    /**
     * Get the next ready item from the merge queue (by merge_order).
     */
    getNextReady(): Promise<typeof this.state.data.global_state.merge_queue.items[0] | undefined>;
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
    displayQueue(): string;
}
//# sourceMappingURL=merge-queue.d.ts.map