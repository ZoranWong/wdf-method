// src/services/todo.ts
// Story: S-TODO-01
// Maps to REQ: REQ-004, REQ-007
//
// Thin orchestration layer between the Express route handlers and the
// todo repository. Routes already do request parsing (Zod) and
// authentication; TodoService focuses on the user-isolation invariant
// and on composing the few operations that need more than one repository
// call (currently none — but we keep this seam so future cross-table
// logic — e.g. cascading notifications, audit logs — has a place to land
// without leaking DB concerns back into routes).
//
// SECURITY (AC6 + REQ-007):
//   EVERY method in this service scopes by `userId`. There is no public
//   method that can read or mutate another user's todo — by construction.
//   The repository enforces the same invariant, but the service is the
//   "API the rest of the app calls" so it restates the invariant at the
//   boundary for defence-in-depth.
//
// AC1 (story test plan, unit test): "all queries include WHERE user_id = $1"
// — this is verified by integration tests in test/todos/ and by
// inspection: every method here threads `userId` into the repo call.

import {
  listTodos as repoListTodos,
  findTodoById as repoFindTodoById,
  createTodo as repoCreateTodo,
  updateTodo as repoUpdateTodo,
  deleteTodo as repoDeleteTodo,
  type Queryable,
  type CreateTodoParams,
  type UpdateTodoPatch,
} from "../repositories/todo.js";
import type { TodoRow } from "../types.js";

export type TodoStatusFilter = "all" | "active" | "completed";

/**
 * Stateless service. The constructor takes a `Queryable` (pg.Pool / pg.PoolClient /
 * pg-mem test adapter) so handlers can inject the request-scoped client later
 * (e.g. for transactions). For now, callers pass the result of `dbHandle()`.
 */
export class TodoService {
  constructor(private readonly db: Queryable) {}

  /**
   * List todos for `userId`, optionally filtered by completion status (AC3).
   * Newest-first.
   */
  list(userId: string, filter: TodoStatusFilter = "all"): Promise<TodoRow[]> {
    return repoListTodos(this.db, userId, filter);
  }

  /**
   * Return one todo iff it belongs to `userId`. Null otherwise — null is
   * the only signal the route exposes, so callers cannot distinguish
   * "not found" from "not owned" (AC6).
   */
  findById(id: string, userId: string): Promise<TodoRow | null> {
    return repoFindTodoById(this.db, id, userId);
  }

  /**
   * Create a todo owned by `userId`. `userId` is the authoritative owner —
   * not derivable from the request body (AC1).
   */
  create(userId: string, params: Omit<CreateTodoParams, "userId">): Promise<TodoRow> {
    return repoCreateTodo(this.db, { ...params, userId });
  }

  /**
   * Partial update of a todo owned by `userId`. Returns null if no row
   * was updated (absent OR not owned → indistinguishable → AC6).
   */
  update(id: string, userId: string, patch: UpdateTodoPatch): Promise<TodoRow | null> {
    return repoUpdateTodo(this.db, id, userId, patch);
  }

  /**
   * Delete a todo owned by `userId`. Returns true iff a row was deleted.
   */
  delete(id: string, userId: string): Promise<boolean> {
    return repoDeleteTodo(this.db, id, userId);
  }
}

// ---------------------------------------------------------------------------
// Pure-function variants
//
// Same logic as the class, exposed as plain functions for callers that
// don't want to instantiate a service object. Both shapes are exported so
// the route handler can pick whichever feels idiomatic — the class form
// is convenient when multiple operations share a `db`, the function form
// is convenient for one-shot calls. The integration tests exercise the
// route layer end-to-end so both paths get coverage.
// ---------------------------------------------------------------------------

export const TodoServiceFn = {
  list: (db: Queryable, userId: string, filter: TodoStatusFilter = "all") =>
    repoListTodos(db, userId, filter),
  findById: (db: Queryable, id: string, userId: string) =>
    repoFindTodoById(db, id, userId),
  create: (db: Queryable, userId: string, params: Omit<CreateTodoParams, "userId">) =>
    repoCreateTodo(db, { ...params, userId }),
  update: (db: Queryable, id: string, userId: string, patch: UpdateTodoPatch) =>
    repoUpdateTodo(db, id, userId, patch),
  delete: (db: Queryable, id: string, userId: string) =>
    repoDeleteTodo(db, id, userId),
};
