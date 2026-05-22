/**
 * Dependency-ordered merge queue for Phase 4.
 * Stories enter queue after CODE_ACCEPTED/UI_ACCEPTED, merge in dependency order during Phase 4.13.
 */
export class MergeQueueManager {
    state;
    projectRoot;
    constructor(state, projectRoot) {
        this.state = state;
        this.projectRoot = projectRoot;
    }
    /**
     * Enqueue a story after it reaches acceptance state.
     */
    async enqueue(storyId, track, branch, dependsOn, integrationChecks, mergeOrder) {
        const mq = this.state.getMergeQueue();
        const existing = mq.items.find(i => i.story_id === storyId);
        if (existing)
            return;
        const order = mergeOrder ?? this.nextMergeOrder();
        const queueItemId = `QUEUE-${storyId.toLowerCase().replace(/[.-]/g, '_')}`;
        await this.state.enqueueMerge({
            queue_item_id: queueItemId,
            story_id: storyId,
            branch,
            depends_on: dependsOn,
            merge_order: order,
            integration_checks: integrationChecks,
        });
    }
    /**
     * Re-evaluate dependency statuses and update merge item states.
     */
    async reconcileDependencies() {
        const mq = this.state.getMergeQueue();
        const mergedIds = new Set(mq.items.filter(i => i.merge_status === 'merged').map(i => i.story_id));
        const ready = [];
        const waiting = [];
        for (const item of mq.items) {
            if (item.merge_status === 'merged' || item.merge_status === 'failed')
                continue;
            if (item.merge_status === 'merging')
                continue;
            const depsMet = item.depends_on.every(depId => mergedIds.has(depId));
            if (depsMet && item.merge_status !== 'queued') {
                item.merge_status = 'queued';
                await this.state.updateMergeItem(item.story_id, { merge_status: 'queued' });
                ready.push(item);
            }
            else if (depsMet) {
                ready.push(item);
            }
            else {
                if (item.merge_status !== 'waiting_dependency') {
                    await this.state.updateMergeItem(item.story_id, { merge_status: 'waiting_dependency' });
                }
                waiting.push(item);
            }
        }
        return { ready, waiting };
    }
    /**
     * Get the next ready item from the merge queue (by merge_order).
     */
    async getNextReady() {
        const { ready } = await this.reconcileDependencies();
        ready.sort((a, b) => a.merge_order - b.merge_order);
        return ready.find((i) => i.merge_status === 'queued');
    }
    /**
     * Mark an item as being merged.
     */
    async markMerging(storyId) {
        await this.state.updateMergeItem(storyId, { merge_status: 'merging' });
    }
    /**
     * Mark a merge as successful.
     */
    async markMerged(storyId, commitHash) {
        await this.state.updateMergeItem(storyId, {
            merge_status: 'merged',
            merged_at: new Date().toISOString(),
            merge_commit: commitHash,
        });
    }
    /**
     * Mark a merge as failed.
     */
    async markFailed(storyId, reason) {
        await this.state.updateMergeItem(storyId, {
            merge_status: 'failed',
            merge_failed_reason: reason,
        });
    }
    /**
     * Calculate the next merge_order value (increments by 10).
     */
    nextMergeOrder() {
        const mq = this.state.getMergeQueue();
        if (mq.items.length === 0)
            return 10;
        return Math.max(...mq.items.map(i => i.merge_order)) + 10;
    }
    /**
     * Display the merge queue status as a formatted string.
     */
    displayQueue() {
        const mq = this.state.getMergeQueue();
        const lines = [
            '═══════════════════════════════════════════',
            'Merge Queue Status',
            '═══════════════════════════════════════════',
            'Order  Story ID      Unit     Status              Depends On',
            '────── ────────────  ───────  ──────────────────  ──────────',
        ];
        const statusIcons = {
            queued: '⏳ queued',
            waiting_dependency: '🔒 waiting_dep',
            merging: '🔄 merging',
            merged: '✅ merged',
            failed: '❌ failed',
        };
        const sorted = [...mq.items].sort((a, b) => a.merge_order - b.merge_order);
        for (const item of sorted) {
            const icon = statusIcons[item.merge_status] ?? item.merge_status;
            const deps = item.depends_on.length > 0 ? item.depends_on.join(', ') : 'None';
            const unit = item.unit_id ?? '-';
            lines.push(`${String(item.merge_order).padEnd(6)} ${item.story_id.padEnd(14)} ${unit.padEnd(8)} ${icon.padEnd(20)} ${deps}`);
        }
        const counts = {
            queued: mq.items.filter(i => i.merge_status === 'queued').length,
            merged: mq.items.filter(i => i.merge_status === 'merged').length,
            waiting: mq.items.filter(i => i.merge_status === 'waiting_dependency').length,
            failed: mq.items.filter(i => i.merge_status === 'failed').length,
        };
        lines.push('');
        lines.push(`Summary: ${counts.merged} merged, ${counts.queued} queued, ${counts.waiting} waiting, ${counts.failed} failed`);
        return lines.join('\n');
    }
}
//# sourceMappingURL=merge-queue.js.map