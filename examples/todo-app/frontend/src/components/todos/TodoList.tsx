// src/components/todos/TodoList.tsx
// Story: S-TODO-04 (frontend)
// Maps to REQ: REQ-004, REQ-005
//
// Renders FilterTabs + a list of TodoRows.
// Shows skeleton placeholders while loading, empty state when no todos,
// and a list of TodoRow components otherwise.

import type { Todo, UpdateTodoInput } from '../../api/todos'
import type { StatusFilter } from '../../hooks/useTodos'
import { FilterTabs } from './FilterTabs'
import { TodoRow } from './TodoRow'

interface TodoListProps {
  filteredTodos: Todo[]
  loading: boolean
  filter: StatusFilter
  counts: Record<StatusFilter, number>
  onFilterChange: (f: StatusFilter) => void
  onUpdate: (id: string, patch: UpdateTodoInput) => Promise<Todo>
  onDelete: (id: string) => Promise<void>
  onError: (err: Error) => void
}

export function TodoList({
  filteredTodos,
  loading,
  filter,
  counts,
  onFilterChange,
  onUpdate,
  onDelete,
  onError,
}: TodoListProps) {
  return (
    <div className="todo-list-container">
      <FilterTabs
        filter={filter}
        counts={counts}
        onFilterChange={onFilterChange}
      />

      {loading ? (
        <ul className="todo-list" aria-label="Loading todos">
          <li className="todo-skeleton" data-testid="skeleton-row" />
          <li className="todo-skeleton" data-testid="skeleton-row" />
          <li className="todo-skeleton" data-testid="skeleton-row" />
        </ul>
      ) : filteredTodos.length === 0 ? (
        <div className="todo-empty" data-testid="empty-state">
          <p>No todos yet. Create one above.</p>
        </div>
      ) : (
        <ul className="todo-list" aria-label="Todo list">
          {filteredTodos.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onError={onError}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
