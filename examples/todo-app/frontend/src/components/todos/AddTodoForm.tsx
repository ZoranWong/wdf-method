// src/components/todos/AddTodoForm.tsx
// Story: S-TODO-04 (frontend)
// Maps to REQ: REQ-004
//
// Controlled form for creating a new todo. Client-side validation via
// zod (createTodoSchema) runs before the network call. Server-side
// validation errors (400) are mapped onto the relevant fields.
//
// Fields:
//   - title (required, 1-200 chars)
//   - description (optional, max 2000 chars)
//   - due_date (optional, date input)
//   - priority (optional, select: low/medium/high)

import { useState } from 'react'
import type { FormEvent } from 'react'
import { createTodoSchema } from '../../schemas/todos'
import { ApiError } from '../../api/auth'
import type { CreateTodoInput } from '../../api/todos'

interface AddTodoFormProps {
  onCreate: (input: CreateTodoInput) => Promise<unknown>
  onError: (err: Error) => void
}

type FieldName = 'title' | 'description' | 'due_date' | 'priority'

interface FormState {
  title: string
  description: string
  due_date: string
  priority: 'low' | 'medium' | 'high'
}

const EMPTY: FormState = {
  title: '',
  description: '',
  due_date: '',
  priority: 'medium',
}

/**
 * Merge server-side field errors (from 400 response) with existing
 * client-side errors. Supports both `details` and `issues` shapes.
 */
function mergeServerErrors(
  err: ApiError,
  existing: Partial<Record<FieldName, string>>,
): Partial<Record<FieldName, string>> {
  const merged = { ...existing }
  for (const issue of err.fieldErrors) {
    const field = String(issue.path[0]) as FieldName
    if (
      (field === 'title' ||
        field === 'description' ||
        field === 'due_date' ||
        field === 'priority') &&
      !merged[field]
    ) {
      merged[field] = issue.message
    }
  }
  return merged
}

export function AddTodoForm({ onCreate, onError }: AddTodoFormProps) {
  const [values, setValues] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [submitting, setSubmitting] = useState(false)

  function updateField(field: FieldName, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return

    // Client-side validation
    const parsed = createTodoSchema.safeParse({
      title: values.title,
      description: values.description || undefined,
      due_date: values.due_date || undefined,
      priority: values.priority,
    })

    if (!parsed.success) {
      const fieldErrors: Partial<Record<FieldName, string>> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]) as FieldName
        if (
          (key === 'title' ||
            key === 'description' ||
            key === 'due_date' ||
            key === 'priority') &&
          !fieldErrors[key]
        ) {
          fieldErrors[key] = issue.message
        }
      }
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setSubmitting(true)

    try {
      const input: CreateTodoInput = {
        title: parsed.data.title,
      }
      if (parsed.data.description) {
        input.description = parsed.data.description
      }
      if (parsed.data.due_date) {
        input.due_date = parsed.data.due_date
      }
      if (parsed.data.priority) {
        input.priority = parsed.data.priority
      }

      await onCreate(input)
      setValues(EMPTY)
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setErrors(mergeServerErrors(err, errors))
      } else {
        onError(err instanceof Error ? err : new Error('Failed to create todo'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const fieldError = (f: FieldName) => errors[f]

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Add todo form">
      <div className="form-field">
        <label className="form-field__label" htmlFor="todo-title">
          Title
        </label>
        <input
          id="todo-title"
          name="title"
          type="text"
          className={
            'form-field__input' +
            (fieldError('title') ? ' form-field__input--error' : '')
          }
          value={values.title}
          onChange={(e) => updateField('title', e.target.value)}
          aria-invalid={Boolean(fieldError('title'))}
          aria-describedby={
            fieldError('title') ? 'todo-title-error' : undefined
          }
          placeholder="What needs to be done?"
          required
        />
        {fieldError('title') && (
          <span
            id="todo-title-error"
            className="form-field__error"
            role="alert"
          >
            {fieldError('title')}
          </span>
        )}
      </div>

      <div className="form-field">
        <label className="form-field__label" htmlFor="todo-description">
          Description
        </label>
        <textarea
          id="todo-description"
          name="description"
          className={
            'form-field__input' +
            (fieldError('description') ? ' form-field__input--error' : '')
          }
          value={values.description}
          onChange={(e) => updateField('description', e.target.value)}
          aria-invalid={Boolean(fieldError('description'))}
          placeholder="Optional details..."
          rows={2}
        />
        {fieldError('description') && (
          <span
            id="todo-description-error"
            className="form-field__error"
            role="alert"
          >
            {fieldError('description')}
          </span>
        )}
      </div>

      <div className="form-field">
        <label className="form-field__label" htmlFor="todo-due-date">
          Due date
        </label>
        <input
          id="todo-due-date"
          name="due_date"
          type="date"
          className="form-field__input"
          value={values.due_date}
          onChange={(e) => updateField('due_date', e.target.value)}
        />
      </div>

      <div className="form-field">
        <label className="form-field__label" htmlFor="todo-priority">
          Priority
        </label>
        <select
          id="todo-priority"
          name="priority"
          className="form-field__input"
          value={values.priority}
          onChange={(e) => updateField('priority', e.target.value)}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <button
        type="submit"
        className="form__submit"
        disabled={submitting}
        aria-busy={submitting}
        data-testid="add-todo-submit"
      >
        {submitting ? 'Adding...' : 'Add Todo'}
      </button>
    </form>
  )
}
