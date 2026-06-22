// src/test/Login.test.tsx
// Story: S-AUTH-04 acceptance tests
// Maps to REQ: REQ-002
//
// Covers AC1 (form fields + submit), AC2 (401 → generic error),
// navigation to /todos on success, and validation errors.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { LoginForm } from '../components/auth/LoginForm'
import { AuthProvider } from '../contexts/AuthContext'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildOkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const VALID_USER = {
  id: 'u-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  created_at: '2026-06-21T00:00:00.000Z',
}

/** Build a JWT-shaped string with the given payload claims. */
function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.fake-sig`
}

/** Render LoginForm wrapped in a MemoryRouter + AuthProvider. */
function renderLogin({ initialEntries = ['/login'] } = {}) {
  const onLogin = vi.fn()
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginForm onLogin={onLogin} />} />
          <Route
            path="/todos"
            element={
              <div>
                <h1>Todos page</h1>
              </div>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return { onLogin }
}

async function fillLoginForm(
  overrides?: Partial<{ email: string; password: string }>,
) {
  const user = userEvent.setup()
  const fields = {
    email: 'ada@example.com',
    password: 'super-secret',
    ...overrides,
  }
  await user.type(screen.getByLabelText('Email'), fields.email)
  await user.type(screen.getByLabelText('Password'), fields.password)
  return user
}

// ---------------------------------------------------------------------------
// LoginForm unit tests
// ---------------------------------------------------------------------------

describe('LoginForm', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC1: form has email + password fields and a submit button.
  it('renders email and password fields and a submit button', () => {
    renderLogin()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument()
  })

  // AC1: submitting empty form shows validation errors, no fetch.
  it('shows validation errors and skips fetch when submitting empty form', async () => {
    renderLogin()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Email is required.')).toBeInTheDocument()
    expect(
      screen.getByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // AC1: invalid email blocked client-side.
  it('shows a validation error for an invalid email and does not call fetch', async () => {
    renderLogin()
    await fillLoginForm({ email: 'not-an-email' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByText('Enter a valid email address.'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // AC1: short password blocked client-side.
  it('shows a validation error when password is shorter than 8 characters', async () => {
    renderLogin()
    await fillLoginForm({ password: 'short' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // AC1: successful submit calls POST /api/v1/auth/login.
  it('POSTs to /api/v1/auth/login with credentials on successful submit', async () => {
    fetchMock.mockResolvedValueOnce(
      buildOkResponse({
        user: VALID_USER,
        access_token: buildJwt({
          sub: 'u-1',
          email: 'ada@example.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      }),
    )

    renderLogin()
    await fillLoginForm()
    await userEvent.setup().click(
      screen.getByRole('button', { name: /sign in/i }),
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/auth/login')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'ada@example.com',
      password: 'super-secret',
    })
  })

  // AC2: 401 → "Invalid email or password" (generic message).
  it('shows "Invalid email or password" on a 401 response', async () => {
    fetchMock.mockResolvedValueOnce(
      buildOkResponse(
        { error: 'invalid_credentials', message: 'Bad creds' },
        401,
      ),
    )

    renderLogin()
    await fillLoginForm()
    await userEvent.setup().click(
      screen.getByRole('button', { name: /sign in/i }),
    )

    expect(
      await screen.findByText('Invalid email or password.'),
    ).toBeInTheDocument()
  })

  // Submit button disabled during request.
  it('disables the submit button and shows a loading label while the request is in flight', async () => {
    let resolveFetch!: (v: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderLogin()
    await fillLoginForm()

    const submit = screen.getByRole('button', { name: /sign in/i })
    await userEvent.setup().click(submit)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /signing in/i }),
      ).toBeDisabled()
    })

    resolveFetch(
      buildOkResponse({
        user: VALID_USER,
        access_token: buildJwt({ sub: 'u-1', exp: 9999999999 }),
      }),
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /sign in/i }),
      ).not.toBeDisabled(),
    )
  })

  // Network error → generic message.
  it('shows a network error message when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network fail'))

    renderLogin()
    await fillLoginForm()
    await userEvent.setup().click(
      screen.getByRole('button', { name: /sign in/i }),
    )

    expect(
      await screen.findByText('Network error. Please try again.'),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Page-level suite: confirms navigation on success.
// ---------------------------------------------------------------------------

describe('Login page navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('navigates to /todos after a successful login response', async () => {
    const { default: Login } = await import('../pages/Login')
    const fetchMock = vi
      .mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: VALID_USER,
            access_token: buildJwt({
              sub: 'u-1',
              email: 'ada@example.com',
              exp: Math.floor(Date.now() / 1000) + 3600,
            }),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/todos"
              element={
                <div>
                  <h1>Todos page</h1>
                </div>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'super-secret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Todos page' }),
      ).toBeInTheDocument()
    })
  })
})
