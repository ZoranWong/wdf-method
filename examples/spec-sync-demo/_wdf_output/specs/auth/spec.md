---
artifact_type: spec
domain: auth
version: 1
---

# Spec — Auth

## Requirement: User Registration
- id: REQ-001
- priority: P0
- description: A visitor can register a new account.

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST create a user record when a visitor submits a valid email and password

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST reject duplicate emails with a 409 response

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST hash the password with bcrypt before storing

## Requirement: User Login
- id: REQ-002
- priority: P0
- description: A registered user can establish a session.

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST issue a session cookie when credentials match

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST reject unknown emails with a 401 response

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST reject wrong passwords with a 401 response
