---
sub_workflow: "4-2-be-scaffolding"
phase: 4
sub_phase: "4.2"
version: "3.6.0"
title: "Phase 4.2 — Backend Scaffolding"
description: "Initialize the backend project, configure the framework, set up project structure, configure environment variables, database connection, logging, and error handling. Establish the foundation for all subsequent backend development."
dependencies:
  - architecture.md
  - api-spec.yaml
---

# Phase 4.2 — Backend Scaffolding

**Sub-Phase Goal:** Initialize the backend project with proper structure, tooling, environment configuration, database connectivity, error handling, and logging. This phase creates the foundation that all backend stories build upon.

**Gate:** Architecture must be LOCKED. API spec must be APPROVED.

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin scaffolding |
| `IN_PROGRESS` | Project initialized + structure set up | `SCAFFOLDED` | Foundation in place |
| `SCAFFOLDED` | Dev server starts + all checks pass | `VERIFIED` | Scaffold verified |
| `VERIFIED` | Report generated | `LOCKED` | Artifact locked |

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "4.2"
  enters_from: null
  checks:
    - id: "G4.2-01"
      description: "Architecture is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_3.status"
      operator: "eq"
      expected: "LOCKED"
    - id: "G4.2-02"
      description: "API spec is APPROVED"
      type: "artifact_metadata"
      source: "{api_spec_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]
  all_pass: false
```

## Step 1: Gate Card Check

Verify architecture and API spec are ready.

## Step 2: Project Initialization

Initialize the backend project with the framework chosen in architecture.md. Set up TypeScript, ESLint, Prettier, and testing framework.

## Step 3: Folder Structure

Create the canonical folder structure based on Clean Architecture:

```
src/
  controllers/    # Request handling
  services/       # Business logic
  repositories/   # Data access
  validators/     # Input validation schemas
  middleware/     # Auth, logging, error handling
  routes/         # Route definitions
  types/          # TypeScript types/interfaces
  utils/          # Utility functions
  config/         # Configuration (env, DB, etc.)
tests/
  unit/           # Unit tests
  integration/    # Integration tests
  helpers/        # Test utilities, mocks
migrations/       # Database migrations
seeds/            # Seed data
```

## Step 4: Environment Configuration

Create `.env.example` with all required variables. Set up typed environment config. Configure `.gitignore` for `.env`.

## Step 5: Database Connection

Establish database connection with connection pooling. Configure migration tool. Set up health check endpoint.

## Step 6: Error Handling & Logging

Set up centralized error handling middleware. Configure structured logging. Define standard error response format.

## Step 7: Verification

Run dev server, lint, type check, verify health endpoint responds.

## Step 8: Scaffold Report

Generate `{backend_scaffold_report}` with frontmatter per artifact schema.

Report must include: framework/version, folder structure, environment variables, database connection status, verification results.

## Phase Complete

Update `{sprint_tracking}` under `phases.phase_4.substates.phase_4_2` with status LOCKED.

Present: "Phase 4.2 complete — Backend scaffold ready. Next: Phase 4.3 — Database Implementation."
