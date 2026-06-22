// src/pages/Todos.tsx
// Story: S-TODO-04 (frontend)
// Maps to REQ: REQ-004, REQ-005, REQ-006
//
// Main todos page. Header with user info + logout button.
// AddTodoForm for creating todos. TodoList for filtering + displaying.
// Error toast for network/CRUD errors with retry.

import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useTodos } from '../hooks/useTodos'
import { AddTodoForm } from '../components/todos/AddTodoForm'
import { TodoList } from '../components/todos/TodoList'

export default function Todos() {
  const { user, logout } = useAuth()
  const {
    filteredTodos,
    loading,
    filter,
    counts,
    setFilter,
    create,
    update,
    remove,
    refetch,
  } = useTodos()

  const [toast, setToast] = useState<string | null>(null)

  function handleError(err: Error) {
    setToast(err.message || 'Something went wrong.')
    // Auto-clear after 5 seconds
    setTimeout(() => setToast(null), 5000)
  }

  return (
    <main className="page" aria-labelledby="todos-title">
      <header className="page__header">
        <h1 id="todos-title" className="page__title">
          My Todos
        </h1>
        <div className="page__header-actions">
          {user && <span className="page__user">{user.name}</span>}
          <button
            type="button"
            onClick={logout}
            className="btn btn--logout"
            data-testid="logout-btn"
          >
            Logout
          </button>
        </div>
      </header>

      {toast && (
        <div className="toast toast--error" role="alert" data-testid="error-toast">
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="toast__dismiss"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      <AddTodoForm onCreate={create} onError={handleError} />
      <TodoList
        filteredTodos={filteredTodos}
        loading={loading}
        filter={filter}
        counts={counts}
        onFilterChange={setFilter}
        onUpdate={update}
        onDelete={remove}
        onError={handleError}
      />

      {loading && (
        <button
          type="button"
          onClick={refetch}
          className="btn btn--retry"
          data-testid="retry-btn"
        >
          Retry
        </button>
      )}
    </main>
  )
}
