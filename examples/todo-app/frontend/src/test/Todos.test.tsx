// src/test/Todos.test.tsx
// Story: S-TODO-04 acceptance tests
// Maps to REQ: REQ-004, REQ-005, REQ-006
//
// Integration tests covering AC1-AC8 from the story file:
//   AC1: POST creates todo → 201, new todo appears in list
//   AC2: GET returns user's todos, newest first
//   AC3: Filter tabs toggle status, only matching todos shown
//   AC4: Edit title → PATCH sent; 404 → todo stays / error shown
//   AC5: Delete → DELETE sent; 404 → error shown
//   AC7: Invalid title → 400, field errors shown
//   AC8: 401 response → logout + redirect to /login
//   Plus: empty state, loading state, error toast

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '../contexts/AuthContext'
import Todos from '../pages/Todos'
import type { Todo } from '../api/todos'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER = {
  id: 'u-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  created_at: '2026-06-21T00:00:00.000Z',
}

function buildJwt(): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(
    JSON.stringify({
      sub: 'u-1',
      email: 'ada@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
  return `${header}.${body}.fake-sig`
}

let todoIdCounter = 0

function makeTodo(overrides?: Partial<Todo>): Todo {
  todoIdCounter++
  const now = new Date().toISOString()
  return {
    id: `todo-${todoIdCounter}`,
    user_id: 'u-1',
    title: `Todo ${todoIdCounter}`,
    description: null,
    due_date: null,
    priority: 'medium',
    completed: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status })
}

/**
 * Pre-seed localStorage with valid auth data so AuthProvider restores
 * the session without making a /refresh call on mount.
 */
function seedAuth(): void {
  localStorage.setItem(
    'auth_user',
    JSON.stringify({ user: TEST_USER, accessToken: buildJwt() }),
  )
  localStorage.setItem('auth_access_token', buildJwt())
}

/** Render the full Todos page wrapped in MemoryRouter + AuthProvider. */
function renderTodos(): void {
  render(
    <MemoryRouter initialEntries={['/todos']}>
      <AuthProvider>
        <Routes>
          <Route path="/todos" element={<Todos />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Todos page (S-TODO-04)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
    todoIdCounter = 0
    seedAuth()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // ----- Empty state -----

  it('shows empty state message when no todos exist', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    renderTodos()

    expect(
      await screen.findByText('No todos yet. Create one above.'),
    ).toBeInTheDocument()
  })

  // ----- Loading state -----

  it('shows loading skeletons while fetching todos', () => {
    // Never-resolving promise keeps loading = true
    fetchMock.mockReturnValueOnce(
      new Promise<Response>(() => {
        /* never resolves */
      }),
    )

    renderTodos()

    const skeletons = screen.getAllByTestId('skeleton-row')
    expect(skeletons.length).toBe(3)
  })

  // ----- AC2: list renders user's todos, newest first -----

  it('renders todos from the backend (AC2)', async () => {
    const todos = [
      makeTodo({ id: 't-1', title: 'First todo' }),
      makeTodo({ id: 't-2', title: 'Second todo' }),
    ]
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: todos }))

    renderTodos()

    expect(await screen.findByText('First todo')).toBeInTheDocument()
    expect(screen.getByText('Second todo')).toBeInTheDocument()
  })

  // ----- AC1: POST creates todo → 201, new todo appears -----

  it('creates a todo via POST and shows it in the list (AC1)', async () => {
    const user = userEvent.setup()

    // Initial GET — empty list
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    renderTodos()
    await screen.findByText('No todos yet. Create one above.')

    // POST response
    const newTodo = makeTodo({ id: 't-new', title: 'Buy groceries' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: newTodo }, 201))

    // Fill in title and submit
    await user.type(screen.getByLabelText('Title'), 'Buy groceries')
    await user.click(screen.getByTestId('add-todo-submit'))

    // Verify the POST request
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === '/api/v1/todos' &&
          (init as RequestInit).method === 'POST',
      )
      expect(postCall).toBeTruthy()
    })

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/v1/todos' &&
        (init as RequestInit).method === 'POST',
    )!
    const [, postInit] = postCall
    expect(postInit).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({
      title: 'Buy groceries',
      priority: 'medium',
    })

    // New todo appears in the list
    expect(await screen.findByText('Buy groceries')).toBeInTheDocument()
  })

  // ----- AC3: filter tabs toggle status -----

  it('filter tabs switch between all/active/completed (AC3)', async () => {
    const user = userEvent.setup()

    const activeTodo = makeTodo({
      id: 't-1',
      title: 'Active task',
      completed: false,
    })
    const completedTodo = makeTodo({
      id: 't-2',
      title: 'Done task',
      completed: true,
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [activeTodo, completedTodo] }),
    )

    renderTodos()

    // Both visible in "All" tab
    expect(await screen.findByText('Active task')).toBeInTheDocument()
    expect(screen.getByText('Done task')).toBeInTheDocument()

    // Verify counts in tabs
    expect(screen.getByText('All (2)')).toBeInTheDocument()
    expect(screen.getByText('Active (1)')).toBeInTheDocument()
    expect(screen.getByText('Completed (1)')).toBeInTheDocument()

    // Click "Active" — only active todo visible
    await user.click(screen.getByText('Active (1)'))
    expect(screen.getByText('Active task')).toBeInTheDocument()
    expect(screen.queryByText('Done task')).not.toBeInTheDocument()

    // Click "Completed" — only completed todo visible
    await user.click(screen.getByText('Completed (1)'))
    expect(screen.queryByText('Active task')).not.toBeInTheDocument()
    expect(screen.getByText('Done task')).toBeInTheDocument()

    // Click "All" — both visible again
    await user.click(screen.getByText('All (2)'))
    expect(screen.getByText('Active task')).toBeInTheDocument()
    expect(screen.getByText('Done task')).toBeInTheDocument()
  })

  // ----- AC4: PATCH updates a todo; 404 shows error -----

  it('PATCHes title on edit save (AC4)', async () => {
    const user = userEvent.setup()

    const todo = makeTodo({ id: 't-1', title: 'Original title' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [todo] }))

    renderTodos()
    expect(await screen.findByText('Original title')).toBeInTheDocument()

    // Enter edit mode
    await user.click(screen.getByTestId('edit-btn-t-1'))

    // Clear and type new title
    const editInput = screen.getByLabelText('Edit title')
    await user.clear(editInput)
    await user.type(editInput, 'Updated title')

    // PATCH response
    const updatedTodo = makeTodo({ id: 't-1', title: 'Updated title' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: updatedTodo }))

    // Save
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Verify PATCH request
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === '/api/v1/todos/t-1' &&
          (init as RequestInit).method === 'PATCH',
      )
      expect(patchCall).toBeTruthy()
    })

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/v1/todos/t-1' &&
        (init as RequestInit).method === 'PATCH',
    )!
    const [, patchInit] = patchCall
    expect(patchInit).toMatchObject({
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    const patchBody = JSON.parse((patchInit as RequestInit).body as string)
    expect(patchBody.title).toBe('Updated title')

    // Updated title appears in the list
    expect(await screen.findByText('Updated title')).toBeInTheDocument()
  })

  it('shows error when PATCH returns 404 (AC4)', async () => {
    const user = userEvent.setup()

    const todo = makeTodo({ id: 't-1', title: 'Original title' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [todo] }))

    renderTodos()
    expect(await screen.findByText('Original title')).toBeInTheDocument()

    // Enter edit mode
    await user.click(screen.getByTestId('edit-btn-t-1'))

    const editInput = screen.getByLabelText('Edit title')
    await user.clear(editInput)
    await user.type(editInput, 'Updated title')

    // PATCH → 404
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'not_found' }, 404),
    )

    // After 404, the hook calls load() to rollback — mock the GET
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [todo] }), // server still has the old todo
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Error toast appears
    expect(await screen.findByTestId('error-toast')).toBeInTheDocument()
    // Todo is still in the list (rollback)
    expect(await screen.findByText('Original title')).toBeInTheDocument()
  })

  // ----- AC5: DELETE removes todo; 404 shows error -----

  it('DELETEs a todo on confirm (AC5)', async () => {
    const user = userEvent.setup()

    const todo = makeTodo({ id: 't-1', title: 'To be deleted' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [todo] }))

    renderTodos()
    expect(await screen.findByText('To be deleted')).toBeInTheDocument()

    // Mock window.confirm to return true
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    // DELETE → 204
    fetchMock.mockResolvedValueOnce(emptyResponse(204))

    await user.click(screen.getByTestId('delete-btn-t-1'))

    // Verify DELETE request
    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === '/api/v1/todos/t-1' &&
          (init as RequestInit).method === 'DELETE',
      )
      expect(deleteCall).toBeTruthy()
    })

    const deleteCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/v1/todos/t-1' &&
        (init as RequestInit).method === 'DELETE',
    )!
    expect(deleteCall[1]).toMatchObject({ credentials: 'include' })

    // Todo disappears from the list
    await waitFor(() => {
      expect(screen.queryByText('To be deleted')).not.toBeInTheDocument()
    })
  })

  it('shows error when DELETE returns 404 (AC5)', async () => {
    const user = userEvent.setup()

    const todo = makeTodo({ id: 't-1', title: 'Ghost todo' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [todo] }))

    renderTodos()
    expect(await screen.findByText('Ghost todo')).toBeInTheDocument()

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    // DELETE → 404
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'not_found' }, 404),
    )

    // After 404, the hook calls load() to rollback
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [todo] }),
    )

    await user.click(screen.getByTestId('delete-btn-t-1'))

    // Error toast appears
    expect(await screen.findByTestId('error-toast')).toBeInTheDocument()

    // Todo is restored (rollback) — wait for it to reappear
    await waitFor(
      () => {
        expect(screen.getByText('Ghost todo')).toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  })

  // ----- AC7: 400 → field errors -----

  it('shows field errors when POST returns 400 (AC7)', async () => {
    const user = userEvent.setup()

    // Initial GET — empty list
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    renderTodos()
    await screen.findByText('No todos yet. Create one above.')

    // POST → 400 with validation errors
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'validation_error',
          message: 'Invalid input.',
          issues: [{ path: ['title'], message: 'Title is too short.' }],
        },
        400,
      ),
    )

    // Submit with a title (to pass client-side validation)
    await user.type(screen.getByLabelText('Title'), 'x')
    await user.click(screen.getByTestId('add-todo-submit'))

    // Server-side error appears on the title field
    expect(await screen.findByText('Title is too short.')).toBeInTheDocument()
  })

  it('blocks empty title via client-side validation (AC7)', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    renderTodos()
    await screen.findByText('No todos yet. Create one above.')

    // Click submit without typing anything
    await user.click(screen.getByTestId('add-todo-submit'))

    // Client-side validation error
    expect(await screen.findByText('Title is required.')).toBeInTheDocument()
    // No fetch was made for creating
    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit)?.method === 'POST',
    )
    expect(postCalls).toHaveLength(0)
  })

  // ----- AC8: 401 → redirect to /login -----

  it('triggers logout on 401 response (AC8)', async () => {
    const user = userEvent.setup()

    const todo = makeTodo({ id: 't-1', title: 'Some todo' })

    // GET → success
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [todo] }))

    // DELETE → 401
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'unauthorized' }, 401),
    )

    // AuthProvider.logout() calls logoutUser() → POST /api/v1/auth/logout
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    // Note: jsdom logs "Not implemented: navigation" to stderr for
    // window.location.assign('/login') — this is expected, not an error.

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderTodos()
    expect(await screen.findByText('Some todo')).toBeInTheDocument()

    await user.click(screen.getByTestId('delete-btn-t-1'))

    // Verify that the logout endpoint was called (proves 401 → logout flow)
    await waitFor(() => {
      const logoutCall = fetchMock.mock.calls.find(
        ([url]) => url === '/api/v1/auth/logout',
      )
      expect(logoutCall).toBeTruthy()
    })
  })

  // ----- Completed checkbox toggle -----

  it('toggles completed via checkbox (PATCH)', async () => {
    const user = userEvent.setup()

    const todo = makeTodo({ id: 't-1', title: 'Toggle me', completed: false })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [todo] }))

    renderTodos()
    expect(await screen.findByText('Toggle me')).toBeInTheDocument()

    // PATCH response with completed: true
    const toggled = makeTodo({ id: 't-1', title: 'Toggle me', completed: true })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: toggled }))

    const checkbox = screen.getByTestId('todo-checkbox-t-1')
    await user.click(checkbox)

    // Verify PATCH request
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === '/api/v1/todos/t-1' &&
          (init as RequestInit).method === 'PATCH',
      )
      expect(patchCall).toBeTruthy()
    })

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/v1/todos/t-1' &&
        (init as RequestInit).method === 'PATCH',
    )!
    const patchBody = JSON.parse(
      ((patchCall[1] as RequestInit).body) as string,
    )
    expect(patchBody).toEqual({ completed: true })
  })

  // ----- Priority + due date in create form -----

  it('sends priority and due_date in the create request', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    renderTodos()
    await screen.findByText('No todos yet. Create one above.')

    const newTodo = makeTodo({
      id: 't-new',
      title: 'Important task',
      priority: 'high',
      due_date: '2026-12-31',
    })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: newTodo }, 201))

    await user.type(screen.getByLabelText('Title'), 'Important task')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.type(screen.getByLabelText('Due date'), '2026-12-31')
    await user.click(screen.getByTestId('add-todo-submit'))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === '/api/v1/todos' &&
          (init as RequestInit).method === 'POST',
      )
      expect(postCall).toBeTruthy()
    })

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/v1/todos' &&
        (init as RequestInit).method === 'POST',
    )!
    const body = JSON.parse(
      ((postCall[1] as RequestInit).body) as string,
    )
    expect(body).toEqual({
      title: 'Important task',
      due_date: '2026-12-31',
      priority: 'high',
    })
  })

  // ----- Logout button -----

  it('renders a logout button in the header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    renderTodos()
    expect(await screen.findByTestId('logout-btn')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  // ----- Edit cancel reverts changes -----

  it('edit cancel reverts to original values', async () => {
    const user = userEvent.setup()

    const todo = makeTodo({ id: 't-1', title: 'Original' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [todo] }))

    renderTodos()
    expect(await screen.findByText('Original')).toBeInTheDocument()

    // Enter edit mode
    await user.click(screen.getByTestId('edit-btn-t-1'))

    // Change the title
    const editInput = screen.getByLabelText('Edit title')
    await user.clear(editInput)
    await user.type(editInput, 'Changed')

    // Cancel
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    // Original title should still be visible (no PATCH was made)
    expect(screen.getByText('Original')).toBeInTheDocument()

    // Verify no PATCH call was made
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit)?.method === 'PATCH',
    )
    expect(patchCalls).toHaveLength(0)
  })
})
