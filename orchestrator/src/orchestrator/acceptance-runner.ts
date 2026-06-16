/**
 * acceptance-runner.ts
 *
 * Safe, structured execution engine for acceptance / integration check
 * commands declared on stories and merge-queue items.
 *
 * Design constraints:
 *   - Every command is validated by `validateCommand()` before launch. A
 *     command that fails validation is reported as a failed result and is
 *     NEVER executed.
 *   - Commands are launched with `spawn` using an argument array — no
 *     shell, no string interpolation, no `shell: true`. Quoted segments
 *     are honoured during argv splitting so callers can pass `--flag "two
 *     words"` style arguments.
 *   - Each command runs with a hard wall-clock timeout (default 30s, max
 *     10 minutes). On timeout the child is killed with SIGKILL after a
 *     SIGTERM grace, the result is marked failed, and execution continues
 *     with the next command.
 *   - stdout / stderr are captured to memory but truncated at
 *     `MAX_OUTPUT_BYTES` per stream to prevent memory exhaustion when a
 *     misbehaving check spews unbounded output.
 *   - Results are deterministic and serialisable — suitable for embedding
 *     in audit logs, sprint-status, or merge-queue persistence.
 */

import { spawn } from 'child_process';
import {
  validateCommand,
  type CommandValidationResult,
} from './command-safety.js';

/** Default per-command timeout if the caller does not specify one. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Hard upper bound on a per-command timeout (10 minutes). */
export const MAX_TIMEOUT_MS = 10 * 60_000;

/**
 * Per-stream output cap (256 KiB). Anything beyond this is dropped and
 * a `[truncated: <N> bytes omitted]` marker is appended.
 */
export const MAX_OUTPUT_BYTES = 256 * 1024;

/** Structured result for a single acceptance command. */
export interface AcceptanceResult {
  /** The original command string the caller supplied. */
  command: string;
  /** True if the command was launched AND exited with status 0. */
  passed: boolean;
  /** Captured stdout (UTF-8, truncated at MAX_OUTPUT_BYTES). */
  stdout: string;
  /** Captured stderr (UTF-8, truncated at MAX_OUTPUT_BYTES). */
  stderr: string;
  /** Wall-clock duration of the command in milliseconds. */
  duration_ms: number;
  /**
   * Process exit code, or -1 if the command was never launched (rejected
   * by `validateCommand`), or -2 if it was killed due to timeout, or -3
   * for any other spawn-level failure (ENOENT, etc.).
   */
  exit_code: number;
  /** Human-readable error string when `passed` is false. */
  error?: string;
}

/** Aggregated report across all acceptance commands. */
export interface AcceptanceReport {
  /** True iff every result has `passed: true`. Empty list ⇒ true. */
  all_passed: boolean;
  /** One entry per input command, in input order. */
  results: AcceptanceResult[];
  /** Sum of every command's `duration_ms`. */
  total_duration_ms: number;
}

/** Options for `runAcceptanceChecks`. */
export interface RunAcceptanceOptions {
  /** Working directory for every command. Required — no implicit cwd. */
  cwd: string;
  /**
   * Per-command timeout in milliseconds. Defaults to `DEFAULT_TIMEOUT_MS`.
   * Capped at `MAX_TIMEOUT_MS`. Negative or non-finite values fall back
   * to the default.
   */
  timeout_ms?: number;
  /**
   * Optional environment overrides merged onto `process.env`. The
   * default inherits the caller's environment so CI scripts that depend
   * on PATH / NODE_ENV continue to work.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Sentinel exit codes used when the OS exit code is unavailable. Negative
 * values cannot collide with real exit statuses, which are 0–255 (or
 * sometimes 128 + signal).
 */
const EXIT_CODE_REJECTED = -1;
const EXIT_CODE_TIMEOUT = -2;
const EXIT_CODE_SPAWN_ERROR = -3;
const EXIT_CODE_KILLED = -4;

/**
 * Run a list of acceptance commands sequentially and produce a structured
 * report. Continues through failures so the caller sees every result, not
 * just the first to fail. Validation rejections are reported as failed
 * results without touching the OS.
 */
export async function runAcceptanceChecks(
  commands: string[],
  options: RunAcceptanceOptions,
): Promise<AcceptanceReport> {
  if (!Array.isArray(commands)) {
    throw new TypeError('runAcceptanceChecks: commands must be an array');
  }
  if (!options || typeof options.cwd !== 'string' || options.cwd.length === 0) {
    throw new TypeError('runAcceptanceChecks: options.cwd is required');
  }

  const timeout = clampTimeout(options.timeout_ms);
  const results: AcceptanceResult[] = [];
  let total = 0;

  for (const raw of commands) {
    const result = await runOne(raw, {
      cwd: options.cwd,
      timeout_ms: timeout,
      env: options.env,
    });
    results.push(result);
    total += result.duration_ms;
  }

  return {
    all_passed: results.every((r) => r.passed),
    results,
    total_duration_ms: total,
  };
}

/**
 * Public single-command runner — exposed for callers (merge-queue) that
 * need fine-grained control over each step but still want the same
 * validation, spawn, and capture semantics as `runAcceptanceChecks`.
 */
export async function runSingleAcceptanceCheck(
  command: string,
  options: RunAcceptanceOptions,
): Promise<AcceptanceResult> {
  if (!options || typeof options.cwd !== 'string' || options.cwd.length === 0) {
    throw new TypeError('runSingleAcceptanceCheck: options.cwd is required');
  }
  return runOne(command, {
    cwd: options.cwd,
    timeout_ms: clampTimeout(options.timeout_ms),
    env: options.env,
  });
}

/* ----------------------------- Internals ----------------------------- */

interface NormalisedOptions {
  cwd: string;
  timeout_ms: number;
  env?: NodeJS.ProcessEnv;
}

async function runOne(
  rawCommand: unknown,
  opts: NormalisedOptions,
): Promise<AcceptanceResult> {
  // Coerce non-strings into a safe representation so the report still
  // has a meaningful `command` field.
  const command =
    typeof rawCommand === 'string' ? rawCommand : safeStringify(rawCommand);

  // Step 1: validate. If rejected, never spawn.
  const validation: CommandValidationResult = validateCommand(command);
  if (!validation.ok) {
    return {
      command,
      passed: false,
      stdout: '',
      stderr: '',
      duration_ms: 0,
      exit_code: EXIT_CODE_REJECTED,
      error: `command rejected by safety validation: ${
        validation.reason ?? 'unknown reason'
      }`,
    };
  }

  // Step 2: split into argv. validateCommand has already rejected shell
  // metacharacters, so a simple whitespace-aware splitter is sufficient.
  const argv = splitArgv(command);
  if (argv.length === 0) {
    // Should be unreachable — validateCommand rejects empty/whitespace.
    return {
      command,
      passed: false,
      stdout: '',
      stderr: '',
      duration_ms: 0,
      exit_code: EXIT_CODE_REJECTED,
      error: 'command produced empty argv after splitting',
    };
  }

  return spawnAndCapture(command, argv, opts);
}

function spawnAndCapture(
  command: string,
  argv: string[],
  opts: NormalisedOptions,
): Promise<AcceptanceResult> {
  return new Promise<AcceptanceResult>((resolve) => {
    const start = Date.now();
    const [exe, ...args] = argv;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        // Explicitly NEVER use a shell. Shell expansion is the exact
        // injection vector this engine exists to prevent.
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        command,
        passed: false,
        stdout: '',
        stderr: '',
        duration_ms: Date.now() - start,
        exit_code: EXIT_CODE_SPAWN_ERROR,
        error: `failed to spawn process: ${describeError(err)}`,
      });
      return;
    }

    const stdoutBuf = new BoundedBuffer(MAX_OUTPUT_BYTES);
    const stderrBuf = new BoundedBuffer(MAX_OUTPUT_BYTES);
    let timedOut = false;
    let resolved = false;

    const finish = (
      passed: boolean,
      exit_code: number,
      error?: string,
    ): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({
        command,
        passed,
        stdout: stdoutBuf.toString(),
        stderr: stderrBuf.toString(),
        duration_ms: Date.now() - start,
        exit_code,
        error,
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => stdoutBuf.append(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrBuf.append(chunk));

    child.on('error', (err) => {
      finish(
        false,
        EXIT_CODE_SPAWN_ERROR,
        `spawn error: ${describeError(err)}`,
      );
    });

    // Timeout: SIGTERM, then SIGKILL after a 1s grace period. We track
    // both so `finish()` can clear them cleanly on normal exit.
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* child may already be gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 1_000);
      // Don't keep the event loop alive solely for the kill timer.
      killTimer.unref?.();
    }, opts.timeout_ms);
    timer.unref?.();

    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(
          false,
          EXIT_CODE_TIMEOUT,
          `command timed out after ${opts.timeout_ms}ms`,
        );
        return;
      }
      if (signal) {
        finish(
          false,
          EXIT_CODE_KILLED,
          `command terminated by signal: ${signal}`,
        );
        return;
      }
      const exit = code ?? EXIT_CODE_SPAWN_ERROR;
      if (exit === 0) {
        finish(true, 0);
      } else {
        finish(
          false,
          exit,
          `command exited with non-zero status ${exit}`,
        );
      }
    });
  });
}

/**
 * Bounded byte buffer that drops anything past the cap and appends a
 * truncation marker on `toString()`. Stores raw bytes so multi-byte
 * UTF-8 sequences are not split mid-character on the truncation seam.
 */
class BoundedBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  private dropped = 0;
  constructor(private readonly cap: number) {}

  append(chunk: Buffer): void {
    if (this.size >= this.cap) {
      this.dropped += chunk.length;
      return;
    }
    const remaining = this.cap - this.size;
    if (chunk.length <= remaining) {
      this.chunks.push(chunk);
      this.size += chunk.length;
    } else {
      this.chunks.push(chunk.subarray(0, remaining));
      this.size = this.cap;
      this.dropped += chunk.length - remaining;
    }
  }

  toString(): string {
    const head = Buffer.concat(this.chunks, this.size).toString('utf8');
    if (this.dropped === 0) return head;
    return `${head}\n[truncated: ${this.dropped} bytes omitted]`;
  }
}

/**
 * Whitespace-aware argv splitter that honours single and double quotes
 * but rejects backslash escapes and embedded shell metacharacters
 * (already filtered by validateCommand, but defended here too). Returns
 * an empty array for whitespace-only input.
 */
function splitArgv(command: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      hasContent = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (hasContent) {
        out.push(current);
        current = '';
        hasContent = false;
      }
      continue;
    }
    current += ch;
    hasContent = true;
  }
  if (hasContent) out.push(current);
  return out;
}

function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(ms), MAX_TIMEOUT_MS);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return safeStringify(err);
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}
