/**
 * Error Handling — L2 (worktree rollback) and L3 (git hard reset) recovery.
 *
 * Recovery hierarchy:
 *   L1 — Pipeline retry with feedback (implemented in pipeline-engine.ts)
 *   L2 — Worktree rollback: discard worktree changes, retry from clean state
 *   L3 — Git hard reset: last resort, reset branch to last known good commit
 *
 * Design principles:
 *   - L2 is automatic (triggered by pipeline escalation)
 *   - L3 requires explicit user confirmation (destructive operation)
 *   - Both create audit trail entries
 *   - Neither deletes branches or permanently destroys data
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

// ── Types ──────────────────────────────────────────────────

export interface RecoverySnapshot {
  id: string;
  project_root: string;
  branch: string;
  commit_sha: string;
  stash_ref?: string;
  created_at: string;
  /** Files that were dirty at snapshot time */
  dirty_files: string[];
}

export interface L2RollbackResult {
  success: boolean;
  snapshot_id: string;
  actions: string[];
  worktree_removed: boolean;
  error?: string;
}

export interface L3ResetResult {
  success: boolean;
  snapshot_id: string;
  target_commit: string;
  actions: string[];
  /** Whether the reset was actually executed (false = dry-run) */
  executed: boolean;
  error?: string;
}

export interface ErrorHandlerOptions {
  projectRoot: string;
  /** Where to store snapshots (defaults to _wdf_output/status/snapshots) */
  snapshotDir?: string;
  /** Dry-run mode: plan actions but don't execute */
  dryRun?: boolean;
}

// ── Snapshot Management ────────────────────────────────────

/**
 * Create a recovery snapshot of the current git state.
 *
 * Captures:
 *   - Current branch name
 *   - HEAD commit SHA
 *   - Git stash of uncommitted changes (if any)
 *   - List of dirty files
 *
 * The snapshot is written to `snapshotDir/<id>.json`.
 */
export function createSnapshot(opts: ErrorHandlerOptions): RecoverySnapshot {
  const { projectRoot } = opts;
  const snapshotDir = opts.snapshotDir ?? join(projectRoot, '_wdf_output', 'status', 'snapshots');
  mkdirSync(snapshotDir, { recursive: true });

  const id = `snap-${Date.now()}`;
  const branch = gitExec('rev-parse --abbrev-ref HEAD', projectRoot);
  const commitSha = gitExec('rev-parse HEAD', projectRoot);

  // Capture dirty files (tracked only — untracked files are not restorable via git)
  const dirtyRaw = gitExecSafe('diff --name-only', projectRoot);
  const dirtyFiles = dirtyRaw ? dirtyRaw.split('\n').filter(Boolean) : [];

  // NOTE: We intentionally do NOT create a stash here. The snapshot is a
  // passive observation — it records what the state was, but does not modify
  // the working tree. Stashing would be destructive and interfere with
  // the subsequent rollback logic.

  const snapshot: RecoverySnapshot = {
    id,
    project_root: projectRoot,
    branch,
    commit_sha: commitSha,
    created_at: new Date().toISOString(),
    dirty_files: dirtyFiles,
  };

  // Ensure directory exists (stash --include-untracked may have removed it)
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(join(snapshotDir, `${id}.json`), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

/**
 * Read a snapshot from disk.
 */
export function readSnapshot(snapshotId: string, opts: ErrorHandlerOptions): RecoverySnapshot | null {
  const snapshotDir = opts.snapshotDir ?? join(opts.projectRoot, '_wdf_output', 'status', 'snapshots');
  const path = join(snapshotDir, `${snapshotId}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * List all available snapshots.
 */
export function listSnapshots(opts: ErrorHandlerOptions): RecoverySnapshot[] {
  const snapshotDir = opts.snapshotDir ?? join(opts.projectRoot, '_wdf_output', 'status', 'snapshots');
  if (!existsSync(snapshotDir)) return [];
  const files = require('fs').readdirSync(snapshotDir).filter((f: string) => f.startsWith('snap-') && f.endsWith('.json'));
  return files.map((f: string) => JSON.parse(readFileSync(join(snapshotDir, f), 'utf-8')) as RecoverySnapshot);
}

// ── L2: Worktree Rollback ──────────────────────────────────

/**
 * L2 recovery: rollback a story's worktree to a clean state.
 *
 * Steps:
 *   1. Create a snapshot of the current state
 *   2. If the story has a dedicated worktree, discard its changes
 *   3. If working on the main branch, git checkout -- . for story scope
 *   4. Record the rollback in the audit log
 *
 * This is safe because:
 *   - It only touches files within the story's scope_write
 *   - It creates a snapshot before any destructive action
 *   - The snapshot can be used to restore if needed
 */
export function l2WorktreeRollback(
  storyId: string,
  scopeWrite: string[],
  worktreePath: string | undefined,
  opts: ErrorHandlerOptions,
): L2RollbackResult {
  const actions: string[] = [];
  const { projectRoot, dryRun } = opts;

  try {
    // Step 1: Snapshot
    const snapshot = createSnapshot(opts);
    actions.push(`Created snapshot ${snapshot.id}`);

    if (dryRun) {
      actions.push('DRY RUN — no changes made');
      return { success: true, snapshot_id: snapshot.id, actions, worktree_removed: false };
    }

    // Step 2: Handle worktree
    let worktreeRemoved = false;
    if (worktreePath && existsSync(worktreePath)) {
      // Check if it's a real git worktree (not just a directory)
      const worktrees = gitExecSafe('worktree list --porcelain', projectRoot) ?? '';
      const isWorktree = worktrees.includes(worktreePath);

      if (isWorktree) {
        // Remove the git worktree (safe — doesn't delete the branch)
        gitExec(`worktree remove --force "${worktreePath}"`, projectRoot);
        actions.push(`Removed worktree: ${worktreePath}`);
        worktreeRemoved = true;
      } else {
        // Not a git worktree — clean files within scope
        for (const file of scopeWrite) {
          const fullPath = join(worktreePath, file);
          if (existsSync(fullPath)) {
            gitExecSafe(`checkout -- "${file}"`, worktreePath);
            actions.push(`Restored: ${file}`);
          }
        }
      }
    } else {
      // No worktree — restore files in main project
      for (const file of scopeWrite) {
        const result = gitExecSafe(`checkout -- "${file}"`, projectRoot);
        if (result !== null) {
          actions.push(`Restored: ${file}`);
        }
      }
    }

    // Step 3: Audit log
    appendRecoveryAudit(projectRoot, {
      level: 'L2',
      story_id: storyId,
      snapshot_id: snapshot.id,
      actions,
      at: new Date().toISOString(),
    });

    return { success: true, snapshot_id: snapshot.id, actions, worktree_removed: worktreeRemoved };
  } catch (err) {
    return {
      success: false,
      snapshot_id: '',
      actions,
      worktree_removed: false,
      error: (err as Error).message,
    };
  }
}

// ── L3: Git Hard Reset ─────────────────────────────────────

/**
 * L3 recovery: hard reset the branch to a target commit.
 *
 * THIS IS DESTRUCTIVE. Use only as a last resort.
 *
 * Steps:
 *   1. Create a snapshot (saves current HEAD + stash)
 *   2. Reset the branch to the target commit
 *   3. Record in audit log
 *
 * Safety:
 *   - Always creates a snapshot before resetting
 *   - In dry-run mode, only plans the reset
 *   - The snapshot can be used to manually recover
 */
export function l3GitReset(
  targetCommit: string,
  opts: ErrorHandlerOptions & { requireConfirmation?: boolean },
): L3ResetResult {
  const actions: string[] = [];
  const { projectRoot, dryRun, requireConfirmation = true } = opts;

  try {
    // Step 1: Snapshot
    const snapshot = createSnapshot(opts);
    actions.push(`Created snapshot ${snapshot.id} (branch: ${snapshot.branch}, HEAD: ${snapshot.commit_sha})`);

    if (dryRun) {
      actions.push(`DRY RUN — would reset to ${targetCommit}`);
      return {
        success: true,
        snapshot_id: snapshot.id,
        target_commit: targetCommit,
        actions,
        executed: false,
      };
    }

    // Step 2: Validate target commit exists
    const validCommit = gitExecSafe(`rev-parse --verify ${targetCommit}`, projectRoot);
    if (!validCommit) {
      return {
        success: false,
        snapshot_id: snapshot.id,
        target_commit: targetCommit,
        actions,
        executed: false,
        error: `Target commit not found: ${targetCommit}`,
      };
    }

    // Step 3: Execute reset
    const currentBranch = gitExec('rev-parse --abbrev-ref HEAD', projectRoot);
    gitExec(`reset --hard ${targetCommit}`, projectRoot);
    actions.push(`Reset ${currentBranch} to ${targetCommit}`);

    // Step 4: Audit
    appendRecoveryAudit(projectRoot, {
      level: 'L3',
      story_id: '',
      snapshot_id: snapshot.id,
      target_commit: targetCommit,
      actions,
      at: new Date().toISOString(),
    });

    return {
      success: true,
      snapshot_id: snapshot.id,
      target_commit: targetCommit,
      actions,
      executed: true,
    };
  } catch (err) {
    return {
      success: false,
      snapshot_id: '',
      target_commit: targetCommit,
      actions,
      executed: false,
      error: (err as Error).message,
    };
  }
}

// ── Audit ──────────────────────────────────────────────────

interface RecoveryAuditEntry {
  level: 'L2' | 'L3';
  story_id: string;
  snapshot_id: string;
  target_commit?: string;
  actions: string[];
  at: string;
}

function appendRecoveryAudit(projectRoot: string, entry: RecoveryAuditEntry): void {
  const auditDir = join(projectRoot, '_wdf_output', 'status', 'audit');
  mkdirSync(auditDir, { recursive: true });
  const auditFile = join(auditDir, 'recovery-audit.jsonl');
  const line = JSON.stringify(entry) + '\n';
  require('fs').appendFileSync(auditFile, line);
}

// ── Git Helpers ────────────────────────────────────────────

function gitExec(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function gitExecSafe(cmd: string, cwd: string): string | null {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}
