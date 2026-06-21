---
artifact_type: spec
domain: general
version: 1
---

# Spec — General

## Requirement: Audit Logging
- id: REQ-005
- priority: P2
- description: Cross-cutting audit hook (no explicit Domain field).

GIVEN the system is initialized
WHEN the user performs the documented action
THEN The system MUST log every state-changing request to the audit table
