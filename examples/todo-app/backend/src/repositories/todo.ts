// src/repositories/todo.ts
// Story: S-TODO-01
// Maps to REQ: REQ-004, REQ-007
//
// Data-access layer for the `todos` table.
//
// SECURITY (AC6 + AC9, REQ-007):
//   EVERY query in this module scopes by `user_id`. There is no function
//   here that can read or mutate another user's todo — by construction.
//   We never string-interpolate user input; all values flow through pg's
//   `$1, $2, ...` parameter placeholders, which is the SQL-injection
//   defense required by AC9.
//
// The repository is parameterised on a `Queryable` interface (anything
// with a `.query()` method that matches pg's signature) so:
//   - production code passes a real pg.Pool / pg.PoolClient
//   - tests pass a pg-mem adapter (see test/helpers.ts)
// This keeps the SQL in ONE place — tested against pg-mem, identical in
// production.

import { randomUUID } from "node:crypto";
import type { QueryResult, QueryResultRow } from "pg";
import type { TodoRow } from "../types.js";
import type { TodoPriority } from "../schemas/todo.js";

/**
 * Anything with a pg-compatible `.query()` method. The return type is
 * pg's full QueryResult (which has `rows`, `rowCount`, etc.) — pg-mem's
 * pg adapter returns the same shape, so production pg.Pool / pg.PoolClient
 * and the test harness are interchangeable.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

export interface CreateTodoParams {
  userId: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: TodoPriority;
  completed?: boolean;
}

export interface UpdateTodoPatch {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: TodoPriority;
  completed?: boolean;
}

/** Coerce a possibly-pg-row object into the wire shape. */
function toTodoRow(r: Record<string, unknown>): TodoRow {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    title: String(r.title),
    description: r.description === null || r.description === undefined ? null : String(r.description),
    due_date:
      r.due_date === null || r.due_date === undefined
        ? null
        : typeof r.due_date === "string"
          ? r.due_date
          : (r.due_date as Date).toISOString(),
    priority: String(r.priority) as TodoPriority,
    completed: Boolean(r.completed),
    created_at:
      typeof r.created_at === "string" ? r.created_at : (r.created_at as Date).toISOString(),
    updated_at:
      typeof r.updated_at === "string" ? r.updated_at : (r.updated_at as Date).toISOString(),
  };
}

/**
 * List all todos for `userId`, newest-first (AC1).
 *
 * The WHERE clause is the row-isolation invariant (REQ-007): we never
 * query the table without scoping by user_id.
 *
 * `filter` (AC3):
 *   - "all"       → no completed predicate (default)
 *   - "active"    → completed = false
 *   - "completed" → completed = true
 */
export async function listTodos(
  db: Queryable,
  userId: string,
  filter: "all" | "active" | "completed" = "all",
): Promise<TodoRow[]> {
  const where: string[] = ["user_id = $1"];
  const params: unknown[] = [userId];
  if (filter === "active" || filter === "completed") {
    params.push(filter === "completed");
    where.push(`completed = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT id, user_id, title, description, due_date, priority, completed, created_at, updated_at
       FROM todos
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC`,
    params,
  );
  return rows.map((r) => toTodoRow(r as unknown as Record<string, unknown>));
}

/**
 * Fetch a single todo if — and only if — it belongs to `userId`.
 * Returns null when the todo does not exist OR exists but belongs to a
 * different user. Callers cannot distinguish the two cases, which is
 * exactly the existence-leak protection AC6 mandates.
 */
export async function findTodoById(
  db: Queryable,
  id: string,
  userId: string,
): Promise<TodoRow | null> {
  const { rows } = await db.query(
    `SELECT id, user_id, title, description, due_date, priority, completed, created_at, updated_at
       FROM todos
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (rows.length === 0) return null;
  return toTodoRow(rows[0] as Record<string, unknown>);
}

/** Create a todo for `userId`. Returns the fully-defaulted row. */
export async function createTodo(
  db: Queryable,
  params: CreateTodoParams,
): Promise<TodoRow> {
  // Generate the id client-side rather than relying on the DB's
  // `DEFAULT gen_random_uuid()`. Production Postgres would call the
  // function once per row, but pg-mem (our integration-test harness)
  // evaluates function-defaults once at CREATE TABLE time — meaning the
  // SECOND insert in a single test would collide on the same uuid. By
  // passing an explicit `id` we sidestep the in-memory engine entirely
  // and the INSERT path is identical in production and tests.
  const id = randomUUID();
  const { rows } = await db.query(
    `INSERT INTO todos (id, user_id, title, description, due_date, priority, completed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, title, description, due_date, priority, completed, created_at, updated_at`,
    [
      id,
      params.userId,
      params.title,
      params.description ?? null,
      params.dueDate ?? null,
      params.priority ?? "medium",
      params.completed ?? false,
    ],
  );
  return toTodoRow(rows[0] as unknown as Record<string, unknown>);
}

/**
 * Partial update (PUT patch semantics, AC4).
 *
 * Builds a dynamic SET clause but STILL passes every value through
 * parameter placeholders — column names are picked from a fixed allowlist,
 * never from user input. `user_id` is enforced in WHERE so a cross-user
 * update affects 0 rows (which we surface as null → 404 in the route).
 */
export async function updateTodo(
  db: Queryable,
  id: string,
  userId: string,
  patch: UpdateTodoPatch,
): Promise<TodoRow | null> {
  // Fixed allowlist — order matters for the generated placeholders.
  const fields: Array<{ col: string; val: unknown }> = [];
  if (patch.title !== undefined) fields.push({ col: "title", val: patch.title });
  if (patch.description !== undefined) fields.push({ col: "description", val: patch.description });
  if (patch.dueDate !== undefined) fields.push({ col: "due_date", val: patch.dueDate });
  if (patch.priority !== undefined) fields.push({ col: "priority", val: patch.priority });
  if (patch.completed !== undefined) fields.push({ col: "completed", val: patch.completed });

  if (fields.length === 0) {
    // Nothing to update — return the current row (or null if absent).
    return findTodoById(db, id, userId);
  }

  const setClauses = fields.map((f, i) => `${f.col} = $${i + 3}`);
  const values: unknown[] = [id, userId, ...fields.map((f) => f.val)];

  const { rows } = await db.query(
    `UPDATE todos
        SET ${setClauses.join(", ")}
      WHERE id = $1 AND user_id = $2
      RETURNING id, user_id, title, description, due_date, priority, completed, created_at, updated_at`,
    values,
  );
  if (rows.length === 0) return null;
  return toTodoRow(rows[0] as Record<string, unknown>);
}

/**
 * Delete a todo. Returns true iff a row owned by `userId` was deleted,
 * false otherwise (absent OR owned by another user → indistinguishable
 * → AC6).
 */
export async function deleteTodo(
  db: Queryable,
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM todos WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  const rowCount = (result as { rowCount?: number }).rowCount ?? 0;
  return rowCount > 0;
}
