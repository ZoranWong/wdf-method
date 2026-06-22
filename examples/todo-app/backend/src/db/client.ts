// src/db/client.ts
// Story: S-AUTH-01
// Maps to REQ: REQ-001
//
// Thin wrapper around `pg.Pool`. Repositories import `getQuery()` so they
// get a single `(text, params) => Promise<QueryResult>` function. Tests
// swap this out via `setQueryClient()` to point at the pg-mem instance.

import pg from "pg";
import type { QueryResult, QueryResultRow } from "pg";
import { env } from "../config/env.js";

type QueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

let pool: pg.Pool | null = null;
let override: QueryFn | null = null;

function getPool(): pg.Pool {
  if (env.isTest) {
    // In test mode the caller MUST have installed an override via
    // setQueryClient(). Falling back to a real Pool here would try to
    // connect to localhost Postgres and hang the test runner.
    throw new Error(
      "db/client.ts: test mode active but no query override installed. " +
        "Call setQueryClient(pgMemAdapter) in test setup.",
    );
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString: env.databaseUrl });
  }
  return pool;
}

/**
 * Install a fake query function — used by tests to point at pg-mem.
 */
export function setQueryClient(fn: QueryFn | null): void {
  override = fn;
}

export const getQuery = (): QueryFn => {
  if (override) return override;
  const p = getPool();
  return (text, params) => p.query(text, params);
};

/** Close the real pool (used by the server entrypoint on shutdown). */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
