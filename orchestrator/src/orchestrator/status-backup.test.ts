import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { backupFileBeforeWrite } from './status-backup.js';

describe('backupFileBeforeWrite', () => {
  let tmpRoot: string;
  let statusDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'wdf-backup-test-'));
    statusDir = join(tmpRoot, 'status');
    mkdirSync(statusDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns null and creates no backup directory when the file is missing', () => {
    const target = join(statusDir, 'global.yaml');
    const result = backupFileBeforeWrite(target, statusDir);
    expect(result).toBeNull();
    expect(existsSync(join(statusDir, 'backup'))).toBe(false);
  });

  it('creates a backup copy when the file exists', () => {
    const target = join(statusDir, 'global.yaml');
    writeFileSync(target, 'project: alpha\n', 'utf-8');

    const result = backupFileBeforeWrite(target, statusDir);

    expect(result).not.toBeNull();
    const backupPath = result as string;
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf-8')).toBe('project: alpha\n');
  });

  it('places backups under <statusDir>/backup with timestamp + basename naming', () => {
    const target = join(statusDir, 'phase-04.yaml');
    writeFileSync(target, 'phase: 4\n', 'utf-8');

    const result = backupFileBeforeWrite(target, statusDir) as string;

    const backupDir = join(statusDir, 'backup');
    expect(existsSync(backupDir)).toBe(true);
    expect(result.startsWith(backupDir)).toBe(true);

    const name = basename(result);
    // ISO timestamp prefix (date portion) + sanitised colons + original basename + .js suffix
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T.*-phase-04\.yaml\.js$/);
  });

  it('creates the backup directory on demand', () => {
    const target = join(statusDir, 'change-requests.yaml');
    writeFileSync(target, 'change_requests: []\n', 'utf-8');

    expect(existsSync(join(statusDir, 'backup'))).toBe(false);
    backupFileBeforeWrite(target, statusDir);
    expect(existsSync(join(statusDir, 'backup'))).toBe(true);
  });

  it('produces independent backup files on successive writes', async () => {
    const target = join(statusDir, 'global.yaml');
    writeFileSync(target, 'v: 1\n', 'utf-8');
    const first = backupFileBeforeWrite(target, statusDir) as string;

    // Mutate and back up again — must yield a different path.
    writeFileSync(target, 'v: 2\n', 'utf-8');
    // Ensure timestamp differs (ISO resolution is ms; tiny wait keeps test deterministic on fast disks).
    await new Promise(r => setTimeout(r, 5));
    const second = backupFileBeforeWrite(target, statusDir) as string;

    expect(second).not.toBe(first);
    const entries = readdirSync(join(statusDir, 'backup'));
    expect(entries.length).toBe(2);
  });
});
