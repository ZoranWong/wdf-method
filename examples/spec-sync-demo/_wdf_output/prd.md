---
artifact_type: prd
phase: 2
sub_phase: 2_5
status: LOCKED
---

# PRD — Spec Sync Demo

Minimal PRD used by spec-sync.test.ts. 5 REQs across 2 domains (auth + todos)
plus 1 unattributed REQ (lands in `general` bucket).

## 1. Product Vision

A tiny demo product to exercise `wdf spec sync` end-to-end without disturbing
the larger `examples/todo-app/` fixtures.

## 2. Functional Requirements

### REQ-001: User Registration

**Priority:** P0
**Domain:** auth
**Description:** A visitor can register a new account.

**Acceptance Criteria:**
AC1: The system MUST create a user record when a visitor submits a valid email and password
AC2: The system MUST reject duplicate emails with a 409 response
AC3: The system MUST hash the password with bcrypt before storing

### REQ-002: User Login

**Priority:** P0
**Domain:** auth
**Description:** A registered user can establish a session.

**Acceptance Criteria:**
AC1: The system MUST issue a session cookie when credentials match
AC2: The system MUST reject unknown emails with a 401 response
AC3: The system MUST reject wrong passwords with a 401 response

### REQ-003: Todo Creation

**Priority:** P0
**Domain:** todos
**Description:** An authenticated user can create a todo item.

**Acceptance Criteria:**
AC1: The system MUST persist the todo with title, owner, and created_at
AC2: The system MUST reject empty titles with a 422 response

### REQ-004: Todo Listing

**Priority:** P1
**Domain:** todos
**Description:** An authenticated user can list their todos.

**Acceptance Criteria:**
AC1: The system MUST return only todos owned by the requesting user
AC2: The system MUST return todos sorted by created_at descending

### REQ-005: Audit Logging

**Priority:** P2
**Description:** Cross-cutting audit hook (no explicit Domain field).

**Acceptance Criteria:**
AC1: The system MUST log every state-changing request to the audit table

## 3. Non-Functional Requirements

NFR1: 95th percentile response time under 200ms
NFR2: Password hashes MUST NOT appear in any log or response

## 4. Out of Scope (v1)

- OAuth integration
- Todo sharing between users

## 5. Success Metrics

- Registration → login → todo creation completed by 90% of test users in under 60s
