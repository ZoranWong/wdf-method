---
artifact_type: spec
domain: todos
version: 1
---

# Spec — Todos

## Requirement: Todo Creation
- id: REQ-003
- priority: P0
- description: An authenticated user can create a todo item.

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST persist the todo with title, owner, and created_at

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST reject empty titles with a 422 response

## Requirement: Todo Listing
- id: REQ-004
- priority: P1
- description: An authenticated user can list their todos.

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST return only todos owned by the requesting user

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST return todos sorted by created_at descending
