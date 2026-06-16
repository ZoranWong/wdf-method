/**
 * Agent-side helper for writing structured results to the well-known path
 * the orchestrator reads after dispatch.
 *
 * The orchestrator looks for `<worktree>/_wdf_output/agent-result.json`. As long
 * as the agent writes a file conforming to `AgentDispatchResult` at that path,
 * the orchestrator never has to parse stdout.
 *
 * This file deliberately has zero runtime dependencies (only `fs`/`path`) so it
 * can be vendored or imported from any execution context — including a
 * sub-process that does not share the orchestrator's TypeScript build.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, renameSync } from 'fs';
import { dirname, join } from 'path';

import type { AgentDispatchResult, AgentDispatchStatus } from '../orchestrator/types.js';

/**
 * Default output path inside a story worktree, relative to the worktree root.
 */
export const AGENT_RESULT_RELPATH = '_wdf_output/agent-result.json';

/**
 * Compute the absolute path the orchestrator will read for a given worktree.
 */
export function agentResultPath(worktreePath: string): string {
  return join(worktreePath, AGENT_RESULT_RELPATH);
}

export interface WriteResultOptions {
  /** Worktree root. Defaults to `process.cwd()`. */
  worktreePath?: string;
}

/**
 * Validate and write an `AgentDispatchResult` to the well-known location.
 * Throws if the payload fails schema validation; the caller is expected to
 * fix the issue rather than silently emit a malformed file.
 *
 * The write is performed via a sibling-temp-file rename so partial files are
 * never observed by the orchestrator (atomic on POSIX filesystems).
 */
export function writeResult(
  result: AgentDispatchResult,
  options: WriteResultOptions = {},
): string {
  const validation = validateAgentDispatchResult(result);
  if (!validation.ok) {
    throw new Error(`writeResult: invalid payload — ${validation.reason}`);
  }

  const root = options.worktreePath ?? process.cwd();
  const target = agentResultPath(root);
  const tmp = `${target}.tmp`;

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(tmp, JSON.stringify(result, null, 2), 'utf-8');

  // Use rename for atomic publication.
  renameSync(tmp, target);

  return target;
}

/**
 * Read and validate the agent result file from a worktree.
 * Returns `null` if the file does not exist; throws on invalid JSON or schema
 * violation so callers can choose to retry or surface the failure.
 */
export function readResult(worktreePath: string): AgentDispatchResult | null {
  const target = agentResultPath(worktreePath);
  if (!existsSync(target)) return null;

  const raw = readFileSync(target, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`readResult: invalid JSON at ${target} — ${err.message}`);
  }
  const validation = validateAgentDispatchResult(parsed);
  if (!validation.ok) {
    throw new Error(`readResult: invalid payload at ${target} — ${validation.reason}`);
  }
  return parsed as AgentDispatchResult;
}

const VALID_STATUSES: ReadonlyArray<AgentDispatchStatus> = [
  'success',
  'failed',
  'timeout',
  'blocked',
];

export interface SchemaValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Pure schema validator for `AgentDispatchResult`. Exported separately so the
 * orchestrator can re-validate files written by external agents without
 * needing to import the whole write-result module.
 */
export function validateAgentDispatchResult(
  value: unknown,
): SchemaValidationResult {
  if (value === null || typeof value !== 'object') {
    return { ok: false, reason: 'result must be a JSON object' };
  }
  const v = value as Record<string, unknown>;

  if (typeof v.status !== 'string' || !VALID_STATUSES.includes(v.status as AgentDispatchStatus)) {
    return {
      ok: false,
      reason: `field "status" must be one of: ${VALID_STATUSES.join(', ')}`,
    };
  }
  if (typeof v.story_id !== 'string' || v.story_id.length === 0) {
    return { ok: false, reason: 'field "story_id" must be a non-empty string' };
  }
  if (!Array.isArray(v.files_changed) || !v.files_changed.every(s => typeof s === 'string')) {
    return { ok: false, reason: 'field "files_changed" must be string[]' };
  }
  if (typeof v.tests_passed !== 'number' || !Number.isFinite(v.tests_passed) || v.tests_passed < 0) {
    return { ok: false, reason: 'field "tests_passed" must be a non-negative number' };
  }
  if (typeof v.tests_total !== 'number' || !Number.isFinite(v.tests_total) || v.tests_total < 0) {
    return { ok: false, reason: 'field "tests_total" must be a non-negative number' };
  }
  if (v.tests_passed > v.tests_total) {
    return { ok: false, reason: 'tests_passed cannot exceed tests_total' };
  }
  if (typeof v.summary !== 'string') {
    return { ok: false, reason: 'field "summary" must be a string' };
  }
  if (typeof v.duration_ms !== 'number' || !Number.isFinite(v.duration_ms) || v.duration_ms < 0) {
    return { ok: false, reason: 'field "duration_ms" must be a non-negative number' };
  }
  if (v.error !== undefined && typeof v.error !== 'string') {
    return { ok: false, reason: 'field "error" must be a string when present' };
  }
  return { ok: true };
}
