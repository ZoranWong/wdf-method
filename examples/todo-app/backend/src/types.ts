// src/types.ts
// Story: S-TODO-01 (shared)
// Maps to REQ: REQ-004, REQ-007
//
// Plain shared TypeScript types. Kept tiny and dependency-free so the
// Express request augmentation below can be imported by middleware,
// routes, and tests without pulling Express at type-check time.

import type { TodoPriority } from "./schemas/todo.js";

export interface AuthUser {
  /** JWT `sub` — the user's uuid. */
  sub: string;
  /** JWT `email` (citext value as stored). */
  email: string;
}

/** Row shape returned by the todo repository / sent over the wire as JSON. */
export interface TodoRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TodoPriority;
  completed: boolean;
  created_at: string;
  updated_at: string;
}
