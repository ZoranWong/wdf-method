// test/_helpers/pgmem.ts
// Story: S-AUTH-01
//
// Shared pg-mem test harness. Reuses the adapter pattern from
// S-DB-01's test/migrations.test.ts (extensions + plpgsql stripped,
// gen_random_uuid + length stubbed) and additionally exposes a
// pg-compatible query function so the route handlers under test can
// talk to the in-memory DB through the same `db/client.ts` interface.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb, type IMemoryDb } from "pg-mem";
import type { QueryResult, QueryResultRow } from "pg";
import { setQueryClient } from "../../src/db/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

function adaptForPgMem(sql: string): string {
  return sql
    .replace(/CREATE\s+EXTENSION[^;]+;/gi, "-- (extension stripped)")
    .replace(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+set_updated_at\(\)[\s\S]*?\$\$\s*LANGUAGE\s+plpgsql\s*;/i,
      "-- (function stripped)",
    )
    .replace(
      /CREATE\s+TRIGGER\s+\w+[\s\S]*?EXECUTE\s+FUNCTION\s+set_updated_at\(\)\s*;/gi,
      "-- (trigger stripped)",
    )
    .replace(
      /DROP\s+TRIGGER\s+IF\s+EXISTS\s+\w+\s+ON\s+\w+\s*;/gi,
      "-- (drop trigger stripped)",
    )
    .replace(
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+set_updated_at\(\)\s*;/gi,
      "-- (drop function stripped)",
    );
}

function freshDb(): IMemoryDb {
  const db = newDb();
  db.public.registerFunction({
    name: "length",
    args: ["text"],
    returns: "integer",
    implementation: (s: unknown) =>
      s === null || s === undefined ? null : String(s).length,
  });
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid",
    implementation: () => crypto.randomUUID(),
  });
  return db;
}

async function applyMigrations(db: IMemoryDb): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".up.sql"))
    .sort();
  for (const f of files) {
    const raw = await readFile(join(MIGRATIONS_DIR, f), "utf8");
    const adapted = adaptForPgMem(raw);
    const statements = adapted
      .split(/;\s*\n/)
      .map((s) =>
        s
          .split("\n")
          .filter((line) => !/^\s*--/.test(line))
          .join("\n")
          .trim(),
      )
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      const cleaned = stmt.endsWith(";") ? stmt : stmt + ";";
      try {
        db.public.many(cleaned);
      } catch (err) {
        const msg = (err as Error).message ?? "";
        if (!/no rows?/i.test(msg) && !/returned.*empty/i.test(msg)) {
          throw new Error(`Failed applying ${f}:\n${cleaned}\n--- ${msg}`);
        }
      }
    }
  }
}

/**
 * Build a fresh pg-mem DB with migrations applied, AND install a
 * pg-compatible query function into src/db/client.ts so route handlers
 * transparently hit the in-memory DB.
 *
 * Returns the IMemoryDb so tests can do direct table assertions
 * (e.g. count rows in refresh_tokens).
 */
export async function setupTestDb(): Promise<IMemoryDb> {
  const db = freshDb();
  await applyMigrations(db);

  // Use pg-mem's official pg adapter — it manages execution context that
  // parameter binding requires. We grab the Pool and steal its query fn.
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const queryClient = async <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> => {
    return pool.query(text, params as unknown[]);
  };

  setQueryClient(queryClient);
  return db;
}

/** Drop the override so subsequent tests cannot accidentally reuse it. */
export function teardownTestDb(): void {
  setQueryClient(null);
}
