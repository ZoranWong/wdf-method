// src/routes/todos.ts
// Story: S-TODO-01
// Maps to REQ: REQ-004, REQ-007
//
// Express router for /api/v1/todos.
//
// All five endpoints share two invariants:
//   1. requireAuth runs first — every route is authenticated (AC8).
//   2. The todo repository is called with `req.user.sub` as the scoping
//      userId — cross-user access is impossible by construction (AC6,
//      REQ-007). Non-owners get 404, never 403, so todo existence is
//      not leaked.
//
// The db client comes from `db/client.ts`'s `getQuery()`, which is the
// same indirection S-AUTH-01's routes use — in tests, the pg-mem adapter
// is installed via `setQueryClient()`.

import { Router } from "express";
import { requireAuth, ensureReady } from "../middleware/auth.js";
import { getQuery } from "../db/client.js";
import {
  listTodos,
  findTodoById,
  createTodo as repoCreateTodo,
  updateTodo as repoUpdateTodo,
  deleteTodo as repoDeleteTodo,
  type Queryable,
} from "../repositories/todo.js";
import { createTodoSchema, updateTodoSchema } from "../schemas/todo.js";

export const todosRouter = Router();

// AC8 — mount auth on every sub-route of this router.
todosRouter.use(requireAuth);

// uuid regex — RFC 4122 v4 shape, case-insensitive. Rejects malformed
// ids at the routing layer so they don't reach the DB.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

// `getQuery()` returns a pg-style query function (QueryFn). The repository
// accepts a Queryable (an object exposing `.query()`). Wrap once per
// request so handlers stay terse — the wrapper is a zero-cost object
// literal that defers straight to the underlying fn.
function dbHandle(): Queryable {
  const q = getQuery();
  return { query: (text, params) => q(text, params) };
}

// GET /api/v1/todos — list current user's todos, newest-first (AC1, AC3).
//
// Query param `status` (AC3):
//   - omitted | "all"       → all todos
//   - "active"               → only completed=false
//   - "completed"            → only completed=true
//
// Any other value is rejected with 400 (mirroring the OpenAPI enum) so
// callers can't silently get an unfiltered superset of what they asked for.
todosRouter.get("/", async (req, res, next) => {
  try {
    if (!ensureReady(req, res)) return;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    let filter: "all" | "active" | "completed" = "all";
    if (status !== undefined) {
      if (status !== "all" && status !== "active" && status !== "completed") {
        res.status(400).json({
          error: "validation_error",
          message: "Invalid status query parameter",
          issues: [
            {
              path: ["status"],
              message: "status must be one of: all, active, completed",
            },
          ],
        });
        return;
      }
      filter = status;
    }
    const db = dbHandle();
    const todos = await listTodos(db, req.user!.sub, filter);
    res.status(200).json({ data: todos });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/todos — create (AC2).
todosRouter.post("/", async (req, res, next) => {
  try {
    if (!ensureReady(req, res)) return;
    const parsed = createTodoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "validation_error",
        message: "Invalid todo body",
        issues: parsed.error.issues,
      });
      return;
    }
    const b = parsed.data;
    const db = dbHandle();
    const created = await repoCreateTodo(db, {
      userId: req.user!.sub,
      title: b.title,
      description: b.description ?? null,
      dueDate: b.due_date ?? null,
      priority: b.priority,
      completed: b.completed,
    });
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/todos/:id (AC3 + AC6).
todosRouter.get("/:id", async (req, res, next) => {
  try {
    if (!ensureReady(req, res)) return;
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const db = dbHandle();
    const todo = await findTodoById(db, req.params.id, req.user!.sub);
    if (!todo) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(200).json({ data: todo });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/todos/:id (AC4 + AC6). Patch semantics — partial body.
// OpenAPI canonical method is PATCH (the api-spec.yaml path under
// /todos/{id} defines `patch`, not `put`).
todosRouter.patch("/:id", async (req, res, next) => {
  try {
    if (!ensureReady(req, res)) return;
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const parsed = updateTodoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "validation_error",
        message: "Invalid todo body",
        issues: parsed.error.issues,
      });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({
        error: "validation_error",
        message: "PATCH body must include at least one updatable field",
      });
      return;
    }
    const b = parsed.data;
    const db = dbHandle();
    const updated = await repoUpdateTodo(db, req.params.id, req.user!.sub, {
      title: b.title,
      description: b.description ?? undefined,
      dueDate: b.due_date ?? undefined,
      priority: b.priority,
      completed: b.completed,
    });
    if (!updated) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/todos/:id (AC5 + AC6). 204 on success, 404 if absent or
// not owned — same existence-leak protection.
todosRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!ensureReady(req, res)) return;
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const db = dbHandle();
    const ok = await repoDeleteTodo(db, req.params.id, req.user!.sub);
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default todosRouter;
