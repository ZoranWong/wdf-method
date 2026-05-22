---
sub_workflow: "fullstack-2"
phase: 4
sub_phase: "fs-2"
version: "3.6.0"
title: "Full-Stack Foundation"
description: "Establish the database schema, authentication system, and shared utilities for the full-stack application. This is the shared infrastructure layer used by all stories."
# V3.6 parity: forbidden_paths protection (.env.*), hidden dependency detection (shared utilities), see specs/merge-queue.md
dependencies:
  - api-spec.yaml
  - db-schema.md
  - architecture.md
mode: "full_stack"
bmad_skill: "/bmad-dev-story"
skip: false
---

# Full-Stack 2 — Foundation

**Sub-Phase Goal:** Set up the shared infrastructure — database connection, ORM schema, authentication, middleware, and shared utilities — that all full-stack stories will build upon.

**Gate:** Full-Stack 1 status must be LOCKED.

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate passes | `IN_PROGRESS` | Foundation work begins |
| `IN_PROGRESS` | DB + auth + middleware done | `FOUNDATION_BUILT` | Infrastructure ready |
| `FOUNDATION_BUILT` | Tests pass + spec validated | `VERIFIED` | Verified correct |
| `VERIFIED` | User confirmation | `LOCKED` | Foundation complete |

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "fs-2"
  enters_from: "fs-1"
  checks:
    - id: "GFS2-01"
      description: "Full-Stack 1 status is LOCKED"
      type: "dependency_status"
      field: "phases.phase_4.substates.phase_fs_1.status"
      operator: "eq"
      expected: "LOCKED"
    - id: "GFS2-02"
      description: "db-schema.md exists and is APPROVED/LOCKED"
      type: "artifact_metadata"
      source: "{db_schema_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]
    - id: "GFS2-03"
      description: "api-spec.yaml exists and is APPROVED/LOCKED"
      type: "artifact_metadata"
      source: "{api_spec_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]
  all_pass: false
```

---

## Step 0: Load Artifacts

Read `{db_schema_output}` and `{api_spec_output}` for the full data model and API contracts.

## Step 1: Gate Check

Evaluate GFS2 checks. Abort if any fail.

## Step 2: Database Setup

### 2a. ORM Configuration

Based on `customize.toml` database choice:

| Database | ORM | Migration Tool |
|----------|-----|---------------|
| `postgresql` | Prisma / Drizzle | `prisma migrate dev` / `drizzle-kit` |
| `mysql` | Prisma / Drizzle | `prisma migrate dev` / `drizzle-kit` |
| `sqlite` | Prisma / Drizzle / better-sqlite3 | `prisma migrate dev` |
| `mongodb` | Mongoose / Prisma | Application-level |

### 2b. Schema Implementation

Translate `db-schema.md` into ORM schema:
- All tables/collections with fields, types, constraints
- Indexes for query performance
- Relations (one-to-one, one-to-many, many-to-many)
- Enum types

### 2c. Migration Generation

```bash
npx prisma migrate dev --name init  # Prisma
# or
npm run db:migrate                    # Custom
```

Verify: migrations run successfully against dev database.

### 2d. Seed Data (Optional)

Create seed script for development data:
- Admin/test users
- Reference/lookup data
- Sample records for development

## Step 3: Authentication Setup

### 3a. Auth Provider

Based on `customize.toml`:
- `jwt` — JWT with refresh tokens
- `next_auth` — NextAuth.js (Next.js only)
- `lucia` — Lucia Auth (framework-agnostic)
- `clerk` — Clerk (hosted auth)

### 3b. Implementation

1. **Password hashing** — bcrypt/argon2
2. **Token management** — access + refresh token generation/validation
3. **Session middleware** — protect API routes
4. **User model** — extend DB user with auth methods
5. **Auth endpoints** — login, register, logout, refresh, forgot/reset password

### 3c. Auth Middleware

Create middleware that:
- Extracts JWT from Authorization header (or session cookie)
- Validates token
- Attaches user to request context
- Returns 401 for invalid/missing tokens

## Step 4: Shared Middleware

### 4a. Error Handler

Global error handler with standardized JSON response format:
```json
{
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] }
}
```

### 4b. Validation

Shared validation utilities (Zod/Yup schemas) for request/response shapes matching api-spec.yaml.

### 4c. Rate Limiting

Basic rate limiting middleware (configurable thresholds).

### 4d. CORS

CORS configuration per `customize.toml` settings.

### 4e. Logging

Request/response logging middleware (structured JSON logs).

## Step 5: Environment Configuration

Create `.env` with:
```
DATABASE_URL=
JWT_SECRET=
JWT_EXPIRES_IN=
API_URL=
CORS_ORIGIN=
```

Create `.env.example` with placeholder values.

## Step 6: Verify Foundation

```bash
npm run db:migrate      # Migrations run cleanly
npm run db:seed          # Seed data applied (optional)
npm run test             # Foundation tests pass
npm run build            # Build succeeds with new infrastructure
```

Implement basic tests:
- Database connection test
- Auth flow test (register → login → access protected route)
- Middleware tests (auth rejection, validation, error format)

## Step 7: Record State

```yaml
phases:
  phase_4:
    substates:
      phase_fs_2:
        status: "LOCKED"
        state_history:
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "FOUNDATION_BUILT", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "db_schema", path: "{project_root}/prisma/schema.prisma", status: "complete" }
          - { type: "auth_module", path: "{project_root}/src/lib/auth/", status: "complete" }
          - { type: "middleware", path: "{project_root}/src/server/middleware/", status: "complete" }
```

## Phase Complete

```
═══════════════════════════════════════════
Full-Stack 2 — Foundation Complete
═══════════════════════════════════════════
Database: {db} with ORM, migrations run ✓
Auth: {auth_provider} with JWT + middleware ✓
Shared middleware: error, validation, CORS, logging, rate-limit ✓
Tests: {N} passing ✓

Next: Full-Stack 3 — Story Implementation
```
