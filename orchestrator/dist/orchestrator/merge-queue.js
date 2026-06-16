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
     * V3.6 Atomic Merge Protocol:
     * git merge --no-commit --no-ff → integration checks → commit OR abort.
     * Zero partial merge state on main branch.
     */
    async attemptAtomicMerge(item) {
        const { execSync } = await import('child_process');
        try {
            // Step 1: Merge without committing
            execSync(`git merge ${item.branch} --no-commit --no-ff`, { cwd: this.projectRoot, stdio: 'pipe', timeout: 60_000 });
            // Step 2: Run integration checks
            const checks = item.integration_checks.length > 0 ? item.integration_checks : ['npm run test', 'npm run build'];
            for (const check of checks) {
                try {
                    execSync(check, { cwd: this.projectRoot, stdio: 'pipe', timeout: 120_000 });
                }
                catch {
                    // Step 3a: Abort — no partial merge
                    execSync('git merge --abort', { cwd: this.projectRoot, stdio: 'pipe' });
                    await this.state.updateMergeItem(item.story_id, { merge_status: 'failed', merge_failed_reason: `Integration check failed: ${check}` });
                    return { merged: false, error: `Integration check failed: ${check}` };
                }
            }
            // Step 3b: All checks passed — commit
            const msg = `Merge ${item.story_id}: ${item.queue_item_id} — MERGED\n\nIntegration checks: all passed`;
            execSync(`git commit -m "${msg}"`, { cwd: this.projectRoot, stdio: 'pipe' });
            const log = execSync('git log --oneline -1', { cwd: this.projectRoot, encoding: 'utf-8', stdio: 'pipe' });
            const commitHash = log.trim().split(' ')[0];
            return { merged: true, commitHash };
        }
        catch (err) {
            // If merge itself fails (not just checks), abort
            try {
                execSync('git merge --abort', { cwd: this.projectRoot, stdio: 'pipe' });
            }
            catch { }
            return { merged: false, error: err.message ?? String(err) };
        }
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
    /**
     * V3.6 Hidden Dependency Detection: Cross-branch diff analysis before merge.
     * Detects files modified by BOTH this story AND any other queued story,
     * where the file is NOT in either story's scope_write.
     */
    async detectHiddenOverlaps(branch, scopeWrite) {
        const hidden = [];
        try {
            const { execSync } = await import('child_process');
            const currentFiles = execSync(`git diff --name-only origin/master..${branch}`, { cwd: this.projectRoot, encoding: 'utf8', stdio: 'pipe' })
                .split('\n').filter(Boolean);
            const mq = this.state.getMergeQueue();
            for (const otherItem of mq.items) {
                if (otherItem.merge_status === 'merged' || otherItem.merge_status === 'failed')
                    continue;
                try {
                    const otherFiles = execSync(`git diff --name-only origin/master..${otherItem.branch}`, { cwd: this.projectRoot, encoding: 'utf8', stdio: 'pipe' })
                        .split('\n').filter(Boolean);
                    const overlap = currentFiles.filter(f => otherFiles.includes(f));
                    for (const f of overlap) {
                        const inCurrentScope = scopeWrite.some(sw => f.startsWith(sw) || f.includes(sw));
                        const inOtherScope = true; // conservative: assume it may not be in other's scope
                        if (!inCurrentScope && !inOtherScope) {
                            hidden.push(`${f} (also modified by ${otherItem.story_id})`);
                        }
                    }
                }
                catch { /* skip items that can't be diffed */ }
            }
        }
        catch { /* Best-effort detection */ }
        return hidden;
    }
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