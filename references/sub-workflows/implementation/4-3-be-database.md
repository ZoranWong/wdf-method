---
sub_workflow: "4-3-be-database"
phase: 4
sub_phase: "4.3"
version: "3.6.0"
title: "Phase 4.3 — Backend Database & API Client Setup"
description: "Create all database migrations matching db-schema.md. Configure the API client layer — routing framework, middleware chain, request validation, and error handling standards."
dependencies:
  - db-schema.md
  - api-spec.yaml
  - backend-scaffold-report.md
---

# Phase 4.3 — Backend Database & API Client Setup

**Sub-Phase Goal:** Implement the database layer — migrations, models/entities, seed data — AND set up the API client foundation: routing, middleware, request validation, and standardized error handling.

**Gate:** Phase 4.2 status must be LOCKED.

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin implementation |
| `IN_PROGRESS` | All migrations written + API client configured | `MIGRATIONS_WRITTEN` | Migration files + routing ready |
| `MIGRATIONS_WRITTEN` | All migrations applied | `MIGRATIONS_APPLIED` | Database schema created |
| `MIGRATIONS_APPLIED` | Rollback + re-apply verified + middleware chain tested | `MIGRATIONS_VERIFIED` | Rollbacks + middleware work |
| `MIGRATIONS_VERIFIED` | Report generated | `LOCKED` | Artifact locked |

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "4.3"
  enters_from: "4.2"
  checks:
    - id: "G4.3-01"
      description: "Phase 4.2 status is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_4.substates.phase_4_2.status"
      operator: "eq"
      expected: "LOCKED"
    - id: "G4.3-02"
      description: "db-schema.md exists and is APPROVED"
      type: "artifact_metadata"
      source: "{db_schema_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]
    - id: "G4.3-03"
      description: "api-spec.yaml exists and is APPROVED"
      type: "artifact_metadata"
      source: "{api_spec_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]
  all_pass: false
```

## Step 1: Gate Card Check

Verify Phase 4.2 is LOCKED and db-schema.md + api-spec.yaml are APPROVED.

## Step 2: Database — Load Schema & Create Migrations

Read `{db_schema_output}`. Generate migration files for each table. Ensure:
- Up migration: CREATE TABLE with all columns, constraints, indexes
- Down migration: DROP TABLE in correct order (respect foreign keys)
- Timestamps: `created_at`, `updated_at` on every table
- Soft delete: `deleted_at` if specified in schema

## Step 3: Database — Define Models & Apply Migrations

Create model/entity files. Run migrations up, verify schema, run down, re-run up. Create seed data for dev/test.

## Step 4: API Client — Routing & Middleware Setup

Configure the routing framework per architecture.md:
- Route registry/entry points created
- Middleware chain configured (auth, logging, cors, rate-limiting)
- Request validation layer (Zod/Joi schemas from api-spec.yaml)
- Standardized error handling middleware
- Health check endpoint returning 200

## Step 5: Verification & Report

Run migration verification. Test middleware chain (health check + one validation endpoint). Generate `{backend_migration_report}` covering both database and API client setup.

## Phase Complete

Update `{sprint_tracking}` under `phases.phase_4.substates.phase_4_3` with status LOCKED.

Present: "Phase 4.3 complete — Database + API Client foundation implemented. Next: Phase 4.4 — Endpoint Implementation."
