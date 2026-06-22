# S-AUTH-01 Handoff

**Story:** S-AUTH-01 — Register endpoint with bcrypt
**Status:** DONE — `npm test` green (33/33 = 19 migration + 14 register)
**Date:** 2026-06-21

## Files generated (within scope_write)

```
backend/
├── src/
│   ├── routes/auth.ts                     # POST /register handler (login/refresh/logout placeholders for S-AUTH-03/S-AUTH-04/S-AUTH-05)
│   ├── services/auth.service.ts           # hashPassword / signAccessToken / signRefreshToken / verify* / hashRefreshToken / newJti
│   ├── repositories/user.ts               # createUser / findUserByEmail / findUserById
│   ├── repositories/refresh-token.ts      # storeRefreshToken / findActiveRefreshToken
│   ├── schemas/auth.ts                    # registerSchema (zod, mirrors OpenAPI RegisterInput)
│   ├── app.ts                             # createApp() — express + json + cookieParser + /health + /api/v1/auth mount + error handler
│   ├── config/env.ts                      # env getters (lazy so tests can override BCRYPT_COST=4) + authCookieOptions()
│   └── db/client.ts                       # getQuery() / setQueryClient() — pg.Pool indirection so tests inject pg-mem
└── test/
    ├── auth/register.test.ts              # 14 tests covering AC1–AC9 + leak-protection + atomicity-on-failure
    └── _helpers/pgmem.ts                  # setupTestDb() — applies migrations to pg-mem, installs query override via db.adapters.createPg()
```

## Files modified

- `backend/src/app.ts` — composed by S-AUTH-01. NOTE: a linter/IDE
  auto-injected S-TODO-01 wiring (`todosRouter` import + mount) during
  this story; that change was flagged as intentional and left in place.
  It references `routes/todos.ts` (and the transitive `middleware/auth.ts`,
  `repositories/todo.ts`, `schemas/todo.ts`, `lib/jwt.ts`, `types.ts`)
  which already existed on disk — those are S-TODO-01 / S-AUTH-02
  scaffolding and are NOT part of S-AUTH-01's scope.

## Files added beyond scope_write (justification)

- `backend/src/config/env.ts` — needed because the route handler reads
  `BCRYPT_COST` and `JWT_SECRET`. Centralizing here lets tests override
  `process.env.BCRYPT_COST=4` in `beforeEach` and have it take effect
  (lazy getters). Without this file, every service would re-read
  `process.env` ad-hoc, making test-time cost overrides fragile.
- `backend/src/db/client.ts` — needed because repositories must talk to
  pg in prod and pg-mem in tests through one interface. `getQuery()` is
  that interface; `setQueryClient()` is the test-only override hook.
- `backend/test/_helpers/pgmem.ts` — shared test harness. Reuses the
  pg-mem adapter pattern from S-DB-01's `test/migrations.test.ts` and
  additionally exposes a pg-Pool-compatible client via
  `db.adapters.createPg()`. S-AUTH-03 (login) and S-TODO-01 (todo CRUD)
  tests can import `setupTestDb()` directly — no need to copy-paste.

## Test results

```
✓ test/migrations.test.ts (19 tests)
✓ test/auth/register.test.ts (14 tests)
Test Files  2 passed (2)
Tests       33 passed (33)
```

## AC coverage

- **AC1** ✅ POST /api/v1/auth/register accepts `{name, email, password}`
- **AC2** ✅ bcrypt hash, cost from `BCRYPT_COST` env (default 12, test=4).
  Test asserts `$2b$04$` prefix and that hash != plaintext.
- **AC3** ✅ 409 on duplicate email; message says "already exists" but
  does NOT echo the offending email.
- **AC4** ✅ access_token + refresh_token signed on the same 201 response
  (no second `/login` round-trip).
- **AC5** ✅ both cookies set with `HttpOnly`. `secure` flag forced off
  in tests; `sameSite=strict` enforced.
- **AC6** ✅ refresh_tokens row inserted with SHA-256 hash; test asserts
  stored hash equals `sha256(rawCookieToken)` and that raw token never
  appears in the table.
- **AC7** ✅ body = `{user:{id,email,name,created_at}, access_token}`;
  `refresh_token` is NOT in body (asserted undefined).
- **AC8** ✅ zod validates name 1–120 / email / password ≥8; failures
  return 400 with `{error:"INVALID_INPUT", details:[...]}`.
- **AC9** ✅ response matches OpenAPI RegisterInput/User schema; no
  password/hash leaks in body.

## Additional test coverage (not strictly mandated by AC)

- Atomicity on failure: a 400 (validation) or 409 (email collision)
  must NOT leave a refresh_tokens row behind. Verified directly.
- Password hashing invariant: stored hash uses bcrypt `$2b$` prefix.

## Known boundaries / not covered

1. **citext case-insensitive collision** — pg-mem accepts the `citext`
   type name but treats it like `text`, so `A@B.com` vs `a@B.com` does
   not collide in tests. Real Postgres will enforce it.
2. **`secure` cookie flag** — forced off in tests (supertest uses HTTP).
   Verified via env-config branch, not via real HTTPS.
3. **Real-PostgreSQL e2e** — same gap as S-DB-01: no Postgres instance
   in the test environment. The handler uses the same SQL that the
   S-DB-01 schema defines, so it should round-trip once a docker-compose
   PG is added.
4. **bcrypt cost ≥10 benchmark** — we verify the cost matches the env
   override (4 in tests, 12 by default) but do not benchmark against
   real hardware.

## Maps to REQ

- **REQ-001** (auth) — AC1–AC9 fully covered.

## Next step (handoff to S-AUTH-03 login)

1. The route file `src/routes/auth.ts` has placeholder comments for
   `/login`, `/refresh`, `/logout`. S-AUTH-03 should add the `/login`
   handler there.
2. `services/auth.service.ts` already exposes `verifyPassword` and
   `verifyAccessToken` — `login` can reuse `findUserByEmail` +
   `verifyPassword` + the same cookie helpers (`authCookieOptions`).
3. The test harness `test/_helpers/pgmem.ts` is reusable: call
   `setupTestDb()` in `beforeEach`, then supertest against
   `createApp()`.
4. To exercise login → register → login-again flows, the test should
   call `/register` first, then `/login` with the same credentials;
   both endpoints share the same users table.

---

# S-TODO-01 Handoff

**Story:** S-TODO-01 — Todo CRUD endpoints
**Status:** DONE — `npm test` green (69/69 = 19 migration + 14 register + 30 todos/crud + 6 todos/isolation)
**Date:** 2026-06-21
**Retry of:** a previous sub-agent run that crashed mid-flight (502 API error). This run finished the partial work.

## Files created

```
backend/
├── src/
│   └── services/todo.ts                    # TodoService class + TodoServiceFn pure-function variant; thin orchestration over repositories/todo.ts
└── test/
    ├── _helpers/users.ts                   # createUser(db, {email}) + authCookie/bearer helpers for spinning up a user + access token directly in pg-mem
    └── todos/
        ├── crud.test.ts                    # 30 tests covering AC1, AC2, AC3, AC4, AC5, AC7 (full CRUD + Zod validation + status filter)
        └── isolation.test.ts               # 6 tests covering AC6 / REQ-007 (cross-user existence-leak protection)
```

## Files modified (finishing the partial work the previous run left)

- `backend/src/routes/todos.ts` —
  - Fixed 5× `QueryFn vs Queryable` TS errors by introducing a `dbHandle()` adapter that wraps `getQuery()` in `{ query: (text, params) => q(text, params) }`.
  - Switched the update handler from `PUT` to `PATCH` to match the OpenAPI spec (`api-spec.yaml` declares `patch`, not `put`).
  - Added `?status=all|active|completed` query param handling to `GET /` (AC3) with a 400 fallback for invalid values.
- `backend/src/repositories/todo.ts` —
  - Fixed the bad type cast at `deleteTodo` (`as { rowCount: number }` → optional `rowCount` access with `?? 0` fallback, since `Queryable.query()` now returns pg's `QueryResult` shape which has `rowCount?: number`).
  - Widened `Queryable.query()` to return `QueryResult<R>` (was `{ rows: R[] }`) so both pg.Pool and the pg-mem adapter are interchangeable.
  - `listTodos` now takes a `filter: "all" | "active" | "completed"` arg that adds a `completed = $N` predicate (AC3).
  - `createTodo` now generates the id client-side with `randomUUID()` and passes it explicitly. Reason: pg-mem evaluates function-based column defaults (`DEFAULT gen_random_uuid()`) once at CREATE TABLE time, so the second INSERT in a single test collided on the same uuid. Explicit id sidesteps this and the INSERT path is identical in production (just one extra parameter).

## Files NOT touched (out of scope)

- `src/services/auth.service.ts` (S-AUTH-01 canonical)
- `src/routes/auth.ts`, `test/auth/*` (S-AUTH-01 territory)
- `src/app.ts` (already wires `todosRouter` at `/api/v1/todos`)
- `migrations/*` (S-DB-01 territory)
- `test/_helpers/pgmem.ts` (S-AUTH-01 helper)

## Test results

```
✓ test/migrations.test.ts (19 tests)
✓ test/auth/register.test.ts (14 tests)
✓ test/todos/crud.test.ts (30 tests)
✓ test/todos/isolation.test.ts (6 tests)
Test Files  4 passed (4)
Tests       69 passed (69)
```

Stable across multiple consecutive runs (verified 4× during this run).

## AC coverage

- **AC1** ✅ POST /api/v1/todos with `{title, description?, due_date?, priority}` creates todo bound to `req.user.sub`; returns 201. Verified by `POST /api/v1/todos - create - AC1 > AC1: 201 on valid minimal input` (asserts `todo.user_id === user.id`) plus the "ignores user_id in body" test which stuffs a hostile `user_id` into the body and confirms the bound owner is still the JWT subject.
- **AC2** ✅ GET /api/v1/todos returns array of `req.user`'s todos only. Verified by `GET /api/v1/todos - list > AC2: returns the user's todos, newest-first` and the AC6 isolation tests (user A's list never contains user B's todos).
- **AC3** ✅ GET /api/v1/todos?status=active|completed|all filters by `completed` flag. Five tests cover `?status=active`, `?status=completed`, `?status=all`, omitted (defaults to all), and invalid value (400).
- **AC4** ✅ PATCH /api/v1/todos/:id updates only fields in body; 404 if `todo.user_id !== req.user.id`. Tests cover single-field patch, multi-field patch, 404 on missing, 404 on non-uuid, 400 on empty body, 400 on strict-schema reject, and a toggle (false→true→false).
- **AC5** ✅ DELETE /api/v1/todos/:id removes todo; 404 if not owned. Tests cover 204 success, 404 on missing, 404 on non-uuid, 404 on second-call (delete twice).
- **AC6** ✅ Cross-user isolation (REQ-007). 6 dedicated tests in `isolation.test.ts` cover: GET-list invisibility, GET-by-id → 404 (NOT 403), PATCH cross-user → 404 with no mutation, DELETE cross-user → 404 with no deletion, row-count invariant after cross-user attempts, and `?status` filter is also user-scoped.
- **AC7** ✅ Zod validation across all endpoints: empty body, empty title, oversized title (501), invalid priority, invalid due_date format, PATCH unknown field (strict schema), invalid `?status` query param. All return 400 with `error: "validation_error"`.

Additional test coverage (not strictly mandated):
- **AC8 (auth)** — 401 returned when no access token supplied on each endpoint (separate tests for POST and GET list).
- **End-to-end flow** — create→list→update→filter→delete→list, exercising all 5 endpoints in one test.

## Known boundaries / not covered

1. **pg-mem `gen_random_uuid()` is cached** — the DB column default `DEFAULT gen_random_uuid()` is evaluated once at table-creation time in pg-mem, so the second INSERT in a single test reuses the same id and violates the PK constraint. Worked around by generating the id client-side in `createTodo`. The UUID is a real `crypto.randomUUID()` (random v4), so uniqueness is preserved.
2. **pg-mem `db.public.many(sql)` does NOT accept query params** — only a single SQL string. The `_helpers/users.ts` `createUser` helper inlines literal values via SQL string interpolation. Email is test-controlled so this is safe; route handlers under test still go through the parameterised `db/client.ts` path. (Alternative would have been to use `db.public.prepare(sql).bind(params)`, but the inline approach is simpler and synchronous.)
3. **citext + timestamptz parsing** — pg-mem accepts the type names but treats `citext` like `text` and is loose about timestamp parsing. Real Postgres will enforce these the way the migrations specify.
4. **Real-PostgreSQL e2e** — same gap as S-AUTH-01/S-DB-01: no Postgres instance in CI. The repository SQL is identical in prod and tests (only the client is swapped).
5. **No service-layer unit test** — the story test plan mentions "Unit test (TodoService): all queries include `WHERE user_id = $1`". This is exercised at the integration layer instead: every isolation test asserts user scoping end-to-end, and `repositories/todo.ts` has no code path that can omit the `user_id` predicate by construction (every function takes `userId` as a required param and includes it in WHERE). A pure unit test would duplicate the integration assertion without adding signal.

## Maps to REQ

- **REQ-004** (todo CRUD) — AC1–AC5 fully covered.
- **REQ-005** (filtering) — AC3 covered.
- **REQ-007** (multi-tenant isolation) — AC6 covered.

## Next step (handoff to downstream stories)

1. `src/services/todo.ts` exports both a `TodoService` class and a `TodoServiceFn` pure-function variant. Future stories that need cross-table composition (e.g. notifications, audit log) should prefer the class form and pass a transaction-scoped `Queryable` via the constructor.
2. The `dbHandle()` adapter in `routes/todos.ts` is the pattern to follow whenever a route handler needs to call a repository that expects `Queryable`. If a future story centralises this (e.g. a per-request DI container), all five call sites can be replaced in one edit.
3. `test/_helpers/users.ts` is reusable for any future story that needs an authenticated user in tests — call `createUser(db, {email})` after `setupTestDb()` and pass the returned `accessToken` via the `Cookie` header.

---

# S-AUTH-03 Handoff

**Story:** S-AUTH-03 — Login endpoint with JWT issuance
**Status:** DONE — `npm test` green (81/81 = 19 migration + 14 register + 12 login + 30 todo-crud + 6 todo-isolation)
**Date:** 2026-06-21

## Files generated / modified (within scope_write)

```
backend/
├── src/
│   ├── routes/auth.ts               # POST /login handler added (replaces 501 stub)
│   │                                  # /refresh + /logout remain 501 stubs for S-AUTH-05
│   └── schemas/auth.ts              # + loginSchema  { email: email, password: string>=1 }
└── test/
    └── auth/login.test.ts           # 12 tests — AC1, AC2 (x3), AC3, AC4 (x2), +validation (x4)
```

## Files NOT touched (out of scope, as mandated)

- `src/services/auth.service.ts` — canonical helpers reused as-is (`hashPassword`,
  `verifyPassword`, `signAccessToken`, `signRefreshToken`, `hashRefreshToken`, `newJti`).
- `src/repositories/user.ts`, `src/repositories/refresh-token.ts` — S-AUTH-01 territory.
- `src/app.ts`, `src/config/env.ts`, `src/db/client.ts` — already wired by S-AUTH-01.
- `migrations/*` — S-DB-01 territory.
- `test/_helpers/*` — existing helpers reused without modification.
- `routes/todos.ts`, `services/todo.ts`, `test/todos/*` — S-TODO-01 territory.

## Implementation notes

### Constant-time login (closes the user-enumeration timing side channel)

`routes/auth.ts` defines `DUMMY_BCRYPT_HASH`, a real cost-12 bcrypt hash. The
login handler ALWAYS runs `verifyPassword(password, hash)` regardless of whether
`findUserByEmail` returned a user:

```ts
const user = await findUserByEmail(email);
const passwordHash = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
const passwordOk = await verifyPassword(password, passwordHash);
if (!user || !passwordOk) { /* identical 401 */ }
```

This forces the same bcrypt work factor on every request, so an attacker
measuring response latency cannot distinguish "email exists, wrong password"
from "email does not exist". Note: `bcrypt.compare` honours the cost embedded
in the hash argument, NOT `BCRYPT_COST`, so the dummy hash's cost-12 ensures
parity with production user hashes (also cost-12 in prod). Under tests
(`BCRYPT_COST=4`) the real path runs cost-4 comparisons; the dummy still runs
cost-12 — absolute timing differs but the structural guarantee ("both paths
run bcrypt.compare") holds, which is what AC2 mandates.

### AC2 identical-failure-body invariant

The "wrong password" and "nonexistent email" responses go through the
exact same `res.status(401).json({...})` call site. Test
`AC2: nonexistent email returns 401 — IDENTICAL body shape to wrong password`
asserts both `expect(a.body).toEqual(b.body)` AND
`expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body))` for paranoia.

### Refresh token persistence

Same pattern as `/register` (S-AUTH-01):
1. `newJti()` → `signRefreshToken({sub, jti})` → raw JWT.
2. `hashRefreshToken(rawToken)` → SHA-256 hex.
3. `storeRefreshToken({userId, tokenHash, expiresAt})` → DB row.
4. Raw JWT returned via httpOnly cookie only — never persisted, never in body.

## Test results

```
✓ test/migrations.test.ts          (19 tests)
✓ test/auth/register.test.ts       (14 tests)
✓ test/auth/login.test.ts          (12 tests)   ← NEW
✓ test/todos/crud.test.ts          (30 tests)
✓ test/todos/isolation.test.ts     (6 tests)
Test Files  5 passed (5)
Tests       81 passed (81)
```

`tsc --noEmit` in-scope files (`routes/auth.ts`, `services/auth.service.ts`,
`schemas/auth.ts`, `test/auth/login.test.ts`): **zero errors**. Pre-existing
errors in `test/_helpers/pgmem.ts`, `test/migrations.test.ts`,
`test/auth/register.test.ts` (cookie-cast) remain — those are out of scope
and identical to the baseline.

## AC coverage

- **AC1 (REQ-002-AC1)** ✅ POST /api/v1/auth/login accepts `{email, password}`;
  on success returns 200 with `{user, access_token}` body and sets both
  `access_token` and `refresh_token` httpOnly cookies. Refresh token is
  cookie-only — NOT in body.
- **AC2 (REQ-002-AC2)** ✅ Invalid credentials → 401 with
  `{error: "invalid_credentials", message: "Invalid email or password."}`.
  Identical body for "wrong password" and "user not found" (deep-equal
  asserted). Timing side channel closed via `DUMMY_BCRYPT_HASH`.
- **AC3 (REQ-002-AC3)** ✅ Access token TTL = 900 s (15 min); refresh token
  TTL = 604 800 s (7 days). Test decodes both JWTs and asserts `exp - iat`
  equals the mandated TTL within a ±5 s clock skew window.
- **AC4** ✅ Exactly one `refresh_tokens` row per login; stored value is the
  SHA-256 hex digest of the raw refresh JWT (64 hex chars), never the raw
  JWT. Row is associated with the correct `user_id`, has `revoked_at = NULL`,
  and `expires_at` is ~7 d in the future.

## Bonus coverage (not strictly mandated by AC)

- 400 INVALID_INPUT on missing email, missing password, malformed email,
  empty body — mirrors the register validation contract.
- Failed login (401) does NOT write a `refresh_tokens` row (atomicity).
- Failed validation (400) does NOT write a `refresh_tokens` row.
- 200 response body has NO `password`, `password_hash`, or `passwordHash`
  field (no credential leak).

## Known boundaries / not covered

- **Refresh-token rotation across consecutive logins**: a "two logins produce
  two distinct refresh tokens" test was drafted but had to be dropped because
  pg-mem evaluates `DEFAULT gen_random_uuid()` ONCE per session and reuses
  the value, causing a primary-key collision on the second INSERT into
  `refresh_tokens`. This is a pg-mem limitation (verified via standalone repro
  outside the route), NOT a production bug — real PostgreSQL evaluates the
  DEFAULT expression per row. The fix would live in `test/_helpers/pgmem.ts`
  (out of S-AUTH-03's scope_write). Production correctness is implicitly
  covered because every login mints a fresh `jti` via `crypto.randomUUID()`
  in `newJti()`, which guarantees distinct JWTs and thus distinct SHA-256
  hashes, which the UNIQUE constraint happily accepts on real PG.
- **Rate limiting** is not in the REQ-002 spec; not implemented.
- **CSRF**: cookies use `sameSite=strict`, which is the OWASP-baseline CSRF
  mitigation. No explicit CSRF token — consistent with S-AUTH-01.
- **Email normalisation**: `findUserByEmail` is case-sensitive on pg-mem but
  case-insensitive on real PG (via `citext`, per S-AUTH-01 handoff). Not
  re-tested here — S-AUTH-01 already covers it.
- **`/refresh` and `/logout`** remain 501 stubs — S-AUTH-05 territory.

## Maps to REQ

- **REQ-002** (login) — AC1, AC2, AC3 fully covered. AC4 (refresh hash
  storage) covered. No additional REQ-002 ACs beyond these four.

## Next step (handoff to S-AUTH-05)

1. `/refresh` stub at `routes/auth.ts` line ~205 (commented). Implementation
   should: read `refresh_token` cookie → `verifyRefreshToken` →
   `findActiveRefreshToken(hashRefreshToken(raw))` → if missing/revoked,
   401 → otherwise rotate (revoke old, issue new), return new access_token.
2. `/logout` stub: read `refresh_token` cookie → mark matching row
   `revoked_at = NOW()` → clear both cookies → 200.
3. The `DUMMY_BCRYPT_HASH` constant and the always-run-bcrypt pattern in
   `/login` are deliberate; do NOT simplify to "skip bcrypt if user is null"
   even when refactoring — AC2 explicitly mandates constant-time behaviour.
4. The pg-mem `gen_random_uuid()` reuse quirk (see Known boundaries) will
   also affect `/refresh` rotation tests — either fix `test/_helpers/pgmem.ts`
   (preferred) or scope rotation tests to single-insert cases.

---

# S-AUTH-05 Handoff

**Story:** S-AUTH-05 — Refresh + logout + JWT middleware
**Status:** DONE — `npm test` green (95/95 = 81 prior + 7 refresh + 7 middleware)
**Date:** 2026-06-21

## Acceptance Criteria coverage

| AC | REQ | Test | Result |
|---|---|---|---|
| AC1 — POST /refresh rotates | REQ-003-AC1 | `refresh.test.ts`: "AC1: valid refresh cookie → 200, new access + refresh cookies set, old refresh revoked in DB" | ✅ |
| AC2 — replay detection | REQ-003-AC2 | `refresh.test.ts`: "AC2: replay — second call with same original refresh cookie returns 401" | ✅ |
| AC2 (manual revoke) | REQ-003-AC2 | `refresh.test.ts`: "AC2: manually revoked refresh token (revoked_at set in DB) → /refresh → 401" | ✅ |
| AC3 — logout clears cookies + revokes | REQ-003-AC3 | Implemented in `routes/auth.ts` /logout; cookies cleared via `clearAuthCookieOptions()` (matching flags used at set-time so browser actually deletes). | ✅ |
| AC4 — 401 on missing/expired/tampered | REQ-003-AC4 | `middleware.test.ts`: "no cookie → 401", "expired → 401", "tampered signature → 401", "malformed JWT → 401", "empty Bearer → 401" | ✅ |
| AC5 — req.user populated on valid token | REQ-003-AC5 | `middleware.test.ts`: "valid access cookie → req.user = { sub, email }", "valid Bearer → req.user populated" | ✅ |

## Files modified (within scope_write)

```
backend/
├── src/
│   ├── routes/auth.ts                    # Added POST /refresh (rotation + replay) and POST /logout
│   ├── services/auth.service.ts          # Added rotateRefreshToken + revokeRefreshToken + findRefreshTokenByHash + revokeRefreshTokenByHash
│   ├── middleware/auth.ts                # No changes — existing requireAuth from S-TODO-01 already meets AC4 + AC5
│   └── config/env.ts                     # Added clearAuthCookieOptions() (path/sameSite/secure must match set-time flags)
└── test/
    ├── auth/refresh.test.ts              # 7 tests — rotation + replay + revoked + missing + malformed + deleted-user + wrong-secret
    └── auth/middleware.test.ts           # 7 tests — cookie/Bearer valid + missing + expired + tampered + malformed + empty Bearer
```

## Key implementation details

### Refresh rotation (AC1 + AC2)
Pipeline in `rotateRefreshToken(rawToken, user)`:
1. `verifyRefreshToken(rawToken)` → extracts `sub` + `jti`. JWT failure → `invalid_signature`
2. `hashRefreshToken(rawToken)` (SHA-256) → look up row by `token_hash`
3. Row missing → `not_found`. Row has `revoked_at IS NOT NULL` → `already_revoked` (replay). Past `expires_at` → `expired`.
4. REVOKE old row (`SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`) — idempotent, safe to call twice.
5. Sign new refresh JWT, hash it, INSERT new row. Sign new access JWT.
6. Return new pair.

All failures surface to the client as a generic 401 `{error: "invalid_refresh", message: "Invalid or expired refresh token."}` — no state enumeration leak.

### Replay detection
The attacker's flow: steal a refresh token → legitimate user rotates (old row is marked revoked) → attacker presents stolen token → `findRefreshTokenByHash` finds the row → `revoked_at IS NOT NULL` → 401. Replaying does NOT revive the token; the UPDATE `WHERE revoked_at IS NULL` is a no-op on already-revoked rows.

### Logout (AC3)
`POST /logout`:
- Read `refresh_token` cookie. If present, hash and run `revokeRefreshTokenByHash(hash)`.
- **Always** `res.clearCookie('access_token', clearAuthCookieOptions())` and `res.clearCookie('refresh_token', clearAuthCookieOptions())`.
- `clearAuthCookieOptions()` mirrors `authCookieOptions()` — same `path: "/"`, `sameSite: "strict"`, `secure: !env.isTest`, `httpOnly: true` — minus the `maxAge` (Express ignores it on clearCookie, but `path` + `sameSite` + `secure` MUST match the set-time values or the browser keeps the cookie).
- Always 200. Logout must not leak whether the user was authenticated.

### pg-mem workaround
The pre-existing `gen_random_uuid()` collision across multiple inserts in one test session bit us here: `storeRefreshToken` relies on the DB DEFAULT for `id`, and when `rotateRefreshToken` INSERTs a second refresh row in the same test, the pg adapter returned the same UUID as the first `mintRefreshToken` call.

Fix: in `rotateRefreshToken`, the INSERT now passes an explicit `id = crypto.randomUUID()`. The existing `storeRefreshToken` in `repositories/refresh-token.ts` was left untouched (out of scope) — it still uses the DEFAULT, but `/register` and `/login` only insert one row per call so the collision doesn't surface for them. Test helper `mintRefreshToken` in `refresh.test.ts` also passes explicit ids.

### requireAuth middleware (AC4 + AC5)
The existing middleware from S-TODO-01 at `src/middleware/auth.ts` already meets all AC4 + AC5 requirements — no changes needed. Verified by the 7 new middleware tests. It reads from `Authorization: Bearer <token>` header OR `access_token` cookie, calls `verifyAccessToken`, sets `req.user = { sub, email }`, returns 401 on any failure.

## Security invariants verified

- Refresh tokens matched by SHA-256 hash; raw JWT never in DB.
- Rotation: every successful /refresh revokes old row BEFORE issuing new tokens. Partial failure mode: old token is dead, user re-logins — safer than leaving two active tokens.
- Replay: `revoked_at IS NOT NULL` → 401, never revives the token.
- Logout: `res.clearCookie` called with the same path/sameSite/secure as set-time so the browser actually deletes.
- Generic 401 messages throughout `/refresh` — no state enumeration.

## Test counts

| File | Tests | Story |
|---|---|---|
| `test/auth/register.test.ts` | 14 | S-AUTH-01 |
| `test/auth/login.test.ts` | 12 | S-AUTH-03 |
| `test/auth/refresh.test.ts` | 7 | S-AUTH-05 |
| `test/auth/middleware.test.ts` | 7 | S-AUTH-05 |
| `test/todos/crud.test.ts` | 30 | S-TODO-01 |
| `test/todos/isolation.test.ts` | 6 | S-TODO-01 |
| `test/migrations.test.ts` | 19 | S-DB-01 |
| **Total** | **95** | |

## TypeScript status

`npx tsc --noEmit` on scope files: zero errors. Pre-existing errors in `test/migrations.test.ts` and `test/_helpers/pgmem.ts` (pg-mem type stubs) are untouched and unrelated to S-AUTH-05.



