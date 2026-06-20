import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import YAML from 'js-yaml';
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  pruneSnapshots,
  autoSnapshotPhaseLocked,
  autoSnapshotGateFailure,
  autoSnapshotBuildStart,
  type SnapshotManifest,
} from './snapshot.js';

// Create a temp directory with a mock wdf project structure
function setupProject(): string {
  const root = join(tmpdir(), `wdf-snapshot-test-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  // Init git
  execSync('git init', { cwd: root });
  execSync('git config user.email "test@wdf.dev"', { cwd: root });
  execSync('git config user.name "WDF Test"', { cwd: root });

  // Create _wdf_output structure
  const wdfDir = join(root, '_wdf_output');
  mkdirSync(join(wdfDir, 'status'), { recursive: true });
  mkdirSync(join(wdfDir, 'status', 'stories'), { recursive: true });
  mkdirSync(join(wdfDir, 'status', 'merge-queue'), { recursive: true });

  // Create mock status files
  writeFileSync(
    join(wdfDir, 'status', 'global.yaml'),
    YAML.dump({
      project: 'test-project',
      workflow_version: '3.6.0',
      global_state: {
        current_phase: 2,
        requirements_frozen_at: '2026-06-18T10:00:00Z',
      },
    }),
    'utf-8',
  );

  writeFileSync(
    join(wdfDir, 'status', 'phase-01.yaml'),
    YAML.dump({ status: 'LOCKED', state_history: [] }),
    'utf-8',
  );

  writeFileSync(
    join(wdfDir, 'status', 'phase-02.yaml'),
    YAML.dump({ status: 'IN_PROGRESS', state_history: [] }),
    'utf-8',
  );

  // Create mock artifacts
  writeFileSync(
    join(wdfDir, 'prd.md'),
    '# PRD\n\nTest project PRD v1.0',
    'utf-8',
  );
  writeFileSync(
    join(wdfDir, 'architecture.md'),
    '# Architecture\n\nTest architecture',
    'utf-8',
  );

  // Initial commit
  execSync('git add -A', { cwd: root });
  execSync('git commit -m "initial"', { cwd: root });

  return root;
}

describe('snapshot', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = setupProject();
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // ── createSnapshot ─────────────────────────────────────

  describe('createSnapshot', () => {
    it('should create a snapshot directory with manifest and status files', () => {
      const dir = createSnapshot(
        'test-snap-1',
        'Test snapshot',
        projectRoot,
      );

      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, 'manifest.yaml'))).toBe(true);
      expect(existsSync(join(dir, 'global.yaml'))).toBe(true);
      expect(existsSync(join(dir, 'phase-01.yaml'))).toBe(true);
      expect(existsSync(join(dir, 'checksums.yaml'))).toBe(true);
    });

    it('should include artifact checksums', () => {
      const dir = createSnapshot('test-snap-2', 'With artifacts', projectRoot);
      const manifest = YAML.load(
        readFileSync(join(dir, 'manifest.yaml'), 'utf-8'),
      ) as SnapshotManifest;

      expect(manifest.artifacts['prd.md']).toBeTruthy();
      expect(manifest.artifacts['architecture.md']).toBeTruthy();
      // Verify checksum is a valid sha256
      expect(manifest.artifacts['prd.md']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should capture git HEAD', () => {
      const dir = createSnapshot('test-snap-3', 'Git head test', projectRoot);
      const manifest = YAML.load(
        readFileSync(join(dir, 'manifest.yaml'), 'utf-8'),
      ) as SnapshotManifest;

      expect(manifest.git_head).toBeTruthy();
      expect(manifest.git_head).not.toBe('unknown');
      expect(manifest.git_head.length).toBe(40); // Full SHA
    });

    it('should include reason and phase context', () => {
      const dir = createSnapshot(
        'test-snap-4',
        'Phase 3 done',
        projectRoot,
        { phase: 3, trigger: 'manual' },
      );
      const manifest = YAML.load(
        readFileSync(join(dir, 'manifest.yaml'), 'utf-8'),
      ) as SnapshotManifest;

      expect(manifest.reason).toBe('Phase 3 done');
      expect(manifest.phase).toBe(3);
      expect((manifest.context as any).trigger).toBe('manual');
    });

    it('should throw if snapshot already exists', () => {
      createSnapshot('dup-snap', 'First', projectRoot);
      expect(() =>
        createSnapshot('dup-snap', 'Second', projectRoot),
      ).toThrow('already exists');
    });

    it('should only snapshot status files that exist', () => {
      // phase-03.yaml doesn't exist — should not error
      const dir = createSnapshot('partial-snap', 'Partial', projectRoot);
      const manifest = YAML.load(
        readFileSync(join(dir, 'manifest.yaml'), 'utf-8'),
      ) as SnapshotManifest;

      expect(manifest.status_files).toContain('global.yaml');
      expect(manifest.status_files).toContain('phase-01.yaml');
      expect(manifest.status_files).toContain('phase-02.yaml');
      expect(manifest.status_files).not.toContain('phase-03.yaml');
    });
  });

  // ── listSnapshots ───────────────────────────────────────

  describe('listSnapshots', () => {
    it('should return empty list when no snapshots exist', () => {
      const list = listSnapshots(projectRoot);
      expect(list).toEqual([]);
    });

    it('should list snapshots sorted by creation time (newest first)', () => {
      createSnapshot('snap-a', 'First', projectRoot);
      // Small delay for distinct timestamps
      const snapB = createSnapshot('snap-b', 'Second', projectRoot);

      const list = listSnapshots(projectRoot);
      expect(list.length).toBe(2);
      expect(list[0].name).toBe('snap-b'); // newest first
      expect(list[1].name).toBe('snap-a');
      expect(list[0].reason).toBe('Second');
      expect(list[0].git_head_short).toHaveLength(7);
    });
  });

  // ── restoreSnapshot ────────────────────────────────────

  describe('restoreSnapshot', () => {
    it('should throw if snapshot does not exist', () => {
      expect(() =>
        restoreSnapshot('nonexistent', projectRoot),
      ).toThrow('not found');
    });

    it('should throw if snapshot has no manifest', () => {
      const snapDir = join(
        projectRoot,
        '_wdf_output',
        'status',
        'snapshots',
        'corrupt',
      );
      mkdirSync(snapDir, { recursive: true });
      writeFileSync(join(snapDir, 'some-file.txt'), 'garbage', 'utf-8');

      expect(() => restoreSnapshot('corrupt', projectRoot)).toThrow(
        'no manifest',
      );
    });

    it('should restore status files from snapshot', () => {
      // Create snapshot
      createSnapshot('restore-test', 'Pre-modification', projectRoot);

      // Modify and commit a status file
      const phase02 = join(projectRoot, '_wdf_output', 'status', 'phase-02.yaml');
      const originalContent = readFileSync(phase02, 'utf-8');
      writeFileSync(
        phase02,
        YAML.dump({ status: 'LOCKED', modified: true }),
        'utf-8',
      );
      execSync('git add -A && git commit -m "modified"', { cwd: projectRoot });

      // Restore
      const result = restoreSnapshot('restore-test', projectRoot, {
        force: true,
      });

      expect(result.success).toBe(true);

      // The git checkout restores the status files from the original commit.
      // The status files copy from snapshot is a safety net if files weren't in git.
      // Verify the file content is restored regardless.
      const restored = YAML.load(readFileSync(phase02, 'utf-8')) as any;
      expect(restored.status).toBe('IN_PROGRESS');
      expect(restored.modified).toBeUndefined();
    });

    it('should report dry-run without making changes', () => {
      createSnapshot('dry-run-snap', 'Dry run test', projectRoot);

      const phase02 = join(projectRoot, '_wdf_output', 'status', 'phase-02.yaml');
      writeFileSync(
        phase02,
        YAML.dump({ status: 'MODIFIED' }),
        'utf-8',
      );
      execSync('git add -A && git commit -m "modified"', { cwd: projectRoot });

      const result = restoreSnapshot('dry-run-snap', projectRoot, {
        dryRun: true,
        force: true,
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('DRY RUN — no changes made');

      // Verify file was NOT changed
      const after = YAML.load(readFileSync(phase02, 'utf-8')) as any;
      expect(after.status).toBe('MODIFIED');
    });
  });

  // ── pruneSnapshots ────────────────────────────────────

  describe('pruneSnapshots', () => {
    it('should keep snapshots within the keepRecent limit', () => {
      for (let i = 0; i < 5; i++) {
        createSnapshot(`snap-${i}`, `Snapshot ${i}`, projectRoot);
      }

      const result = pruneSnapshots(projectRoot, {
        keepRecent: 3,
        keepPhaseNodes: false,
      });

      expect(result.kept.length).toBe(3);
      expect(result.removed.length).toBe(2);
    });

    it('should protect phase-locked snapshots when keepPhaseNodes is true', () => {
      // Create 3 regular + 1 phase-locked snapshots
      createSnapshot('regular-1', 'Regular 1', projectRoot);
      createSnapshot(
        'phase-03-locked-special',
        'phase-03-locked-auto',
        projectRoot,
        { phase: 3, trigger: 'phase_locked' },
      );
      createSnapshot('regular-2', 'Regular 2', projectRoot);
      createSnapshot('regular-3', 'Regular 3', projectRoot);

      const result = pruneSnapshots(projectRoot, {
        keepRecent: 2,
        keepPhaseNodes: true,
      });

      // phase-03-locked should be protected
      expect(result.kept).toContain('phase-03-locked-special');
    });

    it('should return empty when no snapshots exist', () => {
      const result = pruneSnapshots(projectRoot);
      expect(result.kept).toEqual([]);
      expect(result.removed).toEqual([]);
    });
  });

  // ── Auto-snapshot Triggers ─────────────────────────────

  describe('auto-snapshot triggers', () => {
    it('autoSnapshotPhaseLocked should create a named phase snapshot', () => {
      const dir = autoSnapshotPhaseLocked(3, projectRoot);
      expect(dir).not.toBeNull();

      const manifest = YAML.load(
        readFileSync(join(dir!, 'manifest.yaml'), 'utf-8'),
      ) as SnapshotManifest;
      expect(manifest.phase).toBe(3);
      expect(manifest.context?.trigger).toBe('phase_locked');
      expect(manifest.name).toContain('phase-03-locked-');
    });

    it('autoSnapshotGateFailure should include gate ID', () => {
      const dir = autoSnapshotGateFailure(4, 'SRG-05', projectRoot);
      expect(dir).not.toBeNull();

      const manifest = YAML.load(
        readFileSync(join(dir!, 'manifest.yaml'), 'utf-8'),
      ) as SnapshotManifest;
      expect(manifest.reason).toContain('SRG-05');
      expect(manifest.name).toContain('failure-phase-04');
    });

    it('autoSnapshotBuildStart should create a build-start snapshot', () => {
      const dir = autoSnapshotBuildStart(projectRoot);
      expect(dir).not.toBeNull();

      const manifest = YAML.load(
        readFileSync(join(dir!, 'manifest.yaml'), 'utf-8'),
      ) as SnapshotManifest;
      expect(manifest.name).toContain('build-start-');
      expect(manifest.context?.trigger).toBe('build_start');
    });
  });
});
