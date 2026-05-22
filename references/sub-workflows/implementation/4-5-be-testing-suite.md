---
sub_workflow: "4-5-be-testing-suite"
phase: 4
sub_phase: "4.5"
version: "3.6.0"
title: "Phase 4.5 — Backend Testing Suite"
description: "Achieve test coverage meeting quality gates, cover all endpoints with integration tests, verify migration rollbacks, and configure CI pipeline."
dependencies:
  - all-implemented-endpoints
---

# Phase 4.5 — Backend Testing Suite

**Sub-Phase Goal:** Achieve unit test coverage >= min_threshold (per customize.toml), ensure every endpoint has integration tests, verify migration rollback tests pass, and configure CI.

**Gate:** All 4.4 stories must be CODE_ACCEPTED.

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin testing |
| `IN_PROGRESS` | All tests written | `TESTS_WRITTEN` | Test files exist |
| `TESTS_WRITTEN` | All tests pass | `ALL_PASSING` | Green suite |
| `ALL_PASSING` | Coverage >= threshold | `COVERAGE_MET` | Quality gate satisfied |
| `COVERAGE_MET` | Report generated | `LOCKED` | Artifact locked |

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "4.5"
  enters_from: "4.4"
  checks:
    - id: "G4.5-01"
      description: "All 4.4 stories are CODE_ACCEPTED"
      type: "all_stories_complete"
      source: "{sprint_tracking}"
      field: "phases.phase_4.substates.phase_4_4.stories"
    - id: "G4.5-02"
      description: "backend-dev-log.md exists"
      type: "artifact_exists"
      source: "{backend_dev_log_output}"
  all_pass: false
```

## Step 1: Gate Card Check

Verify all 4.4 stories are CODE_ACCEPTED in sprint-status.yaml.

## Step 2: Existing Test Audit

Run `npm run test:coverage` to get baseline. Identify files with < threshold coverage (from customize.toml `quality_gates.phase_4_min_test_coverage`).

## Step 3: Unit Test Coverage

For each file below threshold:
1. Identify uncovered branches/logic
2. Write unit tests (mock dependencies, test all branches)
3. Re-run coverage until threshold met

## Step 4: Integration Test Coverage

Verify every endpoint has integration tests:
- All HTTP methods per spec
- Happy paths with valid data
- Error cases: 400 (validation), 401 (unauthorized), 403 (forbidden), 404 (not found), 409 (conflict), 500 (server error)
- Concurrent requests (race conditions)
- Test DB seeding and cleanup

## Step 5: Migration Rollback Tests

Per `quality_gates.phase_4_require_migration_rollback_test`:
- Run all up migrations
- Run all down migrations
- Verify clean state
- Re-run up migrations
- Assert no orphaned objects

## Step 6: CI Configuration

Create `.github/workflows/ci.yml` (or equivalent):

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: app_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test:ci
```

## Step 7: Test Report

Generate `{backend_test_report_output}` with frontmatter per artifact schema.

Report must include: test counts (unit/integration), coverage percentages (per module and overall), all-passing checklist, migration rollback results, CI configuration status.

## Phase Complete

Update `{sprint_tracking}` under `phases.phase_4.substates.phase_4_5` with status LOCKED.

Present: "Phase 4.5 complete — Testing suite verified. Coverage: {N}%. Next: Phase 4.6 — Backend Completion Review."
