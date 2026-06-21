---
artifact_type: epics
phase: 3
sub_phase: 3_6
status: LOCKED
---

# Epics — Spec Sync Demo

## EPIC-AUTH: Authentication

Cross-cutting stories that deliver REQ-001 and REQ-002.

### Backend stories

- **S-AUTH-01**: Implement `/auth/register` endpoint (traces to REQ-001)
- **S-AUTH-02**: Implement `/auth/login` endpoint (traces to REQ-002)
- **S-AUTH-03**: bcrypt password hashing (traces to REQ-001)

### Frontend stories

- **S-AUTH-04**: Registration form (traces to REQ-001)
- **S-AUTH-05**: Login form (traces to REQ-002)

## EPIC-TODO: Todo Management

Stories that deliver REQ-003 and REQ-004.

### Backend stories

- **S-TODO-01**: `POST /todos` endpoint (traces to REQ-003)
- **S-TODO-02**: `GET /todos` endpoint (traces to REQ-004)

### Frontend stories

- **S-TODO-03**: Todo list view (traces to REQ-004)
- **S-TODO-04**: Todo create form (traces to REQ-003)

## Story Count by Track

| Track | Backend | Frontend | Total |
|-------|---------|----------|-------|
| AUTH  | 3       | 2        | 5     |
| TODO  | 2       | 2        | 4     |

## Dependency map

```
S-AUTH-01 ─┐
           ├──→ S-AUTH-04
S-AUTH-03 ─┘
S-AUTH-02 ────→ S-AUTH-05
S-AUTH-02 ─┐
            ├──→ S-TODO-01 ──→ S-TODO-04
            └──→ S-TODO-02 ──→ S-TODO-03
```
