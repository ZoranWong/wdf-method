// src/schemas/todo.ts
// Story: S-TODO-01
// Maps to REQ: REQ-004, REQ-007
//
// Zod schemas for the Todo CRUD endpoints. Used by routes/todos.ts to
// validate request bodies before they reach the repository layer (AC7).
//
// Constraints mirrored from 002_create_todos.up.sql + OpenAPI:
//   title       1..500 chars (required on create, optional on update)
//   description null | <=5000 chars
//   due_date    ISO 8601 datetime (date-time), nullable
//   priority    enum {low, medium, high}, defaults to 'medium' on create
//   completed   boolean, defaults to false on create

import { z } from "zod";

export const prioritySchema = z.enum(["low", "medium", "high"]);

// ISO 8601 datetime — Zod's z.coerce.date() would parse but lose the
// raw string semantics; we accept any string and rely on Postgres
// timestamptz parsing for the final gate. We still use a regex to
// reject obvious non-datetime strings early (AC7).
const isoDateTimeRegex =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const dueDateSchema = z
  .union([z.string().regex(isoDateTimeRegex), z.null()])
  .optional()
  .nullable();

// POST /api/v1/todos — title required, everything else optional with
// DB-level defaults applied when omitted.
export const createTodoSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullish(),
  due_date: dueDateSchema,
  priority: prioritySchema.optional(),
  completed: z.boolean().optional(),
});

// PUT /api/v1/todos/:id — patch semantics: every field optional, but at
// least one must be present (enforced in the route handler, not here,
// so callers can compose the schema cleanly).
export const updateTodoSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(5000).nullish(),
    due_date: dueDateSchema,
    priority: prioritySchema.optional(),
    completed: z.boolean().optional(),
  })
  .strict();

export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
export type TodoPriority = z.infer<typeof prioritySchema>;
