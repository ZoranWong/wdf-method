// State Snapshot & Time Travel System
//
// Creates named snapshots at key lifecycle points (Phase LOCKED, gate failure,
// manual trigger). Each snapshot captures state files + artifact checksums +
// git HEAD, enabling full project-state time travel.
//
// Snapshot storage layout:
//   _wdf_output/status/snapshots/{snapshot_name}/
//     manifest.yaml    — metadata (reason, time, phase, git HEAD, checksums)
//     global.yaml      — global state copy
//     phase-0N.yaml    — phase state copies
//     checksums.yaml   — artifact sha256 digests

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  rmSync,
} from 'fs';
import { join, resolve, basename } from 'path';
import { createHash } from 'crypto';
import { execSync, execFileSync } from 'child_process';
import YAML from 'js-yaml';

// ── Types ──────────────────────────────────────────────────────

export interface SnapshotManifest {
  name: string;
  reason: string;
  created_at: string;
  phase: number | null;
  git_head: string;
  artifacts: Record<string, string>; // path → sha256
  status_files: string[];
  context?: Record<string, unknown>;
}

export interface SnapshotListItem {
  name: string;
  reason: string;
  created_at: string;
  phase: number | null;
  git_head_short: string;
}

export interface SnapshotPrunePolicy {
  keepRecent: number; // Keep N most recent snapshots
  keepPhaseNodes: boolean; // Always keep Phase LOCKED snapshots
  maxAgeDays?: number; // Remove snapshots older than this
}

const DEFAULT_PRUNE_POLICY: SnapshotPrunePolicy = {
  keepRecent: 10,
  keepPhaseNodes: true,
  maxAgeDays: 30,
};

// ── Snapshot Creation ──────────────────────────────────────────

/** Artifact paths (relative to _wdf_output) to checksum in snapshots. */
const SNAPSHOT_ARTIFACTS = [
  'prd.md',
  'architecture.md',
  'api-spec.yaml',
  'db-schema.md',
  'epics.md',
  '_output/planning/product-brief.md',
  '_output/planning/story-map.md',
  '_output/planning/design-tokens.md',
  '_output/solutioning/system-context.md',
  '_output/solutioning/container-design.md',
];

/** Status files to copy into the snapshot. */
const STATUS_FILES = [
  'global.yaml',
  'phase-01.yaml',
  'phase-02.yaml',
  'phase-03.yaml',
  'phase-04-be.yaml',
  'phase-04-fe.yaml',
  'change-requests.yaml',
];

/**
 * Create a named snapshot of the current project state.
 *
 * @param name — unique snapshot name (e.g. "phase-03-locked-2026-06-18T10-00-00")
 * @param reason — human-readable description
 * @param projectRoot — absolute path to the project root
 * @param context — optional extra metadata
 */
export function createSnapshot(
  name: string,
  reason: string,
  projectRoot: string,
  context?: { phase?: number; [key: string]: unknown },
): string {
  const outputDir = resolveOutputDir(projectRoot);
  const statusDir = join(outputDir, 'status');
  const snapshotsDir = join(statusDir, 'snapshots');
  const snapDir = join(snapshotsDir, name);

  if (existsSync(snapDir)) {
    throw new Error(`Snapshot "${name}" already exists`);
  }

  mkdirSync(snapDir, { recursive: true });

  // 1. Copy status files
  const statusFilesCopied: string[] = [];
  for (const f of STATUS_FILES) {
    const src = join(statusDir, f);
    if (existsSync(src)) {
      copyFileSync(src, join(snapDir, f));
      statusFilesCopied.push(f);
    }
  }

  // 2. Compute artifact checksums
  const artifacts: Record<string, string> = {};
  for (const relPath of SNAPSHOT_ARTIFACTS) {
    const fullPath = join(outputDir, relPath);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath);
      artifacts[relPath] = createHash('sha256').update(content).digest('hex');
    }
  }

  // 3. Get current git HEAD
  let gitHead = '';
  try {
    gitHead = execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();
  } catch {
    gitHead = 'unknown';
  }

  // 4. Write manifest
  const manifest: SnapshotManifest = {
    name,
    reason,
    created_at: new Date().toISOString(),
    phase: context?.phase ?? null,
    git_head: gitHead,
    artifacts,
    status_files: statusFilesCopied,
    context: context ?? {},
  };

  writeFileSync(join(snapDir, 'manifest.yaml'), YAML.dump(manifest), 'utf-8');

  // 5. Write checksums separately for easy diffing
  writeFileSync(join(snapDir, 'checksums.yaml'), YAML.dump(artifacts), 'utf-8');

  return snapDir;
}

// ── Snapshot Listing ───────────────────────────────────────────

/**
 * List all snapshots, sorted by creation time (newest first).
 */
export function listSnapshots(projectRoot: string): SnapshotListItem[] {
  const outputDir = resolveOutputDir(projectRoot);
  const snapshotsDir = join(outputDir, 'status', 'snapshots');

  if (!existsSync(snapshotsDir)) return [];

  const items: SnapshotListItem[] = [];
  for (const entry of readdirSync(snapshotsDir)) {
    const snapDir = join(snapshotsDir, entry);
    if (!statSync(snapDir).isDirectory()) continue;

    const manifestPath = join(snapDir, 'manifest.yaml');
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest = YAML.load(
        readFileSync(manifestPath, 'utf-8'),
      ) as SnapshotManifest;
      items.push({
        name: manifest.name,
        reason: manifest.reason,
        created_at: manifest.created_at,
        phase: manifest.phase,
        git_head_short: manifest.git_head.slice(0, 7),
      });
    } catch {
      // Skip corrupt snapshots
    }
  }

  // Sort newest first
  items.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return items;
}

// ── Snapshot Restoration ───────────────────────────────────────

export interface RestoreOptions {
  /** If true, only show what would happen without making changes. */
  dryRun?: boolean;
  /** If true, skip the confirmation prompt. */
  force?: boolean;
  /**
   * If true, restore the state directory ONLY — do not touch git HEAD.
   * Use for "replay": inspecting a past FSM snapshot without rewinding code.
   */
  stateOnly?: boolean;
}

export interface RestoreResult {
  success: boolean;
  snapshotName: string;
  gitHeadBefore: string;
  gitHeadAfter: string;
  filesRestored: string[];
  warnings: string[];
}

/**
 * Restore project state from a named snapshot.
 *
 * Steps:
 *   1. git stash (preserve uncommitted changes)
 *   2. git checkout <snapshot.git_head>
 *   3. Copy snapshot status files back to status/
 *   4. Report restored files
 *
 * In dryRun mode, only reports what would happen.
 */
export function restoreSnapshot(
  name: string,
  projectRoot: string,
  options: RestoreOptions = {},
): RestoreResult {
  const outputDir = resolveOutputDir(projectRoot);
  const snapDir = join(outputDir, 'status', 'snapshots', name);

  if (!existsSync(snapDir)) {
    throw new Error(`Snapshot "${name}" not found`);
  }

  const manifestPath = join(snapDir, 'manifest.yaml');
  if (!existsSync(manifestPath)) {
    throw new Error(`Snapshot "${name}" has no manifest — corrupt snapshot`);
  }

  const manifest = YAML.load(
    readFileSync(manifestPath, 'utf-8'),
  ) as SnapshotManifest;

  const warnings: string[] = [];
  const filesRestored: string[] = [];

  // Get current git HEAD for the result
  let gitHeadBefore = '';
  try {
    gitHeadBefore = execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();
  } catch {
    gitHeadBefore = 'unknown';
  }

  if (options.dryRun) {
    return {
      success: true,
      snapshotName: name,
      gitHeadBefore,
      gitHeadAfter: manifest.git_head,
      filesRestored: manifest.status_files,
      warnings: [...warnings, 'DRY RUN — no changes made'],
    };
  }

  // 1. Stash uncommitted changes
  if (!options.stateOnly) {
    try {
      execSync('git stash push -m "wdf snapshot restore: before restoring to snapshot"', {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
    } catch (stashErr: any) {
      if (!stashErr.message?.includes('No local changes to save')) {
        warnings.push(`git stash warning: ${stashErr.message}`);
      }
    }
  }

  // 2. Checkout the snapshot's git HEAD (skipped in state-only / replay mode)
  if (!options.stateOnly && manifest.git_head && manifest.git_head !== 'unknown') {
    try {
      // Use execFileSync (not execSync with template string) to avoid shell
      // injection — manifest.git_head is external input that could contain
      // metacharacters. Constitution §2.5 forbids unparameterized shell exec.
      execFileSync('git', ['checkout', manifest.git_head], {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (checkoutErr: any) {
      // Attempt to restore stash
      try {
        execSync('git stash pop', { cwd: projectRoot, stdio: 'pipe' });
      } catch {
        /* best effort */
      }
      throw new Error(
        `Failed to checkout git commit ${manifest.git_head.slice(0, 7)}: ${checkoutErr.message}`,
      );
    }
  } else if (options.stateOnly) {
    warnings.push('state-only mode: git HEAD untouched (replay semantics)');
  } else {
    warnings.push('Snapshot has no valid git HEAD — only restoring status files');
  }

  // 3. Copy status files from snapshot back to status/
  const statusDir = join(outputDir, 'status');
  for (const f of manifest.status_files) {
    const src = join(snapDir, f);
    const dst = join(statusDir, f);
    if (existsSync(src)) {
      copyFileSync(src, dst);
      filesRestored.push(f);
    }
  }

  // Get current git HEAD after operation
  let gitHeadAfter = '';
  try {
    gitHeadAfter = execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();
  } catch {
    gitHeadAfter = 'unknown';
  }

  return {
    success: true,
    snapshotName: name,
    gitHeadBefore,
    gitHeadAfter,
    filesRestored,
    warnings,
  };
}

/**
 * Replay = state-only restore. Reverts FSM state files from the snapshot
 * without touching git HEAD. Use this for "what was the FSM at this point"
 * inspection or to retry the workflow from a past checkpoint while keeping
 * the current code in place.
 */
export function replaySnapshot(
  name: string,
  projectRoot: string,
  options: Omit<RestoreOptions, 'stateOnly'> = {},
): RestoreResult {
  return restoreSnapshot(name, projectRoot, { ...options, stateOnly: true });
}

// ── Snapshot Pruning ───────────────────────────────────────────

export interface PruneResult {
  kept: string[];
  removed: string[];
}

/**
 * Prune old snapshots according to the given policy.
 */
export function pruneSnapshots(
  projectRoot: string,
  policy: Partial<SnapshotPrunePolicy> = {},
): PruneResult {
  const effectivePolicy = { ...DEFAULT_PRUNE_POLICY, ...policy };
  const all = listSnapshots(projectRoot);

  if (all.length <= effectivePolicy.keepRecent) {
    return { kept: all.map((s) => s.name), removed: [] };
  }

  const outputDir = resolveOutputDir(projectRoot);
  const snapshotsDir = join(outputDir, 'status', 'snapshots');

  // Partition: phase-locked snapshots are protected (if keepPhaseNodes)
  let candidates = all;
  const protectedSnaps: SnapshotListItem[] = [];

  if (effectivePolicy.keepPhaseNodes) {
    protectedSnaps.push(
      ...all.filter((s) => s.reason.startsWith('phase-') && s.reason.includes('locked')),
    );
    candidates = all.filter(
      (s) => !(s.reason.startsWith('phase-') && s.reason.includes('locked')),
    );
  }

  // Sort by creation time (newest first) and keep most recent N
  const toRemove: string[] = [];
  const toKeep: string[] = [...protectedSnaps.map((s) => s.name)];

  for (let i = 0; i < candidates.length; i++) {
    if (toKeep.length < effectivePolicy.keepRecent) {
      toKeep.push(candidates[i].name);
    } else {
      // Also check max age
      const ageDays =
        (Date.now() - new Date(candidates[i].created_at).getTime()) /
        (1000 * 60 * 60 * 24);
      if (
        effectivePolicy.maxAgeDays &&
        ageDays > effectivePolicy.maxAgeDays
      ) {
        toRemove.push(candidates[i].name);
      } else if (toKeep.length >= effectivePolicy.keepRecent) {
        toRemove.push(candidates[i].name);
      } else {
        toKeep.push(candidates[i].name);
      }
    }
  }

  // Execute removal
  for (const name of toRemove) {
    const dir = join(snapshotsDir, name);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return { kept: toKeep, removed: toRemove };
}

// ── Auto-Snapshot Triggers ─────────────────────────────────────

/**
 * Create a snapshot automatically when a phase transitions to LOCKED.
 */
export function autoSnapshotPhaseLocked(
  phase: number,
  projectRoot: string,
): string | null {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `phase-0${phase}-locked-${timestamp}`;
    return createSnapshot(name, `Auto-snapshot: Phase ${phase} LOCKED`, projectRoot, {
      phase,
      trigger: 'phase_locked',
    });
  } catch (err: any) {
    console.error(`Auto-snapshot failed: ${err.message}`);
    return null;
  }
}

/**
 * Create a snapshot on gate failure for debugging.
 */
export function autoSnapshotGateFailure(
  phase: number,
  gateId: string,
  projectRoot: string,
): string | null {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `failure-phase-0${phase}-${gateId}-${timestamp}`;
    return createSnapshot(
      name,
      `Auto-snapshot: Phase ${phase} gate failure (${gateId})`,
      projectRoot,
      { phase, trigger: 'gate_failure', gate_id: gateId },
    );
  } catch (err: any) {
    console.error(`Auto-snapshot on gate failure failed: ${err.message}`);
    return null;
  }
}

/**
 * Create a snapshot at the start of workflow execution.
 */
export function autoSnapshotBuildStart(projectRoot: string): string | null {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `build-start-${timestamp}`;
    return createSnapshot(name, 'Auto-snapshot: workflow start', projectRoot, {
      trigger: 'build_start',
    });
  } catch (err: any) {
    console.error(`Auto-snapshot failed: ${err.message}`);
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────

/** Resolve _wdf_output directory. Tries _wdf_output first, then _bmad-output/web-dev-flow. */
function resolveOutputDir(projectRoot: string): string {
  const wdfOutput = join(projectRoot, '_wdf_output');
  if (existsSync(wdfOutput)) return wdfOutput;

  const bmadOutput = join(projectRoot, '_bmad-output', 'web-dev-flow');
  if (existsSync(bmadOutput)) return bmadOutput;

  // Default to _wdf_output (it will be created when the project initializes)
  return wdfOutput;
}
