---
sub_workflow: "3-8-api-design"
phase: 3
sub_phase: "3.8"
version: "3.6.0"
title: "Phase 3.8 — API & Data Design"
description: "Produce a complete OpenAPI 3.0 specification and database schema. The API spec serves as the contract that enables parallel frontend and backend development in Phase 4."
dependencies:
  - stories/ (Phase 3.7)
  - epics.md (Phase 3.6)
  - architecture.md
methodology: "OpenAPI 3.0 + Database Schema Design"
bmad_skill: null
---

# Phase 3.8 — API & Data Design

**Sub-Phase Goal:** Produce a complete OpenAPI 3.0 specification and database schema documentation. This is a **core differentiator** of `web-dev-flow` — the API spec serves as the **contract** that enables parallel frontend and backend development in Phase 4.

**Why This Matters:** A locked API contract means frontend and backend teams can develop simultaneously, each developing against a shared, verified specification. The database schema ensures consistent data modeling across all layers.

**Outputs:**
- `{api_spec_output}` — OpenAPI 3.0 YAML specification
- `{db_schema_output}` — Database schema documentation with migrations

**Duration:** This sub-phase continues until both the API spec and DB schema are complete and approved.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin API + DB design |
| `IN_PROGRESS` | OpenAPI spec drafted | `SPEC_DRAFTED` | API spec written |
| `SPEC_DRAFTED` | DB schema designed | `SCHEMA_DESIGNED` | Both artifacts created |
| `SCHEMA_DESIGNED` | User verifies both artifacts | `VERIFIED` | Artifacts reviewed |
| `VERIFIED` | User locks artifacts | `LOCKED` | Contract baseline established |

---

## Gate Card

```yaml
gate_card:
  phase: 3
  sub_phase: "3.8"
  enters_from: "3.7"
  checks:
    - id: "G3.8-01"
      description: "Phase 3.7 (Stories) is LOCKED or development order is frozen"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "global_state.development_order_frozen_at"
      operator: "neq"
      expected: null

    - id: "G3.8-02"
      description: "At least all P0 stories are designed"
      type: "custom_check"
      source: "{sprint_tracking}"
      field: "phases.phase_3.substates.phase_3_7.stories_designed"
      operator: "gte"
      expected: "{count of P0 stories}"

    - id: "G3.8-03"
      description: "Architecture is LOCKED"
      type: "artifact_metadata"
      source: "{architecture_output}"
      field: "frontmatter.status"
      operator: "eq"
      expected: "locked"

    - id: "G3.8-04"
      description: "User confirms readiness for API and DB design"
      type: "user_confirmation"
  all_pass: false
```

---

## Step 1: Gate Card Check

Evaluate all G3.8 checks. Record results in `{sprint_tracking}`.

**If gate fails**, surface the specific failed check(s):

> "All P0 stories must be designed and development order frozen before we can define the API contract. Please complete Phase 3.7 first."

Abort and return to the Phase 3 sub-phase menu.

**On gate pass**, record:

```yaml
phases:
  phase_3:
    substates:
      phase_3_8:
        status: "IN_PROGRESS"
        gate_card:
          all_pass: true
```

---

## Step 2: Read Inputs

Read for context:
- `{architecture_output}` — tech stack, backend module structure, auth strategy, database choice
- `{epics_output}` — all stories, their tracks, and dependencies
- `{stories_output}/` — detailed story files with technical notes and endpoint requirements

Extract:
- **Tech constraints**: Framework, database type, auth method from architecture
- **API requirements**: Every backend/full-stack story's technical notes about endpoints
- **Data entities**: Every model, table, or schema implied by the stories
- **Auth patterns**: Protected vs public endpoints, role-based access
- **File upload needs**: Any stories requiring media/file handling

---

## Step 3: API Design — Endpoint Inventory

Present the user:

> "Phase 3.8: API & Data Design. We'll design the complete REST API and database schema. The API spec will serve as the contract between frontend and backend teams in Phase 4."

### 3.1 Extract Endpoints from Stories

For each backend or full-stack story, derive the required API endpoints:

| Story ID | Story Title | Method | Path | Purpose |
|----------|-------------|--------|------|---------|
| {ID} | {title} | GET/POST/PUT/DELETE | /api/v1/{resource} | {purpose} |

### 3.2 Organize by Resource

Group endpoints by resource (RESTful pattern):

```
Health:
  GET    /api/v1/health

Auth:
  POST   /api/v1/auth/login
  POST   /api/v1/auth/refresh
  POST   /api/v1/auth/logout
  POST   /api/v1/auth/register

Users:
  GET    /api/v1/users
  GET    /api/v1/users/:id
  PATCH  /api/v1/users/:id
  DELETE /api/v1/users/:id

{Resource}:
  GET    /api/v1/{resources}
  POST   /api/v1/{resources}
  GET    /api/v1/{resources}/:id
  PUT    /api/v1/{resources}/:id
  PATCH  /api/v1/{resources}/:id
  DELETE /api/v1/{resources}/:id
```

### 3.3 Define Standard Patterns

**Request/Response Envelope:**

```json
// Success response
{
  "data": { /* resource or array */ },
  "meta": {
    "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
  }
}

// Error response
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": [{"field": "email", "message": "Invalid format"}]
  }
}
```

**Standard conventions:**
- **Pagination:** Query params `?page=1&limit=20`, default limit: 20, max: 100
- **Sorting:** Query param `?sort=created_at&order=desc`, whitelist allowed sort fields
- **Filtering:** Query params `?status=active&role=admin`, support eq/neq/in/gt/gte/lt/lte/like
- **Versioning:** URL prefix `/api/v1/`
- **Auth:** Bearer JWT in `Authorization` header

---

## Step 4: Generate OpenAPI 3.0 Spec

### 4.1 Start from Template

Use the template at `{skill-root}/assets/api-spec-template.yaml` as the base.

### 4.2 Build Complete Spec

Write the complete specification to `{api_spec_output}`. It must include:

**Required sections for each endpoint:**
- `summary` — one-line description
- `operationId` — camelCase unique identifier
- `tags` — resource grouping
- `parameters` — path, query, header params with types and constraints
- `requestBody` — JSON schema for POST/PUT/PATCH with `required` fields
- `responses` — at minimum: 200, 201, 400, 401, 403, 404, 422, 500
- `security` — which security scheme applies (empty array for public)

**Required schemas:**
- Every request body DTO with validation constraints
- Every response DTO with complete property definitions
- Shared types (Error, Pagination, User, etc.)
- Enums for status fields with documented values
- Timestamp format: `date-time` (ISO 8601)

**Required security schemes:**
- `bearerAuth` — Bearer JWT with `Authorization` header
- Document token refresh mechanism

**Required reusable responses:**
- `Unauthorized` — 401 with error body
- `Forbidden` — 403 with error body
- `NotFound` — 404 with error body
- `ValidationError` — 422 with field-level details
- `InternalError` — 500 with generic message

### 4.3 Validation Checklist

Present the spec and verify:
- [ ] All backend/full-stack stories have corresponding endpoints
- [ ] Request schemas include validation rules (required fields, formats, min/max, enums)
- [ ] Response schemas are complete (not just `{}` or `type: object`)
- [ ] Auth is specified per-endpoint (public vs protected vs role-based)
- [ ] Pagination is used on all list endpoints
- [ ] Error responses are consistent across all endpoints
- [ ] File upload endpoints use `multipart/form-data`
- [ ] Rate limiting headers are documented (`X-RateLimit-*`)
- [ ] Spec is valid YAML that would pass an OpenAPI 3.0 validator

### 4.4 User Review

Present a summary:

```
API Spec Summary:
- {N} endpoints across {M} resource groups
- {A} public endpoints, {B} protected endpoints
- Auth: Bearer JWT
- Pagination: page/limit query params
- Version: v1 (URL prefix /api/v1/)

Endpoint Breakdown:
- GET: {N} | POST: {M} | PUT: {K} | PATCH: {J} | DELETE: {L}
```

Ask: *"Does the API spec look correct? [Approve / Revise]"*

Transition: `IN_PROGRESS` → `SPEC_DRAFTED`.

---

## Step 5: Database Schema Design

### 5.1 Extract Data Entities

From the API spec, architecture, and stories, list all data entities:

| Entity | Table Name | Purpose | Key Fields |
|--------|------------|---------|------------|
| User | users | Account management and auth | id, email, password_hash, name, role, created_at, updated_at |
| {Entity} | {table_name} | {purpose} | {fields} |

### 5.2 Design Relationships

Map entity relationships:

```
[User] 1──* [{Resource}]    (user has many resources)
[User] 1──1 [{Profile}]     (user has one profile)
[{Resource}] *──* [{Tag}]   (many-to-many via resource_tags join table)
```

### 5.3 Produce Schema Documentation

Write to `{db_schema_output}` using the template at `{skill-root}/assets/db-schema-template.md`.

For each table, include:
- Column definitions (name, type, constraints, default, description)
- Indexes (name, columns, type, purpose)
- Foreign key relationships (column, target table, target column, on-delete behavior)
- CREATE TABLE SQL (both up and down migrations)
- Estimated row count and growth rate

### 5.4 Indexing Strategy

Define indexes based on query patterns from API spec:
- Every foreign key gets an index
- Columns used in WHERE clauses (especially filter params from API spec)
- Columns used in ORDER BY (sort params from API spec)
- Composite indexes for common multi-column queries
- Unique indexes for business constraints (e.g., unique email, unique slug)
- Full-text search indexes if needed by stories

### 5.5 Migration Plan

Define the initial migration:

```sql
-- Migration: 001_initial_schema
-- Up
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE {resources} (
  ...
);

-- Down
DROP TABLE {resources};
DROP TABLE users;
```

Transition: `SPEC_DRAFTED` → `SCHEMA_DESIGNED`.

---

## Step 6: Change Request Detection

After designing the API spec and DB schema, scan for upstream gaps:

| Check | What to Look For | Severity |
|-------|-----------------|----------|
| Missing story coverage | Any story without endpoint mapping | blocking |
| Architecture deviations | Spec contradicts architecture decisions | blocking |
| Missing error handling | Endpoints without documented error responses | non-blocking |
| Auth gaps | Protected resources without auth scheme | blocking |
| Missing data entities | API schemas without DB table mapping | blocking |
| Orphan endpoints | Endpoints with no corresponding story | non-blocking |

File Change Requests as needed:

```yaml
change_requests:
  - id: "CR-NNN"
    title: "{description}"
    source_phase: 3
    source_sub_phase: "3.7"
    discovered_in_phase: 3
    discovered_in_sub_phase: "3.8"
    severity: "blocking"
    status: "open"
```

**Blocking CRs** must be resolved before this sub-phase can be locked. **Non-blocking CRs** are recorded but deferred to Phase 4.13 (Integration).

---

## Step 7: Verify and Lock

Present both artifacts for final review:

> "API & Data Design complete:"
>
> "**API Spec:** `{api_spec_output}` — {N} endpoints across {M} resource groups"
> "**DB Schema:** `{db_schema_output}` — {T} tables with indexes and migrations"
>
> "Do these artifacts look correct and complete? [Approve / Revise]"

When user approves:

Transition: `SCHEMA_DESIGNED` → `VERIFIED` → `LOCKED`.

Update both artifact frontmatters:

```yaml
# In api-spec.yaml
status: "locked"
locked_at: "{ISO_TIMESTAMP}"

# In db-schema.md
status: "locked"
locked_at: "{ISO_TIMESTAMP}"
```

Update `{sprint_tracking}`:

```yaml
phases:
  phase_3:
    substates:
      phase_3_8:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "SPEC_DRAFTED", at: "{ISO}" }
          - { state: "SCHEMA_DESIGNED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "api_spec", path: "{api_spec_output}", status: "locked" }
          - { type: "db_schema", path: "{db_schema_output}", status: "locked" }
        endpoints_total: {N}
        resource_groups: {M}
        tables: {T}
        gate_card:
          all_pass: true
        change_requests: []
```

---

## Step 8: Completion

Present summary:

> "Phase 3.8 complete — API Contract LOCKED."
>
> "**API Spec:** `{api_spec_output}` — {N} endpoints across {M} resource groups"
> "**DB Schema:** `{db_schema_output}` — {T} tables with indexes and migrations"
>
> "The API spec now serves as the contract. **Phase 4 (Implementation) can run backend and frontend tracks in parallel** — each track develops against this locked spec."
>
> "Next: Phase 3.9 — Implementation Readiness Check."

Return to the Phase 3 sub-phase menu.
