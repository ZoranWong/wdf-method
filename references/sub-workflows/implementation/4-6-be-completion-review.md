---
sub_workflow: "4-6-be-completion-review"
phase: 4
sub_phase: "4.6"
version: "3.6.0"
title: "Phase 4.6 — Backend Completion Review"
description: "Final review of all backend artifacts — code review, security audit, documentation check, and formal sign-off. Locks the entire BE track."
dependencies:
  - all-backend-artifacts
---

# Phase 4.6 — Backend Completion Review + Retro Prep

**Sub-Phase Goal:** Conduct comprehensive code review, security audit, and documentation verification. Lock the complete backend track.

**Gate:** Phase 4.5 status must be LOCKED.

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `CODE_ACCEPTANCE` | Begin review |
| `CODE_ACCEPTANCE` | All CA checks pass | `CODE_ACCEPTED` | Review passed |
| `CODE_ACCEPTED` | Report generated + user sign-off | `LOCKED` | BE track locked |

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "4.6"
  enters_from: "4.5"
  checks:
    - id: "G4.6-01"
      description: "Phase 4.5 status is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_4.substates.phase_4_5.status"
      operator: "eq"
      expected: "LOCKED"
    - id: "G4.6-02"
      description: "All backend artifacts exist and are locked"
      type: "user_confirmation"
  all_pass: false
```

## Step 1: Gate Card Check + Artifact Collection

Verify all backend artifacts exist:
- `backend-scaffold-report.md` (LOCKED)
- `backend-migration-report.md` (LOCKED)
- `backend-dev-log.md` (all stories CODE_ACCEPTED)
- `backend-test-report.md` (LOCKED)

## Step 2: Code Review

Invoke `/bmad-code-review` on the complete backend codebase.

Review focus areas:
- Clean architecture patterns (route → controller → service → model)
- RESTful API conventions
- Input validation on all endpoints
- SQL injection prevention (parameterized queries)
- Auth middleware applied correctly
- Error handling consistency
- No secrets in code
- Test quality and coverage

## Step 3: Security Audit

Checklist:
- [ ] No secrets/API keys in source code
- [ ] bcrypt/argon2 for password hashing
- [ ] Parameterized queries (no SQL injection)
- [ ] Input validation on all endpoints (Zod/Joi)
- [ ] Rate limiting configured
- [ ] CORS restricted to specific origins
- [ ] JWT with reasonable expiry (access: 15-60min, refresh: 7-30d)
- [ ] Helmet security headers enabled
- [ ] `npm audit` shows no critical/high vulnerabilities
- [ ] No sensitive data in logs

## Step 4: Documentation Check

- [ ] README.md with setup, run, test, deploy instructions
- [ ] API docs from spec (link to Swagger/Redoc)
- [ ] `.env.example` with all variables documented
- [ ] Database setup instructions (migrations, seed)
- [ ] package.json scripts documented

## Step 5: Completion Review Report

Generate `{backend_completion_review_output}` with frontmatter:

```yaml
---
artifact_type: "completion_review"
artifact_id: "{project}-backend-completion-review-v1"
phase: 4
sub_phase: "4.6"
status: "locked"
version: "3.6.0"
---
```

Report sections:
1. Artifact Inventory — all backend artifacts with status + path
2. Code Review Summary — critical/major/minor findings
3. Security Audit Results — checklist with pass/fail
4. Documentation Status — checklist with pass/fail
5. Final Approval — APPROVE / APPROVE WITH CONDITIONS / REJECT

## Step 6: Lock BE Track

Update `{sprint_tracking}`:
```yaml
phases:
  phase_4:
    be_track:
      status: "LOCKED"
    substates:
      phase_4_6:
        status: "LOCKED"
        artifacts:
          - { type: "completion_review", path: "backend-completion-review.md", status: "locked" }
```

Check if Phase 4.12 (FE Completion) is also LOCKED:

```yaml
# If phase_4_12 is also LOCKED:
# → Set global_state.overall_status to ready_for_integration

# If phase_4_12 is NOT LOCKED:
# → global_state remains current value
# → BE track is locked but system waits for FE before integration

# Example — both tracks locked:
phase_4:
  be_track: "LOCKED"
  fe_track: "LOCKED"
  integration_status: "ready_for_integration"

# Example — BE locked, FE still in progress:
phase_4:
  be_track: "LOCKED"
  fe_track: "IN_PROGRESS"
  integration_status: "be_complete_awaiting_fe"
```

When both tracks are locked, this triggers the Integration sub-phases.

## Phase Complete

Present: "Phase 4.6 complete — Backend track LOCKED. {N} endpoints, {M} tests, coverage {C}%. BE artifacts signed and ready. {integration_status_message}"
