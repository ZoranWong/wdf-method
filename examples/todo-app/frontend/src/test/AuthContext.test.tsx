// src/test/AuthContext.test.tsx
// Story: S-AUTH-04 acceptance tests
// Maps to REQ: REQ-002, REQ-003
//
// Covers AC3 (context API + persistence + refresh) and AC4
// (ProtectedRoute redirect) and AC5 (logout).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import ProtectedRoute from '../components/auth/ProtectedRoute'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const VALID_JWT = buildJwt({
  sub: 'u-1',
  email: 'ada@example.com',
  exp: Math.floor(Date.now() / 1000) + 3600,
})

const EXPIRED_JWT = buildJwt({
  sub: 'u-1',
  email: 'ada@example.com',
  exp: 1000, // long past
})

/** Minimal component that displays the current auth user (or lack of). */
function AuthConsumer() {
  const { user, login, logout, loading } = useAuth()
  if (loading) return <div>loading</div>
  return (
    <div>
      <div data-testid="auth-user">{user ? user.email : 'no-user'}</div>
      <button
        data-testid="login-btn"
        onClick={() => login(VALID_USER, VALID_JWT)}
      >
        login
      </button>
      <button data-testid="logout-btn" onClick={() => logout()}>
        logout
      </button>
    </div>
  )
}

function renderWithProviders(ui: React.ReactElement, initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests — AuthContext core
// ---------------------------------------------------------------------------

describe('AuthContext', () => {
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

  it('starts with user = null and loading = false when localStorage is empty', async () => {
    renderWithProviders(<AuthConsumer />)
    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe('no-user')
    })
  })

  it('login() sets the user', async () => {
    renderWithProviders(<AuthConsumer />)
    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe('no-user')
    })

    await act(async () => {
      await userEvent.setup().click(screen.getByTestId('login-btn'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe(
        'ada@example.com',
      )
    })
  })

  it('logout() clears the user', async () => {
    // window.location.assign is a no-op in jsdom — no need to mock it.

    // Pre-populate so the user starts logged in.
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ user: VALID_USER, accessToken: VALID_JWT }),
    )
    localStorage.setItem('auth_access_token', VALID_JWT)

    renderWithProviders(<AuthConsumer />)
    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe(
        'ada@example.com',
      )
    })

    await act(async () => {
      await userEvent.setup().click(screen.getByTestId('logout-btn'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe('no-user')
    })

    expect(localStorage.getItem('auth_user')).toBeNull()
    expect(localStorage.getItem('auth_access_token')).toBeNull()
    // logout() should POST /api/v1/auth/logout.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('persists the user to localStorage on login()', async () => {
    renderWithProviders(<AuthConsumer />)
    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe('no-user')
    })

    await act(async () => {
      await userEvent.setup().click(screen.getByTestId('login-btn'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe(
        'ada@example.com',
      )
    })

    const stored = localStorage.getItem('auth_user')
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!)
    expect(parsed.user.email).toBe('ada@example.com')
    expect(localStorage.getItem('auth_access_token')).toBe(VALID_JWT)
  })

  it('restores the user from localStorage on mount (valid JWT, no refresh)', async () => {
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ user: VALID_USER, accessToken: VALID_JWT }),
    )
    localStorage.setItem('auth_access_token', VALID_JWT)

    renderWithProviders(<AuthConsumer />)

    // Should restore without calling fetch (no refresh needed).
    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe(
        'ada@example.com',
      )
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('attempts /refresh on mount when stored JWT is expired', async () => {
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ user: VALID_USER, accessToken: EXPIRED_JWT }),
    )
    localStorage.setItem('auth_access_token', EXPIRED_JWT)

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    )

    renderWithProviders(<AuthConsumer />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/auth/refresh',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe(
        'ada@example.com',
      )
    })
  })

  it('clears user and storage when refresh fails on mount', async () => {
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ user: VALID_USER, accessToken: EXPIRED_JWT }),
    )
    localStorage.setItem('auth_access_token', EXPIRED_JWT)

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 401 }),
    )

    renderWithProviders(<AuthConsumer />)

    await waitFor(() => {
      expect(screen.getByTestId('auth-user').textContent).toBe('no-user')
    })
    expect(localStorage.getItem('auth_user')).toBeNull()
    expect(localStorage.getItem('auth_access_token')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests — ProtectedRoute
// ---------------------------------------------------------------------------

describe('ProtectedRoute', () => {
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

  it('redirects to /login when user is not authenticated', async () => {
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <AuthProvider>
          <Routes>
            <Route
              path="/protected"
              element={
                <ProtectedRoute>
                  <div>Secret content</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument()
    })
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument()
  })

  it('renders children when user is authenticated', async () => {
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ user: VALID_USER, accessToken: VALID_JWT }),
    )
    localStorage.setItem('auth_access_token', VALID_JWT)

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <AuthProvider>
          <Routes>
            <Route
              path="/protected"
              element={
                <ProtectedRoute>
                  <div>Secret content</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Secret content')).toBeInTheDocument()
    })
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()
  })
})
