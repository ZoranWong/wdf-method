import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Unified audit log for the wdf-method orchestrator.
 *
 * Storage: `<projectRoot>/_wdf_output/audit/YYYY-MM-DD.jsonl`
 *   - One file per day (UTC), append-only JSONL
 *   - Crash-safe: each line is atomically appended; partial writes are
 *     tolerable because readers parse line-by-line and skip malformed
 *     entries.
 *   - Concurrency-safe: POSIX guarantees that single `write()` calls of
 *     PIPE_BUF bytes (>=512) are atomic across processes when opened
 *     with O_APPEND. JSONL lines stay below this on any realistic
 *     payload, so multiple agents may append without locks.
 */

export type AuditEventType =
  | 'gate_check'
  | 'story_ready_gate'
  | 'merge_enqueue'
  | 'merge_attempt'
  | 'merge_success'
  | 'merge_abort'
  | 'recovery_run'
  | 'agent_dispatch_start'
  | 'agent_dispatch_complete'
  | 'config_change'
  // Party Mode events (party-engine.ts). These flow through the same audit
  // log as orchestration events; the union keeps appendAudit() type-safe.
  | 'party_created'
  | 'party_started'
  | 'party_paused'
  | 'party_round_completed'
  | 'party_crosstalk_completed'
  | 'party_firstprinciples_completed'
  | 'party_convergence_resolved'
  | 'party_expert_invited'
  | 'party_completed';

export interface AuditEntry {
  timestamp: string;       // ISO 8601 UTC
  event: AuditEventType;
  actor?: string;          // 'system' | 'user' | 'agent:<id>'
  story_id?: string;
  status: 'pass' | 'fail' | 'info';
  message: string;
  details?: Record<string, any>;
  // ── Party Mode fields (party-engine.ts writes these directly so they
  // round-trip through the JSONL audit log without nesting under `details`).
  party_id?: string;
  topic?: string;
  phase?: string;
  agent_count?: number;
  round_number?: number;
  comment_count?: number;
  analysis_count?: number;
  point_id?: string;
  resolved_by?: string;
  reason?: string;
  expert_id?: string;
  expert_type?: string;
  output_path?: string;
  round_count?: number;
  convergence_points?: number;
  first_principles?: number;
}

const AUDIT_DIR_REL = join('_wdf_output', 'audit');

/**
 * Compute the absolute path of the audit directory for a project root.
 * Exposed for tests and tooling.
 */
export function auditDir(projectRoot: string): string {
  return join(projectRoot, AUDIT_DIR_REL);
}

/**
 * Compute the absolute path of the audit file for a given date (UTC).
 */
export function auditFileForDate(projectRoot: string, date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return join(auditDir(projectRoot), `${yyyy}-${mm}-${dd}.jsonl`);
}

function ensureAuditDir(projectRoot: string): void {
  const dir = auditDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Append a single audit entry to today's JSONL file.
 *
 * Failures are swallowed and logged to stderr — audit logging must never
 * break the orchestrator's primary control flow.
 */
export function appendAudit(
  projectRoot: string,
  event: AuditEventType,
  entry: Omit<AuditEntry, 'timestamp' | 'event'>
): void {
  try {
    ensureAuditDir(projectRoot);
    const full: AuditEntry = {
      timestamp: new Date().toISOString(),
      event,
      ...entry,
    };
    const file = auditFileForDate(projectRoot);
    // O_APPEND-equivalent + newline → atomic for small payloads on POSIX.
    appendFileSync(file, JSON.stringify(full) + '\n', 'utf-8');
  } catch (err: any) {
    // Never throw — audit failure must not cascade.
    // eslint-disable-next-line no-console
    console.error(`[audit] failed to append ${event}: ${err?.message ?? err}`);
  }
}

/**
 * Read the most recent N audit entries across all daily files, newest
 * first. Malformed lines are skipped silently.
 */
export function readRecentAudit(
  projectRoot: string,
  limit: number
): AuditEntry[] {
  if (limit <= 0) return [];

  const dir = auditDir(projectRoot);
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
  } catch {
    return [];
  }
  if (files.length === 0) return [];

  // Lex-sort works as date-sort for ISO date filenames.
  files.sort();

  const entries: AuditEntry[] = [];
  // Walk newest → oldest until we have enough.
  for (let i = files.length - 1; i >= 0 && entries.length < limit; i--) {
    const path = join(dir, files[i]);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
    const lines = raw.split('\n').filter(l => l.length > 0);
    // Newest entries are at the end of each file.
    for (let j = lines.length - 1; j >= 0 && entries.length < limit; j--) {
      try {
        const obj = JSON.parse(lines[j]);
        if (obj && typeof obj === 'object' && obj.timestamp && obj.event) {
          entries.push(obj as AuditEntry);
        }
      } catch {
        // skip malformed line
      }
    }
  }

  return entries;
}

/**
 * Format a list of audit entries for human display in the CLI.
 */
export function formatAuditLines(entries: AuditEntry[]): string[] {
  if (entries.length === 0) return ['  (no audit entries)'];
  return entries.map(e => {
    const t = e.timestamp.slice(11, 19); // HH:MM:SS
    const icon = e.status === 'pass' ? '✅' : e.status === 'fail' ? '❌' : 'ℹ️ ';
    const story = e.story_id ? `${e.story_id}: ` : '';
    return `  [${t}] ${e.event.padEnd(26)} ${icon} ${story}${e.message}`;
  });
}
