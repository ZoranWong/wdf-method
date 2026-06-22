// src/components/todos/TodoRow.tsx
// Story: S-TODO-04 (frontend)
// Maps to REQ: REQ-004
//
// Single todo display with:
// - Checkbox for completed toggle (optimistic PATCH)
// - Title + description + due_date + priority badge
// - Edit button → inline edit mode with save/cancel
// - Delete button → confirm + remove
//
// Edit mode renders inline inputs for title, description, due_date,
// and priority. Save calls update(); cancel reverts to original values.

import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import type { Todo, UpdateTodoInput } from '../../api/todos'

interface TodoRowProps {
  todo: Todo
  onUpdate: (id: string, patch: UpdateTodoInput) => Promise<Todo>
  onDelete: (id: string) => Promise<void>
  onError: (err: Error) => void
}

const PRIORITY_LABELS: Record<Todo['priority'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export function TodoRow({ todo, onUpdate, onDelete, onError }: TodoRowProps) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editTitle, setEditTitle] = useState(todo.title)
  const [editDescription, setEditDescription] = useState(
    todo.description ?? '',
  )
  const [editDueDate, setEditDueDate] = useState(todo.due_date ?? '')
  const [editPriority, setEditPriority] = useState<Todo['priority']>(
    todo.priority,
  )

  // Reset edit fields when the todo data changes from parent
  useEffect(() => {
    setEditTitle(todo.title)
    setEditDescription(todo.description ?? '')
    setEditDueDate(todo.due_date ?? '')
    setEditPriority(todo.priority)
  }, [todo.id, todo.title, todo.description, todo.due_date, todo.priority])

  async function handleToggle() {
    try {
      await onUpdate(todo.id, { completed: !todo.completed })
    } catch (err) {
      onError(err instanceof Error ? err : new Error('Update failed'))
    }
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editTitle.trim()) return
    try {
      await onUpdate(todo.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        due_date: editDueDate || null,
        priority: editPriority,
      })
      setEditing(false)
    } catch (err) {
      setEditing(false)
      onError(err instanceof Error ? err : new Error('Update failed'))
    }
  }

  function handleCancel() {
    setEditTitle(todo.title)
    setEditDescription(todo.description ?? '')
    setEditDueDate(todo.due_date ?? '')
    setEditPriority(todo.priority)
    setEditing(false)
  }

  async function handleDelete() {
    if (!window.confirm('Are you sure you want to delete this todo?')) return
    setDeleting(true)
    try {
      await onDelete(todo.id)
    } catch (err) {
      onError(err instanceof Error ? err : new Error('Delete failed'))
      setDeleting(false)
    }
  }

  if (editing) {
    return (
      <li className="todo-row todo-row--editing" data-testid={`todo-${todo.id}`}>
        <form onSubmit={handleSave} className="todo-edit-form">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            aria-label="Edit title"
            className="todo-edit-input"
            required
          />
          <input
            type="text"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            aria-label="Edit description"
            className="todo-edit-input"
            placeholder="Description (optional)"
          />
          <input
            type="date"
            value={editDueDate}
            onChange={(e) => setEditDueDate(e.target.value)}
            aria-label="Edit due date"
            className="todo-edit-input"
          />
          <select
            value={editPriority}
            onChange={(e) =>
              setEditPriority(e.target.value as Todo['priority'])
            }
            aria-label="Edit priority"
            className="todo-edit-input"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button type="submit" className="todo-btn todo-btn--save">
            Save
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="todo-btn todo-btn--cancel"
          >
            Cancel
          </button>
        </form>
      </li>
    )
  }

  return (
    <li
      className={`todo-row${todo.completed ? ' todo-row--completed' : ''}`}
      data-testid={`todo-${todo.id}`}
    >
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={handleToggle}
        aria-label={`Mark "${todo.title}" as ${todo.completed ? 'active' : 'completed'}`}
        className="todo-checkbox"
        data-testid={`todo-checkbox-${todo.id}`}
      />
      <div className="todo-content">
        <span className="todo-title">{todo.title}</span>
        {todo.description && (
          <span className="todo-description">{todo.description}</span>
        )}
        <div className="todo-meta">
          {todo.due_date && (
            <span className="todo-due">{todo.due_date}</span>
          )}
          <span className={`todo-priority todo-priority--${todo.priority}`}>
            {PRIORITY_LABELS[todo.priority]}
          </span>
        </div>
      </div>
      <div className="todo-actions">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="todo-btn todo-btn--edit"
          aria-label={`Edit "${todo.title}"`}
          data-testid={`edit-btn-${todo.id}`}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="todo-btn todo-btn--delete"
          aria-label={`Delete "${todo.title}"`}
          data-testid={`delete-btn-${todo.id}`}
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </li>
  )
}
