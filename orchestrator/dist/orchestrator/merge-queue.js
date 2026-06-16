import { spawnSync } from 'child_process';
import { assertSafeIdentifier, validateCommand } from './command-safety.js';
/**
 * Validate a merge queue item before it enters the queue.
 * Checks branch name, story_id, queue_item_id, and integration_checks are all safe.
 * @throws Error if any field contains unsafe characters or commands
 */
export function validateMergeQueueItem(item) {
    assertSafeIdentifier(item.branch, 'branch');
    assertSafeIdentifier(item.story_id, 'story_id');
    assertSafeIdentifier(item.queue_item_id, 'queue_item_id');
    for (const check of item.integration_checks ?? []) {
        const result = validateCommand(check);
        if (!result.ok) {
            throw new Error(`Unsafe integration check: ${result.reason}`);
        }
    }
}
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
export function detectHiddenOverlapsFromFileLists(currentFiles, otherFiles, currentScope, otherScope) {
    const overlaps = currentFiles.filter(file => otherFiles.includes(file));
    return overlaps.filter(file => !inScope(file, currentScope) && !inScope(file, otherScope));
}
/**
 * Check if a file path falls within any declared scope path.
 * A file is considered "in scope" if its path starts with any scope entry,
 * or if any scope entry starts with the file path (parent/child relation).
 */
function inScope(file, scope) {
    return scope.some(s => file.startsWith(s) || s.startsWith(file));
}
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
     * Validates all identifiers and commands before enqueueing.
     */
    async enqueue(storyId, track, branch, dependsOn, integrationChecks, mergeOrder) {
        const mq = this.state.getMergeQueue();
        const existing = mq.items.find(i => i.story_id === storyId);
        if (existing)
            return;
        const order = mergeOrder ?? this.nextMergeOrder();
        const queueItemId = `QUEUE-${storyId.toLowerCase().replace(/[.-]/g, '_')}`;
        // Validate before mutating state — fail-closed
        validateMergeQueueItem({
            queue_item_id: queueItemId,
            story_id: storyId,
            branch,
            depends_on: dependsOn,
            merge_order: order,
            integration_checks: integrationChecks,
            merge_status: 'queued',
        });
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
     *
     * Uses spawnSync with argument arrays for shell injection safety.
     * All integration checks are validated via validateCommand before execution.
     */
    async attemptAtomicMerge(item) {
        try {
            // Pre-validate ALL commands — fail-closed before any git operations
            assertSafeIdentifier(item.branch, 'branch');
            for (const check of item.integration_checks) {
                const result = validateCommand(check);
                if (!result.ok) {
                    return { merged: false, error: `Unsafe integration check: ${result.reason}` };
                }
            }
            // Step 1: Merge without committing (use spawnSync with arg array for safety)
            const mergeResult = spawnSync('git', ['merge', item.branch, '--no-commit', '--no-ff'], {
                cwd: this.projectRoot,
                encoding: 'utf8',
                timeout: 60_000,
            });
            if (mergeResult.status !== 0) {
                return { merged: false, error: `Git merge failed: ${mergeResult.stderr || mergeResult.stdout}` };
            }
            // Step 2: Run integration checks (already validated above)
            const checks = item.integration_checks.length > 0 ? item.integration_checks : ['npm run test', 'npm run build'];
            for (const check of checks) {
                // npm commands use spawn with shell=true for PATH resolution, but only after validateCommand passes
                const checkResult = spawnSync(check, {
                    cwd: this.projectRoot,
                    encoding: 'utf8',
                    timeout: 120_000,
                    shell: true,
                });
                if (checkResult.status !== 0) {
                    // Step 3a: Abort — no partial merge
                    spawnSync('git', ['merge', '--abort'], { cwd: this.projectRoot, encoding: 'utf8' });
                    await this.state.updateMergeItem(item.story_id, { merge_status: 'failed', merge_failed_reason: `Integration check failed: ${check}` });
                    return { merged: false, error: `Integration check failed: ${check}` };
                }
            }
            // Step 3b: All checks passed — commit
            const msg = `Merge ${item.story_id}: ${item.queue_item_id} — MERGED\n\nIntegration checks: all passed`;
            const commitResult = spawnSync('git', ['commit', '-m', msg], {
                cwd: this.projectRoot,
                encoding: 'utf8',
            });
            if (commitResult.status !== 0) {
                spawnSync('git', ['merge', '--abort'], { cwd: this.projectRoot, encoding: 'utf8' });
                return { merged: false, error: `Git commit failed: ${commitResult.stderr || commitResult.stdout}` };
            }
            const logResult = spawnSync('git', ['log', '--oneline', '-1'], {
                cwd: this.projectRoot,
                encoding: 'utf8',
            });
            const commitHash = logResult.stdout.trim().split(' ')[0];
            return { merged: true, commitHash };
        }
        catch (err) {
            // If merge itself fails (not just checks), abort
            try {
                spawnSync('git', ['merge', '--abort'], { cwd: this.projectRoot, encoding: 'utf8' });
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
     *
     * Uses spawnSync with arg arrays for shell injection safety.
     * Uses configured merge base, falling back to smart detection.
     */
    async detectHiddenOverlaps(branch, scopeWrite, otherScopes) {
        const hidden = [];
        try {
            // Determine merge base (configurable, no hard-coded origin/master)
            const mergeBase = await this.getMergeBase();
            // Validate branch name before using it in git commands
            assertSafeIdentifier(branch, 'branch');
            const currentFiles = spawnSync('git', ['diff', '--name-only', `${mergeBase}..${branch}`], {
                cwd: this.projectRoot,
                encoding: 'utf8',
            }).stdout.split('\n').filter(Boolean);
            const mq = this.state.getMergeQueue();
            for (const otherItem of mq.items) {
                if (otherItem.merge_status === 'merged' || otherItem.merge_status === 'failed')
                    continue;
                if (otherItem.story_id === branch)
                    continue; // Skip self
                try {
                    assertSafeIdentifier(otherItem.branch, 'branch');
                    const otherFiles = spawnSync('git', ['diff', '--name-only', `${mergeBase}..${otherItem.branch}`], {
                        cwd: this.projectRoot,
                        encoding: 'utf8',
                    }).stdout.split('\n').filter(Boolean);
                    const otherScope = otherScopes.get(otherItem.story_id) ?? [];
                    const overlaps = detectHiddenOverlapsFromFileLists(currentFiles, otherFiles, scopeWrite, otherScope);
                    for (const f of overlaps) {
                        hidden.push(`${f} (also modified by ${otherItem.story_id})`);
                    }
                }
                catch { /* skip items that can't be diffed or fail validation */ }
            }
        }
        catch { /* Best-effort detection */ }
        return hidden;
    }
    /**
     * Determine the merge base for diff comparisons.
     * Tries: configured base → scope-freeze/pre-implementation tag → detected main branch.
     */
    async getMergeBase() {
        // Check for scope freeze tag first
        const tagResult = spawnSync('git', ['tag', '--list', 'scope-freeze/pre-implementation'], {
            cwd: this.projectRoot,
            encoding: 'utf8',
        });
        if (tagResult.stdout.trim()) {
            return 'scope-freeze/pre-implementation';
        }
        // Try to detect main branch
        for (const candidate of ['origin/master', 'origin/main', 'master', 'main']) {
            const checkResult = spawnSync('git', ['rev-parse', '--verify', candidate], {
                cwd: this.projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
            });
            if (checkResult.status === 0 && checkResult.stdout.trim()) {
                return candidate;
            }
        }
        // Fallback: use head of current branch as merge base
        return 'HEAD';
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