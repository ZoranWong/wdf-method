import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appendAudit,
  readRecentAudit,
  auditDir,
  auditFileForDate,
  formatAuditLines,
  AuditEntry,
} from './audit-logger.js';

describe('audit-logger', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'wdf-audit-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  describe('appendAudit', () => {
    it('writes a single JSONL entry to today’s file', () => {
      appendAudit(projectRoot, 'gate_check', {
        status: 'pass',
        message: 'gate ok',
        story_id: 'S-1.1',
      });

      const file = auditFileForDate(projectRoot);
      expect(existsSync(file)).toBe(true);

      const raw = readFileSync(file, 'utf-8');
      const lines = raw.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]) as AuditEntry;
      expect(parsed.event).toBe('gate_check');
      expect(parsed.status).toBe('pass');
      expect(parsed.message).toBe('gate ok');
      expect(parsed.story_id).toBe('S-1.1');
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('creates the audit directory automatically when missing', () => {
      const dir = auditDir(projectRoot);
      expect(existsSync(dir)).toBe(false);

      appendAudit(projectRoot, 'merge_attempt', {
        status: 'info',
        message: 'try',
      });

      expect(existsSync(dir)).toBe(true);
    });

    it('appends multiple entries without overwriting', () => {
      appendAudit(projectRoot, 'merge_enqueue', { status: 'info', message: 'one' });
      appendAudit(projectRoot, 'merge_attempt', { status: 'info', message: 'two' });
      appendAudit(projectRoot, 'merge_success', { status: 'pass', message: 'three' });

      const file = auditFileForDate(projectRoot);
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(3);
      const events = lines.map(l => JSON.parse(l).event);
      expect(events).toEqual(['merge_enqueue', 'merge_attempt', 'merge_success']);
    });

    it('produces well-formed JSON with all optional fields', () => {
      appendAudit(projectRoot, 'agent_dispatch_start', {
        status: 'info',
        message: 'dispatch',
        actor: 'agent:abc',
        story_id: 'S-2.3',
        details: { worktree: '/tmp/x', timeout: 30 },
      });

      const file = auditFileForDate(projectRoot);
      const entry = JSON.parse(readFileSync(file, 'utf-8').trim()) as AuditEntry;
      expect(entry.actor).toBe('agent:abc');
      expect(entry.details).toEqual({ worktree: '/tmp/x', timeout: 30 });
    });

    it('does not throw when given an unwritable project root', () => {
      // Pointing at a path that cannot exist exercises the error swallow.
      // appendAudit must never throw from logging failures.
      const bogus = '/dev/null/cannot-create/here';
      expect(() => appendAudit(bogus, 'gate_check', {
        status: 'fail',
        message: 'x',
      })).not.toThrow();
    });
  });

  describe('readRecentAudit', () => {
    it('returns [] when no audit dir exists', () => {
      expect(readRecentAudit(projectRoot, 10)).toEqual([]);
    });

    it('returns [] when limit <= 0', () => {
      appendAudit(projectRoot, 'gate_check', { status: 'pass', message: 'x' });
      expect(readRecentAudit(projectRoot, 0)).toEqual([]);
      expect(readRecentAudit(projectRoot, -1)).toEqual([]);
    });

    it('returns entries newest-first within a single day', () => {
      appendAudit(projectRoot, 'gate_check', { status: 'pass', message: 'first' });
      appendAudit(projectRoot, 'merge_attempt', { status: 'info', message: 'second' });
      appendAudit(projectRoot, 'merge_success', { status: 'pass', message: 'third' });

      const recent = readRecentAudit(projectRoot, 10);
      expect(recent.map(r => r.message)).toEqual(['third', 'second', 'first']);
    });

    it('truncates results to the requested limit', () => {
      for (let i = 0; i < 20; i++) {
        appendAudit(projectRoot, 'gate_check', { status: 'info', message: `n${i}` });
      }
      const recent = readRecentAudit(projectRoot, 5);
      expect(recent).toHaveLength(5);
      expect(recent.map(r => r.message)).toEqual(['n19', 'n18', 'n17', 'n16', 'n15']);
    });

    it('walks newest-day-first across multiple daily files', () => {
      // Manually craft entries on different days.
      const dir = auditDir(projectRoot);
      mkdirSync(dir, { recursive: true });

      const oldFile = join(dir, '2026-01-01.jsonl');
      const newFile = join(dir, '2026-06-15.jsonl');

      writeFileSync(oldFile, JSON.stringify({
        timestamp: '2026-01-01T10:00:00.000Z',
        event: 'gate_check',
        status: 'pass',
        message: 'old',
      }) + '\n');

      writeFileSync(newFile,
        JSON.stringify({
          timestamp: '2026-06-15T10:00:00.000Z',
          event: 'merge_attempt',
          status: 'info',
          message: 'newer-1',
        }) + '\n' +
        JSON.stringify({
          timestamp: '2026-06-15T11:00:00.000Z',
          event: 'merge_success',
          status: 'pass',
          message: 'newer-2',
        }) + '\n'
      );

      const recent = readRecentAudit(projectRoot, 10);
      expect(recent.map(r => r.message)).toEqual(['newer-2', 'newer-1', 'old']);
    });

    it('skips malformed JSONL lines instead of throwing', () => {
      appendAudit(projectRoot, 'gate_check', { status: 'pass', message: 'good' });
      const file = auditFileForDate(projectRoot);
      // Corrupt the file by inserting garbage lines, terminated with newlines so
      // the next valid append starts on its own line.
      writeFileSync(
        file,
        readFileSync(file, 'utf-8') + 'this is not json\n{"oops":\n',
        { flag: 'w' }
      );
      // Append a valid follow-up to confirm continued operation.
      appendAudit(projectRoot, 'merge_success', { status: 'pass', message: 'after' });

      const recent = readRecentAudit(projectRoot, 10);
      expect(recent.map(r => r.message)).toContain('good');
      expect(recent.map(r => r.message)).toContain('after');
      expect(recent.every(r => typeof r.event === 'string')).toBe(true);
    });

    it('ignores files that do not match YYYY-MM-DD.jsonl', () => {
      const dir = auditDir(projectRoot);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'README.md'), '# unrelated');
      writeFileSync(join(dir, 'random.jsonl'), JSON.stringify({
        timestamp: '2099-01-01T00:00:00Z',
        event: 'gate_check',
        status: 'pass',
        message: 'should-not-appear',
      }) + '\n');

      appendAudit(projectRoot, 'gate_check', { status: 'pass', message: 'real' });

      const recent = readRecentAudit(projectRoot, 10);
      expect(recent.map(r => r.message)).toEqual(['real']);
    });
  });

  describe('formatAuditLines', () => {
    it('renders empty placeholder when no entries', () => {
      expect(formatAuditLines([])).toEqual(['  (no audit entries)']);
    });

    it('renders entries with HH:MM:SS, event name, status icon, and story id', () => {
      const entries: AuditEntry[] = [{
        timestamp: '2026-06-15T12:34:56.789Z',
        event: 'story_ready_gate',
        status: 'pass',
        message: 'all checks passed',
        story_id: 'S-1.1',
      }];
      const lines = formatAuditLines(entries);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('12:34:56');
      expect(lines[0]).toContain('story_ready_gate');
      expect(lines[0]).toContain('S-1.1');
      expect(lines[0]).toContain('all checks passed');
    });
  });

  describe('concurrent append safety (single process)', () => {
    it('preserves all entries when many appends interleave synchronously', () => {
      // The Node fs.appendFileSync wraps a single write(O_APPEND) syscall;
      // POSIX guarantees atomicity for payloads <= PIPE_BUF. Our JSONL
      // lines are well under that. This test asserts no entries are lost
      // and every line is well-formed JSON.
      const N = 200;
      for (let i = 0; i < N; i++) {
        appendAudit(projectRoot, 'gate_check', {
          status: 'info',
          message: `e${i}`,
          details: { i },
        });
      }
      const file = auditFileForDate(projectRoot);
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(N);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });
});
