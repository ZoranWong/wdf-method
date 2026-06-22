// src/api/auth.ts
// Stories: S-AUTH-02 (register), S-AUTH-04 (login / refresh / logout)
// Maps to REQ: REQ-001, REQ-002
//
// Thin fetch wrapper for the auth surface exposed by the S-AUTH-01
// backend (see backend/src/routes/auth.ts). The browser automatically
// attaches the httpOnly access_token + refresh_token cookies set by
// the server because every call uses `credentials: 'include'`. We
// NEVER read those cookies from JS — they are not visible to
// document.cookie by design.

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
}

/**
 * Error shapes the S-AUTH-01 backend produces:
 *
 * - 400 INVALID_INPUT      → { error: 'INVALID_INPUT', message, details[] }
 * - 409 EMAIL_TAKEN        → { error: 'EMAIL_TAKEN',   message }
 * - 401 INVALID_CREDENTIALS → { error: 'invalid_credentials' }
 *
 * The `details` array uses the zod issue shape (path + message) so the
 * form can map each issue back onto its source field.
 */
export interface FieldError {
  path: (string | number)[];
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

const REGISTER_URL = '/api/v1/auth/register';
const LOGIN_URL = '/api/v1/auth/login';
const REFRESH_URL = '/api/v1/auth/refresh';
const LOGOUT_URL = '/api/v1/auth/logout';

// ---------------------------------------------------------------------------
// JWT helpers (S-AUTH-04)
// ---------------------------------------------------------------------------

/**
 * Decode the payload of a JWT without verifying its signature.
 * The access_token cookie is httpOnly (not readable from JS), so we
 * rely on the response body from /login to obtain the raw JWT, then
 * decode the payload to extract {sub, email, exp, ...}.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    return JSON.parse(atob(parts[1]));
  } catch {
    return {};
  }
}

/** Return true when the JWT's `exp` claim is in the past. */
export function isJwtExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 < Date.now();
}

// ---------------------------------------------------------------------------
// Register (S-AUTH-02)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/auth/register.
 *
 * On success returns the parsed `{user, access_token}` body (201).
 * On 409/400 throws an `ApiError` carrying the structured error code
 * and (for 400s) the field-level issue list. Any non-201 response that
 * does not parse as our error envelope is surfaced as a generic 500
 * INTERNAL_ERROR so the UI has something deterministic to render.
 */
export async function registerUser(
  input: RegisterInput,
): Promise<AuthResponse> {
  const res = await fetch(REGISTER_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (res.status === 201) {
    return (await res.json()) as AuthResponse;
  }

  // Try to read the structured error body. If the body is not JSON or
  // does not match our envelope, fall through to a generic error.
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (payload && typeof payload === 'object' && 'error' in payload) {
    const p = payload as {
      error?: unknown;
      message?: unknown;
      details?: unknown;
    };
    const code = typeof p.error === 'string' ? p.error : 'UNKNOWN';
    const message =
      typeof p.message === 'string' ? p.message : 'Request failed.';
    const fieldErrors: FieldError[] = Array.isArray(p.details)
      ? (p.details as FieldError[]).filter(
          (d) => d && Array.isArray(d.path) && typeof d.message === 'string',
        )
      : [];
    throw new ApiError(res.status, code, message, fieldErrors);
  }

  throw new ApiError(
    res.status,
    'INTERNAL_ERROR',
    'Unexpected response from server.',
  );
}

// ---------------------------------------------------------------------------
// Login (S-AUTH-04)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/auth/login.
 *
 * Returns `{user, access_token}` on 200.
 * Throws `ApiError(401, 'invalid_credentials', ...)` on bad credentials.
 */
export async function loginUser(input: LoginInput): Promise<AuthResponse> {
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (res.ok) {
    return (await res.json()) as AuthResponse;
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (payload && typeof payload === 'object' && 'error' in payload) {
    const p = payload as { error?: unknown; message?: unknown };
    const code = typeof p.error === 'string' ? p.error : 'UNKNOWN';
    const message =
      typeof p.message === 'string' ? p.message : 'Login failed.';
    throw new ApiError(res.status, code, message);
  }

  throw new ApiError(res.status, 'UNKNOWN', 'Login failed.');
}

// ---------------------------------------------------------------------------
// Refresh (S-AUTH-04)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/auth/refresh.
 *
 * No request body — the browser sends the httpOnly refresh_token cookie
 * automatically (credentials: 'include'). On success the backend
 * rotates the tokens and sets new cookies. Returns true on 2xx.
 */
export async function refreshSession(): Promise<boolean> {
  const res = await fetch(REFRESH_URL, {
    method: 'POST',
    credentials: 'include',
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Logout (S-AUTH-04)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/auth/logout.
 *
 * No request body. The backend clears the httpOnly cookies.
 */
export async function logoutUser(): Promise<void> {
  await fetch(LOGOUT_URL, {
    method: 'POST',
    credentials: 'include',
  });
}
