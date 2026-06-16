import { spawnSync } from 'child_process';
import { SprintStatusManager } from './sprint-status.js';
import { Track, MergeQueueItem, ScopeLockConfig } from './types.js';
import {
  validateActualChangesAgainstScope,
  applyEnforcementMode,
  summarizeViolations,
} from './scope-lock.js';

/**
 * Dependency-ordered merge queue for Phase 4.
 * Stories enter queue after CODE_ACCEPTED/UI_ACCEPTED, merge in dependency order during Phase 4.13.
 */
export class MergeQueueManager {
  private state: SprintStatusManager;
  private projectRoot: string;
  private scopeLockConfig: ScopeLockConfig | null;

  constructor(
    state: SprintStatusManager,
    projectRoot: string,
    scopeLockConfig?: ScopeLockConfig | null,
  ) {
    this.state = state;
    this.projectRoot = projectRoot;
    this.scopeLockConfig = scopeLockConfig ?? null;
  }

  /**
   * Enqueue a story after it reaches acceptance state.
   * Validates all identifiers and commands before enqueueing.
   */
  async enqueue(
    storyId: string,
    track: Track,
    branch: string,
    dependsOn: string[],
    integrationChecks: string[],
    mergeOrder?: number
  ): Promise<void> {
    const mq = this.state.getMergeQueue();
    const existing = mq.items.find(i => i.story_id === storyId);
    if (existing) return;

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
    } as MergeQueueItem);

    await this.state.enqueueMerge({
      queue_item_id: queueItemId,
      story_id: storyId,
      branch,
      depends_on: dependsOn,
      merge_order: order,
      integration_checks: integrationChecks,
    });

    appendAudit(this.projectRoot, 'merge_enqueue', {
      status: 'info',
      story_id: storyId,
      message: `enqueued ${storyId} on ${branch} (order ${order})`,
      details: { track, depends_on: dependsOn, queue_item_id: queueItemId },
    });
  }

  /**
   * Re-evaluate dependency statuses and update merge item states.
   */
  async reconcileDependencies(): Promise<{ ready: MergeQueueItem[]; waiting: MergeQueueItem[] }> {
    const mq = this.state.getMergeQueue();
    const mergedIds = new Set(
      mq.items.filter(i => i.merge_status === 'merged').map(i => i.story_id)
    );

    const ready: MergeQueueItem[] = [];
    const waiting: MergeQueueItem[] = [];

    for (const item of mq.items) {
      if (item.merge_status === 'merged' || item.merge_status === 'failed') continue;
      if (item.merge_status === 'merging') continue;

      const depsMet = item.depends_on.every(depId => mergedIds.has(depId));

      if (depsMet && item.merge_status !== 'queued') {
        item.merge_status = 'queued';
        await this.state.updateMergeItem(item.story_id, { merge_status: 'queued' });
        ready.push(item);
      } else if (depsMet) {
        ready.push(item);
      } else {
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
   * Task 7: Pre-merge scope-lock check inserted *before* the no-commit merge
   * is attempted. If the branch diff includes files outside the story's
   * declared scope_write (or hits forbidden_paths), the merge aborts with
   * `merge_failed_reason = "scope-lock violation: …"`. Honours
   * `enforcement_mode`:
   *   - strict      → block, mark merge_status=failed.
   *   - warning     → audit + continue.
   *   - permissive  → silently continue.
   */
  async attemptAtomicMerge(item: MergeQueueItem): Promise<{ merged: boolean; commitHash?: string; error?: string }> {
    const { execSync } = await import('child_process');

    // ── Step 0: Scope-Lock pre-merge gate (Task 7, post-merge stage) ──
    const scopeBlock = await this.runScopeLockPreMergeGate(item);
    if (scopeBlock) {
      await this.state.updateMergeItem(item.story_id, {
        merge_status: 'failed',
        merge_failed_reason: scopeBlock,
      });
      return { merged: false, error: scopeBlock };
    }

    try {
      // Step 1: Merge without committing
      execSync(`git merge ${item.branch} --no-commit --no-ff`, { cwd: this.projectRoot, stdio: 'pipe', timeout: 60_000 });

      // Step 2: Run integration checks
      const checks = item.integration_checks.length > 0 ? item.integration_checks : ['npm run test', 'npm run build'];
      for (const check of checks) {
        try {
          execSync(check, { cwd: this.projectRoot, stdio: 'pipe', timeout: 120_000 });
        } catch {
          // Step 3a: Abort — no partial merge
          execSync('git merge --abort', { cwd: this.projectRoot, stdio: 'pipe' });
          await this.state.updateMergeItem(item.story_id, { merge_status: 'failed', merge_failed_reason: `Integration check failed: ${check}` });
          appendAudit(this.projectRoot, 'merge_abort', {
            status: 'fail',
            story_id: item.story_id,
            message: `integration check failed: ${check}`,
            details: { branch: item.branch, failed_check: check },
          });
          return { merged: false, error: `Integration check failed: ${check}` };
        }
      }

      // Step 2: Run integration checks via the safe acceptance runner.
      // Each declared command is validated against the allowlist +
      // denylist before launch and executed without a shell. If any
      // command fails (including validation rejection), abort the
      // merge so main never sees a partial state.
      const checks =
        item.integration_checks.length > 0
          ? item.integration_checks
          : ['npm test', 'npm run build'];
      const report = await runAcceptanceChecks(checks, {
        cwd: this.projectRoot,
        timeout_ms: 5 * 60_000,
      });
      if (!report.all_passed) {
        const failed = report.results.find((r) => !r.passed);
        const reason = failed
          ? `${failed.command} (${failed.error ?? `exit ${failed.exit_code}`})`
          : 'unknown failure';
        // Step 3a: Abort — no partial merge
        execSync('git merge --abort', { cwd: this.projectRoot, stdio: 'pipe' });
        await this.state.updateMergeItem(item.story_id, {
          merge_status: 'failed',
          merge_failed_reason: `Integration check failed: ${reason}`,
        });
        return { merged: false, error: `Integration check failed: ${reason}` };
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

      const log = execSync('git log --oneline -1', { cwd: this.projectRoot, encoding: 'utf-8', stdio: 'pipe' });
      const commitHash = log.trim().split(' ')[0];
      appendAudit(this.projectRoot, 'merge_success', {
        status: 'pass',
        story_id: item.story_id,
        message: `merged ${item.branch} → ${commitHash}`,
        details: { commit: commitHash, branch: item.branch },
      });
      return { merged: true, commitHash };
    } catch (err: any) {
      // If merge itself fails (not just checks), abort
      try { execSync('git merge --abort', { cwd: this.projectRoot, stdio: 'pipe' }); } catch {}
      appendAudit(this.projectRoot, 'merge_abort', {
        status: 'fail',
        story_id: item.story_id,
        message: `merge aborted: ${err.message ?? String(err)}`,
        details: { branch: item.branch },
      });
      return { merged: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Pre-merge scope-lock gate — compares the branch's actual diff against
   * the story's declared `scope_write` (read from
   * `global_state.development_order`) and the configured forbidden_paths.
   *
   * Returns a non-empty string when the merge MUST be blocked; null
   * otherwise.
   */
  private async runScopeLockPreMergeGate(item: MergeQueueItem): Promise<string | null> {
    const cfg = this.scopeLockConfig;
    if (!cfg || !cfg.enabled) return null;

    const order = this.state.data.global_state.development_order ?? [];
    const story = order.find((s) => s.story_id === item.story_id);
    if (!story) {
      // Cannot validate — log and continue conservatively.
      await this.state.appendAudit('scope_lock_pre_merge', {
        story_id: item.story_id,
        decision: 'skip',
        reason: 'story not found in development_order',
      });
      return null;
    }

    let changed: string[] = [];
    try {
      const { execSync } = await import('child_process');
      // Diff branch against the merge-base with master/main. Try both refs.
      let diffOut = '';
      try {
        diffOut = execSync(
          `git diff --name-only $(git merge-base HEAD ${item.branch})..${item.branch}`,
          { cwd: this.projectRoot, encoding: 'utf8', stdio: 'pipe', shell: '/bin/sh' as any },
        );
      } catch {
        // Fallback: simple two-dot diff between current HEAD and branch.
        diffOut = execSync(
          `git diff --name-only HEAD..${item.branch}`,
          { cwd: this.projectRoot, encoding: 'utf8', stdio: 'pipe' },
        );
      }
      changed = diffOut.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch (err: any) {
      // Best-effort: if we cannot resolve a diff, do not block on it. Audit and continue.
      await this.state.appendAudit('scope_lock_pre_merge', {
        story_id: item.story_id,
        decision: 'skip',
        reason: `diff failed: ${err?.message ?? String(err)}`,
      });
      return null;
    }

    const result = validateActualChangesAgainstScope(changed, story.scope_write ?? [], cfg);
    const outcome = applyEnforcementMode(result, cfg.enforcement_mode);

    if (result.violations.length > 0) {
      await this.state.appendAudit('scope_lock_pre_merge', {
        story_id: item.story_id,
        decision: outcome.should_block ? 'block' : 'warn',
        enforcement_mode: cfg.enforcement_mode,
        violations: result.violations,
        summary: summarizeViolations(result.violations),
      });
    }

    if (outcome.should_block) {
      return `scope-lock violation: ${summarizeViolations(outcome.reported)}`;
    }
    return null;
  }

  /**
   * Get the next ready item from the merge queue (by merge_order).
   */
  async getNextReady(): Promise<MergeQueueItem | undefined> {
    const { ready } = await this.reconcileDependencies();
    ready.sort((a: MergeQueueItem, b: MergeQueueItem) => a.merge_order - b.merge_order);
    return ready.find((i: MergeQueueItem) => i.merge_status === 'queued');
  }

  /**
   * Mark an item as being merged.
   */
  async markMerging(storyId: string): Promise<void> {
    await this.state.updateMergeItem(storyId, { merge_status: 'merging' });
  }

  /**
   * Mark a merge as successful.
   */
  async markMerged(storyId: string, commitHash: string): Promise<void> {
    await this.state.updateMergeItem(storyId, {
      merge_status: 'merged',
      merged_at: new Date().toISOString(),
      merge_commit: commitHash,
    });
  }

  /**
   * Mark a merge as failed.
   */
  async markFailed(storyId: string, reason: string): Promise<void> {
    await this.state.updateMergeItem(storyId, {
      merge_status: 'failed',
      merge_failed_reason: reason,
    });
  }

  /**
   * Calculate the next merge_order value (increments by 10).
   */
  private nextMergeOrder(): number {
    const mq = this.state.getMergeQueue();
    if (mq.items.length === 0) return 10;
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
  async detectHiddenOverlaps(branch: string, scopeWrite: string[], otherScopes: Map<string, string[]>): Promise<string[]> {
    const hidden: string[] = [];
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
        if (otherItem.merge_status === 'merged' || otherItem.merge_status === 'failed') continue;
        if (otherItem.story_id === branch) continue; // Skip self

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
        } catch { /* skip items that can't be diffed or fail validation */ }
      }
    } catch { /* Best-effort detection */ }
    return hidden;
  }

  /**
   * Determine the merge base for diff comparisons.
   * Tries: configured base → scope-freeze/pre-implementation tag → detected main branch.
   */
  private async getMergeBase(): Promise<string> {
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

  displayQueue(): string {
    const mq = this.state.getMergeQueue();
    const lines = [
      '═══════════════════════════════════════════',
      'Merge Queue Status',
      '═══════════════════════════════════════════',
      'Order  Story ID      Unit     Status              Depends On',
      '────── ────────────  ───────  ──────────────────  ──────────',
    ];

    const statusIcons: Record<string, string> = {
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
      lines.push(
        `${String(item.merge_order).padEnd(6)} ${item.story_id.padEnd(14)} ${unit.padEnd(8)} ${icon.padEnd(20)} ${deps}`
      );
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
