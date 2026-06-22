// src/api/todos.ts
// Story: S-TODO-04 (frontend)
// Maps to REQ: REQ-004, REQ-005, REQ-006
//
// Thin fetch wrappers for the S-TODO-01 backend todo endpoints.
// All calls use credentials: 'include' so the browser attaches the
// httpOnly access_token cookie automatically. The backend contract:
//
//   GET    /api/v1/todos          → 200 {data: Todo[]}
//   POST   /api/v1/todos          → 201 {data: Todo}
//   PATCH  /api/v1/todos/:id      → 200 {data: Todo}
//   DELETE /api/v1/todos/:id      → 204
//
// 401 on missing/expired token. 404 if todo not owned. 400 on bad input.

import { ApiError, type FieldError } from './auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Todo {
  id: string
  user_id: string
  title: string
  description: string | null
  due_date: string | null
  priority: 'low' | 'medium' | 'high'
  completed: boolean
  created_at: string
  updated_at: string
}

export interface CreateTodoInput {
  title: string
  description?: string
  due_date?: string
  priority?: 'low' | 'medium' | 'high'
}

export interface UpdateTodoInput {
  title?: string
  description?: string | null
  due_date?: string | null
  priority?: 'low' | 'medium' | 'high'
  completed?: boolean
}

// ---------------------------------------------------------------------------
// Error parser
// ---------------------------------------------------------------------------

/**
 * Parse an error response from the todos API. The backend may use
 * `details` (auth-style) or `issues` (todos-style) for field errors.
 */
async function parseApiError(res: Response): Promise<ApiError> {
  let payload: Record<string, unknown> | null = null
  try {
    payload = (await res.json()) as Record<string, unknown>
  } catch {
    /* empty body */
  }

  if (payload && typeof payload === 'object' && 'error' in payload) {
    const code = typeof payload.error === 'string' ? payload.error : 'UNKNOWN'
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : 'Request failed.'

    // Support both `details` (auth endpoints) and `issues` (todo endpoints)
    const rawIssues = (payload.issues ?? payload.details) as unknown[]
    const fieldErrors: FieldError[] = Array.isArray(rawIssues)
      ? rawIssues.filter(
          (d): d is FieldError =>
            d != null &&
            typeof d === 'object' &&
            Array.isArray((d as FieldError).path) &&
            typeof (d as FieldError).message === 'string',
        )
      : []

    return new ApiError(res.status, code, message, fieldErrors)
  }

  return new ApiError(res.status, 'UNKNOWN', 'Request failed.')
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

const BASE = '/api/v1/todos'

/**
 * GET /api/v1/todos?status=<filter>
 * Default filter is 'all'.
 */
export async function fetchTodos(
  status: 'active' | 'completed' | 'all' = 'all',
): Promise<Todo[]> {
  const res = await fetch(`${BASE}?status=${status}`, {
    method: 'GET',
    credentials: 'include',
  })

  if (res.ok) {
    const json = (await res.json()) as { data: Todo[] }
    return json.data
  }

  throw await parseApiError(res)
}

/**
 * POST /api/v1/todos
 * Creates a new todo. Returns the created todo (201).
 */
export async function createTodo(input: CreateTodoInput): Promise<Todo> {
  const res = await fetch(BASE, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (res.status === 201) {
    const json = (await res.json()) as { data: Todo }
    return json.data
  }

  throw await parseApiError(res)
}

/**
 * PATCH /api/v1/todos/:id
 * Updates only the provided fields. Returns the updated todo.
 */
export async function updateTodo(
  id: string,
  patch: UpdateTodoInput,
): Promise<Todo> {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })

  if (res.ok) {
    const json = (await res.json()) as { data: Todo }
    return json.data
  }

  throw await parseApiError(res)
}

/**
 * DELETE /api/v1/todos/:id
 * Removes a todo. Returns void on 204.
 */
export async function deleteTodo(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })

  if (res.status === 204 || res.ok) {
    return
  }

  throw await parseApiError(res)
}
