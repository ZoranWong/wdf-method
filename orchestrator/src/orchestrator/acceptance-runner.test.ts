/**
 * acceptance-runner.test.ts
 *
 * End-to-end tests for the acceptance command execution engine. Each
 * test command targets a small JS file written to a tmp dir and runs
 * via `node <file>` (allowlisted prefix). We avoid `node -e` because
 * `validateCommand` rejects `;`, `>`, and other tokens that any
 * non-trivial JS expression naturally contains — that rejection is
 * exactly what the safety layer is for, so tests use real script files.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { tmpdir } from 'os';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  runAcceptanceChecks,
  runSingleAcceptanceCheck,
  DEFAULT_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
} from './acceptance-runner.js';

const TMP_CWD = mkdtempSync(join(tmpdir(), 'wdf-acceptance-runner-'));

/** Helper: write a JS file to TMP_CWD and return the matching command. */
function script(name: string, body: string): string {
  writeFileSync(join(TMP_CWD, name), body);
  return `node ${name}`;
}

beforeAll(() => {
  // Pre-create the script files used across tests. Bodies are plain JS;
  // they live on disk so the *command string* contains only allowlisted
  // tokens.
  script('exit-zero.js', 'process.exit(0)\n');
  script('exit-two.js', 'process.stderr.write("boom"); process.exit(2)\n');
  script(
    'write-stdout.js',
    'process.stdout.write("hi"); process.exit(0)\n',
  );
  script(
    'write-stderr.js',
    'process.stderr.write("oops"); process.exit(0)\n',
  );
  script(
    'write-env.js',
    'process.stdout.write(process.env.WDF_TEST_VAR || "missing")\n',
  );
  script(
    'sleep-forever.js',
    'setInterval(function () { /* keep alive */ }, 1000)\n',
  );
  script(
    'large-stdout.js',
    `
const target = ${MAX_OUTPUT_BYTES + 4096};
const b = Buffer.alloc(target, 0x61);
process.stdout.write(b);
`,
  );
});

describe('runAcceptanceChecks — happy path', () => {
  it('returns all_passed: true with empty report for empty input', async () => {
    const report = await runAcceptanceChecks([], { cwd: TMP_CWD });
    expect(report.all_passed).toBe(true);
    expect(report.results).toEqual([]);
    expect(report.total_duration_ms).toBe(0);
  });

  it('runs a single allowlisted command and reports passed', async () => {
    const report = await runAcceptanceChecks(['node write-stdout.js'], {
      cwd: TMP_CWD,
    });
    expect(report.all_passed).toBe(true);
    expect(report.results).toHaveLength(1);
    const [r] = report.results;
    expect(r.passed).toBe(true);
    expect(r.exit_code).toBe(0);
    expect(r.stdout).toBe('hi');
    expect(r.stderr).toBe('');
    expect(r.duration_ms).toBeGreaterThanOrEqual(0);
    expect(report.total_duration_ms).toBe(r.duration_ms);
  });

  it('runs every command sequentially and aggregates duration', async () => {
    const report = await runAcceptanceChecks(
      ['node exit-zero.js', 'node exit-zero.js', 'node exit-zero.js'],
      { cwd: TMP_CWD },
    );
    expect(report.all_passed).toBe(true);
    expect(report.results).toHaveLength(3);
    const sum = report.results.reduce((a, r) => a + r.duration_ms, 0);
    expect(report.total_duration_ms).toBe(sum);
  });

  it('captures stderr when the command writes to it', async () => {
    const report = await runAcceptanceChecks(['node write-stderr.js'], {
      cwd: TMP_CWD,
    });
    expect(report.results[0].passed).toBe(true);
    expect(report.results[0].stderr).toBe('oops');
    expect(report.results[0].stdout).toBe('');
  });
});

describe('runAcceptanceChecks — validation rejection', () => {
  it('rejects a command not on the allowlist without spawning', async () => {
    const report = await runAcceptanceChecks(['rm -rf /'], { cwd: TMP_CWD });
    expect(report.all_passed).toBe(false);
    const [r] = report.results;
    expect(r.passed).toBe(false);
    expect(r.exit_code).toBe(-1);
    expect(r.error).toMatch(/rejected by safety validation/);
    expect(r.duration_ms).toBe(0);
  });

  it('rejects commands with forbidden tokens (pipe)', async () => {
    const report = await runAcceptanceChecks(['npm test | tee out.log'], {
      cwd: TMP_CWD,
    });
    expect(report.all_passed).toBe(false);
    expect(report.results[0].error).toMatch(/forbidden token/);
  });

  it('rejects commands with command substitution', async () => {
    const report = await runAcceptanceChecks(['npm test $(whoami)'], {
      cwd: TMP_CWD,
    });
    expect(report.all_passed).toBe(false);
    expect(report.results[0].error).toMatch(/forbidden token/);
  });

  it('rejects commands with chained operators', async () => {
    const report = await runAcceptanceChecks(['npm test && npm run build'], {
      cwd: TMP_CWD,
    });
    expect(report.all_passed).toBe(false);
    expect(report.results[0].error).toMatch(/forbidden token/);
  });

  it('rejects commands with redirection', async () => {
    const report = await runAcceptanceChecks(['npm test > out.log'], {
      cwd: TMP_CWD,
    });
    expect(report.all_passed).toBe(false);
    expect(report.results[0].error).toMatch(/forbidden token/);
  });

  it('rejects commands with sudo', async () => {
    const report = await runAcceptanceChecks(['sudo npm install'], {
      cwd: TMP_CWD,
    });
    expect(report.all_passed).toBe(false);
    expect(report.results[0].error).toMatch(/allowed prefix|forbidden/);
  });

  it('continues running remaining commands after a rejection', async () => {
    const report = await runAcceptanceChecks(
      ['rm -rf /', 'node exit-zero.js'],
      { cwd: TMP_CWD },
    );
    expect(report.all_passed).toBe(false);
    expect(report.results).toHaveLength(2);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[1].passed).toBe(true);
  });

  it('coerces non-string commands into a failed result', async () => {
    // @ts-expect-error — exercising defensive runtime coercion
    const report = await runAcceptanceChecks([123], { cwd: TMP_CWD });
    expect(report.all_passed).toBe(false);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].exit_code).toBe(-1);
  });
});

describe('runAcceptanceChecks — failure handling', () => {
  it('marks non-zero exit codes as failed and preserves stderr', async () => {
    const report = await runAcceptanceChecks(['node exit-two.js'], {
      cwd: TMP_CWD,
    });
    expect(report.all_passed).toBe(false);
    const [r] = report.results;
    expect(r.passed).toBe(false);
    expect(r.exit_code).toBe(2);
    expect(r.stderr).toBe('boom');
    expect(r.error).toMatch(/non-zero status 2/);
  });

  it('reports timeout as failed and kills the child', async () => {
    const report = await runAcceptanceChecks(['node sleep-forever.js'], {
      cwd: TMP_CWD,
      timeout_ms: 200,
    });
    expect(report.all_passed).toBe(false);
    const [r] = report.results;
    expect(r.passed).toBe(false);
    expect(r.exit_code).toBe(-2);
    expect(r.error).toMatch(/timed out/);
    // Timeout should fire promptly; allow generous slack for CI.
    expect(r.duration_ms).toBeLessThan(5_000);
  });

  it('returns a structured failure for non-zero exit from a real binary', async () => {
    // node --version-bogus is not a real flag → node exits non-zero.
    const report = await runAcceptanceChecks(['node --version-bogus'], {
      cwd: TMP_CWD,
    });
    expect(report.all_passed).toBe(false);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].exit_code).not.toBe(0);
  });
});

describe('runAcceptanceChecks — output handling', () => {
  it('truncates stdout that exceeds the cap and reports omission', async () => {
    const report = await runAcceptanceChecks(['node large-stdout.js'], {
      cwd: TMP_CWD,
    });
    const [r] = report.results;
    expect(r.passed).toBe(true);
    expect(r.stdout).toMatch(/\[truncated: \d+ bytes omitted\]/);
    const beforeMarker = r.stdout.split('\n[truncated:')[0];
    expect(Buffer.byteLength(beforeMarker, 'utf8')).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
  });
});

describe('runAcceptanceChecks — option handling', () => {
  it('throws on missing cwd', async () => {
    await expect(
      // @ts-expect-error — exercising runtime guard
      runAcceptanceChecks(['npm test'], {}),
    ).rejects.toThrow(/cwd is required/);
  });

  it('throws when commands is not an array', async () => {
    await expect(
      // @ts-expect-error — exercising runtime guard
      runAcceptanceChecks('npm test', { cwd: TMP_CWD }),
    ).rejects.toThrow(/must be an array/);
  });

  it('clamps absurdly large timeouts and still completes quickly', async () => {
    const report = await runAcceptanceChecks(['node exit-zero.js'], {
      cwd: TMP_CWD,
      timeout_ms: 10 ** 12,
    });
    expect(report.all_passed).toBe(true);
  });

  it('falls back to default timeout when given negative values', async () => {
    const report = await runAcceptanceChecks(['node exit-zero.js'], {
      cwd: TMP_CWD,
      timeout_ms: -1,
    });
    expect(report.all_passed).toBe(true);
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('passes a custom env to the child process', async () => {
    const report = await runAcceptanceChecks(['node write-env.js'], {
      cwd: TMP_CWD,
      env: { ...process.env, WDF_TEST_VAR: 'present' },
    });
    expect(report.results[0].stdout).toBe('present');
  });
});

describe('runSingleAcceptanceCheck', () => {
  it('returns the same shape as a single-element runAcceptanceChecks result', async () => {
    const r = await runSingleAcceptanceCheck('node exit-zero.js', {
      cwd: TMP_CWD,
    });
    expect(r.passed).toBe(true);
    expect(r.exit_code).toBe(0);
  });

  it('rejects unsafe commands without spawning', async () => {
    const r = await runSingleAcceptanceCheck('curl http://evil.com', {
      cwd: TMP_CWD,
    });
    expect(r.passed).toBe(false);
    expect(r.exit_code).toBe(-1);
  });

  it('throws on missing cwd', async () => {
    await expect(
      // @ts-expect-error — exercising runtime guard
      runSingleAcceptanceCheck('npm test', {}),
    ).rejects.toThrow(/cwd is required/);
  });
});

describe('AcceptanceReport shape contract', () => {
  it('every report has the documented top-level keys', async () => {
    const report = await runAcceptanceChecks(
      ['node exit-zero.js', 'rm -rf /'],
      { cwd: TMP_CWD },
    );
    expect(Object.keys(report).sort()).toEqual(
      ['all_passed', 'results', 'total_duration_ms'].sort(),
    );
  });

  it('every result has the documented per-command keys', async () => {
    const report = await runAcceptanceChecks(['node exit-zero.js'], {
      cwd: TMP_CWD,
    });
    const r = report.results[0];
    const keys = Object.keys(r);
    expect(keys).toEqual(
      expect.arrayContaining([
        'command',
        'duration_ms',
        'exit_code',
        'passed',
        'stderr',
        'stdout',
      ]),
    );
  });
});
