// src/test/Register.test.tsx
// Story: S-AUTH-02 acceptance tests
// Maps to REQ: REQ-001
//
// Covers AC1..AC8 from the story file. We mock global `fetch` so the
// suite never hits the network — the S-AUTH-01 backend contract is
// asserted via the request body and the canned responses we return.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RegisterForm } from '../components/auth/RegisterForm'
import { AuthProvider } from '../contexts/AuthContext'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function renderFormWithSpy() {
  const onRegistered = vi.fn()
  render(<RegisterForm onRegistered={onRegistered} />)
  return { onRegistered }
}

function renderFormInsideRouter() {
  // Renders RegisterForm inside a tiny router so the form's own
  // useNavigate consumer (used in the page) is not exercised — we
  // cover page-level navigation in a separate suite below.
  render(
    <MemoryRouter>
      <RegisterForm onRegistered={vi.fn()} />
    </MemoryRouter>,
  )
}

function buildOkResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function fillValidForm(overrides?: Partial<{
  name: string
  email: string
  password: string
  confirmPassword: string
}>) {
  const user = userEvent.setup()
  const fields = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'super-secret',
    confirmPassword: 'super-secret',
    ...overrides,
  }
  await user.type(screen.getByLabelText('Name'), fields.name)
  await user.type(screen.getByLabelText('Email'), fields.email)
  await user.type(screen.getByLabelText('Password'), fields.password)
  await user.type(
    screen.getByLabelText('Confirm password'),
    fields.confirmPassword,
  )
  return user
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RegisterForm', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC1: form has the four required fields plus a submit button.
  it('renders name, email, password, confirm-password fields and a submit button', () => {
    renderFormInsideRouter()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /create account/i }),
    ).toBeInTheDocument()
  })

  // AC6: submitting an empty form shows validation errors and does
  // NOT hit the network.
  it('shows validation errors and skips fetch when submitting an empty form', async () => {
    const user = userEvent.setup()
    renderFormInsideRouter()
    await user.click(
      screen.getByRole('button', { name: /create account/i }),
    )

    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    expect(screen.getByText('Email is required.')).toBeInTheDocument()
    expect(
      screen.getByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Please confirm your password.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // AC5 / AC6: invalid email blocked client-side.
  it('shows a validation error for an invalid email and does not call fetch', async () => {
    const user = userEvent.setup()
    renderFormInsideRouter()
    await fillValidForm({ email: 'not-an-email' })
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText('Enter a valid email address.'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // AC6: password shorter than 8 chars is blocked client-side.
  it('shows a validation error when password is shorter than 8 characters', async () => {
    const user = userEvent.setup()
    renderFormInsideRouter()
    await fillValidForm({
      password: 'short',
      confirmPassword: 'short',
    })
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // AC6: password / confirm mismatch is blocked client-side (no fetch).
  it('shows a mismatch error when confirmPassword differs from password', async () => {
    const user = userEvent.setup()
    renderFormInsideRouter()
    await fillValidForm({ confirmPassword: 'different-pw' })
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText('Passwords do not match.'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // AC2: submit issues POST /api/v1/auth/register with credentials:include
  // and the body shape {name, email, password} (no confirmPassword).
  it('POSTs the correct body and credentials on a successful submit', async () => {
    fetchMock.mockResolvedValueOnce(
      buildOkResponse({
        user: {
          id: 'u-1',
          email: 'ada@example.com',
          name: 'Ada Lovelace',
          created_at: '2026-06-21T00:00:00.000Z',
        },
        access_token: 'access-jwt',
      }),
    )

    const { onRegistered } = renderFormWithSpy()
    const user = userEvent.setup()
    await fillValidForm()
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/auth/register')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    // Wire body must NOT carry confirmPassword.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'super-secret',
    })
    expect(onRegistered).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'u-1',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
      }),
      'access-jwt',
    )
  })

  // AC8: button shows loading state and is disabled during the request.
  it('disables the submit button and shows a loading label while the request is in flight', async () => {
    let resolveFetch!: (v: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderFormWithSpy()
    const user = userEvent.setup()
    await fillValidForm()

    const submit = screen.getByRole('button', { name: /create account/i })
    await user.click(submit)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /creating account/i }),
      ).toBeDisabled()
    })

    resolveFetch(
      buildOkResponse({
        user: { id: 'u-1', email: 'a@b.com', name: 'A', created_at: '' },
        access_token: 'jwt',
      }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /create account/i }),
      ).not.toBeDisabled(),
    )
  })

  // AC4: 409 EMAIL_TAKEN surfaces an inline error on the email field.
  it('shows an "email already registered" error on a 409 response', async () => {
    fetchMock.mockResolvedValueOnce(
      buildOkResponse(
        {
          error: 'EMAIL_TAKEN',
          message: 'An account with this email already exists.',
        },
        409,
      ),
    )

    renderFormWithSpy()
    const user = userEvent.setup()
    await fillValidForm()
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText('Email already registered.'),
    ).toBeInTheDocument()
  })

  // AC5: 400 INVALID_INPUT surfaces field-level errors next to inputs.
  it('maps a 400 INVALID_INPUT response onto field-level errors', async () => {
    fetchMock.mockResolvedValueOnce(
      buildOkResponse(
        {
          error: 'INVALID_INPUT',
          message: 'Request body failed validation.',
          details: [
            {
              path: ['email'],
              message: 'Enter a valid email address.',
            },
            {
              path: ['password'],
              message: 'Password must be at least 8 characters.',
            },
          ],
        },
        400,
      ),
    )

    renderFormWithSpy()
    const user = userEvent.setup()
    await fillValidForm()
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText('Enter a valid email address.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.getByText('Password must be at least 8 characters.'),
      ).toBeInTheDocument()
    })
  })

  // AC7: tab order is name → email → password → confirm → submit.
  it('supports the expected keyboard tab order', async () => {
    renderFormInsideRouter()
    const user = userEvent.setup()
    const name = screen.getByLabelText('Name')
    const email = screen.getByLabelText('Email')
    const password = screen.getByLabelText('Password')
    const confirm = screen.getByLabelText('Confirm password')

    name.focus()
    expect(document.activeElement).toBe(name)
    await user.tab()
    expect(document.activeElement).toBe(email)
    await user.tab()
    expect(document.activeElement).toBe(password)
    await user.tab()
    expect(document.activeElement).toBe(confirm)
  })
})

// ---------------------------------------------------------------------------
// Page-level suite: confirms navigation on success (AC3).
// ---------------------------------------------------------------------------

describe('Register page navigation (AC3)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('navigates to /todos after a successful 201 response', async () => {
    // Lazy import so the suite picks up the same React module graph.
    const { default: Register } = await import('../pages/Register')
    const fetchMock = vi
      .mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: 'u-1',
              email: 'ada@example.com',
              name: 'Ada',
              created_at: '2026-06-21T00:00:00.000Z',
            },
            access_token: 'jwt',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      )

    render(
      <MemoryRouter initialEntries={['/register']}>
        <AuthProvider>
          <Routes>
            <Route path="/register" element={<Register />} />
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
    await user.type(screen.getByLabelText('Name'), 'Ada')
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'super-secret')
    await user.type(
      screen.getByLabelText('Confirm password'),
      'super-secret',
    )
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Todos page' }),
      ).toBeInTheDocument()
    })
  })
})
