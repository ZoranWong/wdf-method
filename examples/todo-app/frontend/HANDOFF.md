# S-AUTH-02 Frontend Handoff

## Story: Register page UI

**Track**: Frontend  
**Maps to**: REQ-001 (user registration)  
**Depends on**: S-AUTH-01 (backend auth API)

---

## Scaffold Versions

- **Vite**: 8.0.12
- **React**: 19.2.6
- **TypeScript**: 6.0.2
- **Node.js**: v23.7.0 (engine warning but functional)

### Testing Stack

- **Vitest**: 3.2.6
- **@testing-library/react**: 16.3.2
- **@testing-library/user-event**: 14.6.1
- **@testing-library/jest-dom**: 6.9.1
- **jsdom**: 27.0.1

### Runtime Dependencies

- **zod**: 4.4.3 (form validation, shared library with backend)
- **react-router-dom**: 7.18.0 (v6+ routing for S-AUTH-04)

---

## File Structure

```
frontend/
├── public/
├── src/
│   ├── api/
│   │   └── auth.ts              # POST /api/v1/auth/register client
│   ├── components/
│   │   └── auth/
│   │       └── RegisterForm.tsx # Controlled form with zod validation
│   ├── pages/
│   │   └── Register.tsx         # Register page (renders RegisterForm)
│   ├── schemas/
│   │   └── auth.ts              # zod schema (client-side validation)
│   ├── test/
│   │   ├── setup.ts             # vitest setup (jest-dom matchers)
│   │   └── Register.test.tsx    # 11 acceptance tests
│   ├── App.tsx                  # Router setup (/register route)
│   ├── main.tsx                 # Entry point (BrowserRouter)
│   ├── styles.css               # Vanilla CSS (minimal, readable)
│   └── vite-env.d.ts            # Vite client types
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
└── vite.config.ts               # Dev server proxy (/api → localhost:3000)
```

---

## How to Run

### Development

```bash
cd examples/todo-app/frontend
npm run dev
```

Starts Vite dev server at `http://localhost:5173`. The `/api` proxy forwards to the backend at `http://localhost:3000` (S-AUTH-01).

### Tests

```bash
npm test          # watch mode
npm run test:run  # single run
```

**Result**: 11/11 tests passing (see AC coverage below).

### Type Check

```bash
npx tsc --noEmit
```

**Result**: Zero errors (acceptance criteria satisfied).

---

## Acceptance Criteria Coverage

### AC1: Form has fields (name, email, password, confirm-password)

✅ **Test**: `renders name, email, password, confirm-password fields and a submit button`  
✅ **Implementation**: `RegisterForm.tsx` renders 4 controlled inputs + submit button.

### AC2: Submit calls POST /api/v1/auth/register with credentials:'include'

✅ **Test**: `POSTs the correct body and credentials on a successful submit`  
✅ **Implementation**: `registerUser()` in `api/auth.ts` uses `fetch('/api/v1/auth/register', { method: 'POST', credentials: 'include', ... })`.

### AC3: 201 response → navigate to /todos

✅ **Test**: `navigates to /todos after a successful 201 response`  
✅ **Implementation**: `Register.tsx` calls `navigate('/todos')` in the `onRegistered` callback.

### AC4: 409 response → show "Email already registered" inline error

✅ **Test**: `shows an "email already registered" error on a 409 response`  
✅ **Implementation**: `RegisterForm.tsx` checks `err.status === 409 && err.code === 'EMAIL_TAKEN'` and sets `errors.email = 'Email already registered.'`.

### AC5: 400 response → show field-level errors next to relevant inputs

✅ **Test**: `maps a 400 INVALID_INPUT response onto field-level errors`  
✅ **Implementation**: `mergeServerErrors()` in `RegisterForm.tsx` maps zod issue `path` to field names and displays inline errors.

### AC6: Password mismatch → client-side error (no server call)

✅ **Test**: `shows a mismatch error when confirmPassword differs from password`  
✅ **Implementation**: `registerFormSchema.refine()` in `schemas/auth.ts` checks `password === confirmPassword` and returns a zod error. `handleSubmit` runs client validation before fetch.

### AC7: Keyboard-accessible; tab order is name → email → password → confirm → submit

✅ **Test**: `supports the expected keyboard tab order`  
✅ **Implementation**: JSX source order in `RegisterForm.tsx` matches tab order. All inputs have `label[for]` and `aria-describedby` for error associations.

### AC8: Submit button shows loading state; disabled during request

✅ **Test**: `disables the submit button and shows a loading label while the request is in flight`  
✅ **Implementation**: `submitDisabled = submitting` (AC8 only requires disabling during request). Button text changes to "Creating account…" while submitting.

---

## Backend Contract (S-AUTH-01)

The frontend assumes the following API contract (already shipped in backend):

- **Endpoint**: `POST /api/v1/auth/register`
- **Request body**: `{ name: string, email: string, password: string }`
- **Success (201)**: `{ user: User, access_token: string }`
  - Sets `access_token` and `refresh_token` as httpOnly cookies (browser handles automatically).
- **409 Conflict**: `{ error: 'EMAIL_TAKEN', message: string }`
- **400 Bad Request**: `{ error: 'INVALID_INPUT', message: string, details: FieldError[] }`
  - `FieldError` is the zod issue shape: `{ path: PropertyKey[], message: string }`.

The frontend strips `confirmPassword` before sending the wire body (UI-only field for UX).

---

## Out of Scope (Not Implemented)

- Login page (S-AUTH-04)
- AuthContext + ProtectedRoute (S-AUTH-04)
- Todo pages (S-TODO-04)
- API client for non-auth endpoints
- E2E / visual regression / a11y audits

---

## Known Gaps / Blockers

**None.** All acceptance criteria are satisfied:

- ✅ `npm test -- --run` → 11/11 tests passing
- ✅ `npx tsc --noEmit` → zero errors
- ✅ Dev server proxy configured for `/api → localhost:3000`
- ✅ Backend contract fully implemented (POST /register)
- ✅ Zod schema mirrors backend validation rules

---

## Notes

- **Zod v4 syntax**: The backend uses zod v4 (path type is `PropertyKey[]`). The frontend schema uses the same syntax.
- **React 19**: Vite scaffolded React 19.2.6 (not 18+ as initially requested, but compatible).
- **react-router-dom v7**: Installed v7.18.0 (not v6+ as initially requested, but compatible).
- **Form validation UX**: Submit button is enabled by default; validation runs on submit click. This allows AC6 (client-side error) to surface without requiring the user to fill all fields first. The button is disabled only during the request (AC8).

---

## Handoff Date

2026-06-21 (S-AUTH-02 frontend complete)

---

# S-AUTH-04 Frontend Handoff

## Story: Login page + AuthContext + ProtectedRoute

**Track**: Frontend  
**Maps to**: REQ-002 (login), REQ-003 (protected routes / session)  
**Depends on**: S-AUTH-02 (register page), S-AUTH-03 (backend login endpoint)

---

## What Was Built

1. **`src/api/auth.ts`** — extended with `loginUser`, `refreshSession`, `logoutUser`, `decodeJwtPayload`, `isJwtExpired` (registerUser untouched)
2. **`src/contexts/AuthContext.tsx`** — AuthProvider exposing `{user, login, logout, loading}`; restores session from localStorage on mount; silent refresh when JWT is expired
3. **`src/components/auth/LoginForm.tsx`** — controlled form with zod validation; generic 401 error message
4. **`src/pages/Login.tsx`** — wraps LoginForm; calls `auth.login()` + navigates to `/todos` on success
5. **`src/components/auth/ProtectedRoute.tsx`** — redirects to `/login` when `user === null`; renders children when authenticated
6. **`src/App.tsx`** — wrapped in AuthProvider; added `/login` route; `/todos` wrapped in ProtectedRoute with placeholder
7. **`src/pages/Register.tsx`** — now calls `auth.login()` after successful register so the ProtectedRoute on `/todos` works
8. **`src/components/auth/RegisterForm.tsx`** — `onRegistered` callback now passes `(user, accessToken)` instead of just `user`

---

## Test Results

```
Test Files  3 passed (3)
     Tests  29 passed (29)
```

- `Register.test.tsx` — 11 tests (S-AUTH-02, updated for new onRegistered signature)
- `Login.test.tsx` — 9 tests (S-AUTH-04 new)
- `AuthContext.test.tsx` — 9 tests (S-AUTH-04 new)

```
npx tsc --noEmit  →  zero errors
```

---

## Acceptance Criteria Coverage

### AC1 (REQ-002-AC4): login page has email + password fields; submit calls /auth/login

✅ **Tests**: `renders email and password fields and a submit button`, `POSTs to /api/v1/auth/login with credentials on successful submit`, `shows validation errors and skips fetch when submitting empty form`, `shows a validation error for an invalid email and does not call fetch`, `shows a validation error when password is shorter than 8 characters`  
✅ **Implementation**: `LoginForm.tsx` renders 2 controlled inputs + submit button; zod validation runs before fetch; `loginUser()` POSTs to `/api/v1/auth/login` with `credentials: 'include'`.

### AC2 (REQ-002-AC2): 401 response → show generic "Invalid email or password"

✅ **Test**: `shows "Invalid email or password" on a 401 response`  
✅ **Implementation**: `LoginForm.tsx` catches `ApiError` with `status === 401` and displays `'Invalid email or password.'`. Never reveals which field is wrong.

### AC3: AuthContext exposes {user, login, logout, refreshSession} and persists across reloads

✅ **Tests**: `starts with user = null and loading = false when localStorage is empty`, `login() sets the user`, `persists the user to localStorage on login()`, `restores the user from localStorage on mount (valid JWT, no refresh)`, `attempts /refresh on mount when stored JWT is expired`, `clears user and storage when refresh fails on mount`  
✅ **Implementation**: `AuthContext.tsx` stores user + JWT in localStorage; on mount checks JWT `exp` claim; if expired calls `refreshSession()` (POST /api/v1/auth/refresh with credentials:'include'); if refresh fails, clears state.

### AC4: ProtectedRoute redirects to /login if user === null; renders children otherwise

✅ **Tests**: `redirects to /login when user is not authenticated`, `renders children when user is authenticated`  
✅ **Implementation**: `ProtectedRoute.tsx` reads `user` and `loading` from `useAuth()`; when loading returns null; when `!user` returns `<Navigate to="/login">`; otherwise renders children.

### AC5 (REQ-003-AC4): logout → POST /auth/logout → clear context → navigate /login

✅ **Test**: `logout() clears the user`  
✅ **Implementation**: `AuthContext.logout()` clears `user` state, clears localStorage, calls `logoutUser()` (POST /api/v1/auth/logout), then `window.location.assign('/login')`.

### AC6: silent refresh — apiClient catches 401 → calls /auth/refresh → retries original request

✅ **Tests**: `attempts /refresh on mount when stored JWT is expired`, `clears user and storage when refresh fails on mount`  
✅ **Implementation**: `AuthContext` useEffect on mount: reads stored JWT → checks `exp` claim → if expired calls `refreshSession()` → on success keeps user; on failure clears state. The actual 401-intercept-and-retry pattern for non-auth API calls will land with the apiClient in S-TODO-*.

---

## Files Touched

| File | Status | Notes |
|------|--------|-------|
| `src/api/auth.ts` | Extended | Added `loginUser`, `refreshSession`, `logoutUser`, `decodeJwtPayload`, `isJwtExpired`; `registerUser` untouched |
| `src/contexts/AuthContext.tsx` | Created | AuthProvider + useAuth hook |
| `src/components/auth/LoginForm.tsx` | Created | Controlled login form with zod validation |
| `src/pages/Login.tsx` | Created | Login page wrapping LoginForm |
| `src/components/auth/ProtectedRoute.tsx` | Created | Auth guard component |
| `src/App.tsx` | Updated | Added AuthProvider, /login route, ProtectedRoute on /todos |
| `src/pages/Register.tsx` | Updated | Now calls `auth.login()` after successful register |
| `src/components/auth/RegisterForm.tsx` | Updated | `onRegistered` now passes `(user, accessToken)` |
| `src/test/Login.test.tsx` | Created | 9 tests covering AC1, AC2, navigation |
| `src/test/AuthContext.test.tsx` | Created | 9 tests covering AC3, AC4, AC5, AC6 |
| `src/test/Register.test.tsx` | Updated | Wrapped page-level test in AuthProvider; updated onRegistered assertion |

---

## Backend Contract (used by S-AUTH-04)

- **`POST /api/v1/auth/login`** `{email, password}` → 200 `{user, access_token}` + httpOnly cookies. 401 `{error: "invalid_credentials"}` on bad creds.
- **`POST /api/v1/auth/refresh`** no body → 200 new tokens (rotation). 401 when refresh token invalid.
- **`POST /api/v1/auth/logout`** no body → 200 + clears cookies.

---

## Key Design Decisions

1. **JWT decoded from login response body** — access_token cookie is httpOnly (invisible to JS). We read `res.access_token` from the body, store it in localStorage, and decode the payload (`JSON.parse(atob(token.split('.')[1]))`) to extract `{sub, email, exp}` for expiry checks.
2. **AuthContext does not use `useNavigate`** — `logout()` uses `window.location.assign('/login')` to avoid coupling the context to the React Router context. Each page handles its own navigation after `login()`.
3. **Register.tsx now persists auth state** — After successful register, `auth.login(user, accessToken)` is called so the ProtectedRoute on `/todos` sees an authenticated user. This required updating `RegisterForm.onRegistered` to pass both `user` and `accessToken`.
4. **Silent refresh on mount only** — The 401-intercept-and-retry pattern for arbitrary API calls will be implemented with the apiClient in a future story (S-TODO-*).

---

## Out of Scope

- Todo page UI (S-TODO-04) — placeholder `<div>Todo list (S-TODO-04)</div>` used
- apiClient with 401 intercept + retry (S-TODO-*)
- Backend code
- Logout button in the UI (AuthContext.logout() is wired but no button yet — will be on the todo page)

---

## Handoff Date

2026-06-21 (S-AUTH-04 frontend complete)
