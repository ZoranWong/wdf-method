// src/hooks/useTodos.ts
// Story: S-TODO-04 (frontend)
// Maps to REQ: REQ-004, REQ-005
//
// Custom hook that manages the todo list state. Fetches todos from the
// backend on mount, exposes CRUD operations, and handles 401 by
// triggering logout via AuthContext.
//
// The hook keeps the FULL list of todos and applies filtering in-memory.
// This makes filter tab switching instant (no refetch) and allows the
// FilterTabs component to show accurate counts for all three filters.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchTodos as apiFetchTodos,
  createTodo as apiCreateTodo,
  updateTodo as apiUpdateTodo,
  deleteTodo as apiDeleteTodo,
  type Todo,
  type CreateTodoInput,
  type UpdateTodoInput,
} from '../api/todos'
import { ApiError } from '../api/auth'

export type StatusFilter = 'all' | 'active' | 'completed'

export interface UseTodosReturn {
  todos: Todo[]
  loading: boolean
  error: string | null
  filter: StatusFilter
  setFilter: (f: StatusFilter) => void
  filteredTodos: Todo[]
  counts: Record<StatusFilter, number>
  create: (input: CreateTodoInput) => Promise<Todo>
  update: (id: string, patch: UpdateTodoInput) => Promise<Todo>
  remove: (id: string) => Promise<void>
  refetch: () => Promise<void>
}

export function useTodos(): UseTodosReturn {
  const { logout } = useAuth()
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')

  const handle401 = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        logout()
        return true
      }
      return false
    },
    [logout],
  )

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiFetchTodos()
      setTodos(data)
    } catch (err) {
      if (!handle401(err)) {
        setError(
          err instanceof Error ? err.message : 'Failed to load todos.',
        )
      }
    } finally {
      setLoading(false)
    }
  }, [handle401])

  useEffect(() => {
    load()
  }, [load])

  const create = useCallback(
    async (input: CreateTodoInput): Promise<Todo> => {
      try {
        const todo = await apiCreateTodo(input)
        // Newest first — prepend to the list
        setTodos((prev) => [todo, ...prev])
        return todo
      } catch (err) {
        if (handle401(err)) throw err
        throw err
      }
    },
    [handle401],
  )

  const update = useCallback(
    async (id: string, patch: UpdateTodoInput): Promise<Todo> => {
      // Optimistic update: flip the local state immediately
      setTodos((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, ...patch } : t,
        ),
      )
      try {
        const updated = await apiUpdateTodo(id, patch)
        // Replace with server truth
        setTodos((prev) =>
          prev.map((t) => (t.id === id ? updated : t)),
        )
        return updated
      } catch (err) {
        // Rollback on failure: refetch from server
        if (!handle401(err)) {
          await load()
        }
        throw err
      }
    },
    [handle401, load],
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      // Optimistic removal
      setTodos((prev) => prev.filter((t) => t.id !== id))
      try {
        await apiDeleteTodo(id)
      } catch (err) {
        // Rollback on failure
        if (!handle401(err)) {
          await load()
        }
        throw err
      }
    },
    [handle401, load],
  )

  const refetch = useCallback(async () => {
    await load()
  }, [load])

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  const filteredTodos = todos.filter((t) => {
    if (filter === 'active') return !t.completed
    if (filter === 'completed') return t.completed
    return true
  })

  const counts: Record<StatusFilter, number> = {
    all: todos.length,
    active: todos.filter((t) => !t.completed).length,
    completed: todos.filter((t) => t.completed).length,
  }

  return {
    todos,
    loading,
    error,
    filter,
    setFilter,
    filteredTodos,
    counts,
    create,
    update,
    remove,
    refetch,
  }
}
