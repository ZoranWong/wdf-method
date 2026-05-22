---
sub_workflow: "fullstack-1"
phase: 4
sub_phase: "fs-1"
version: "3.6.0"
title: "Full-Stack Scaffolding"
description: "Initialize the unified full-stack project (Next.js/Nuxt/Remix). Set up project structure, toolchain, and shared configuration for BE+FE in a single codebase."
# V3.6 parity: SRG-04 path safety, scope_lock forbidden_paths (.env.*), see phase-04-implementation.md § Scope Lock Protocol
dependencies:
  - sprint-status.yaml (Phase 3 LOCKED)
  - api-spec.yaml
  - architecture.md (component-design.md)
mode: "full_stack"
bmad_skill: "/bmad-dev-story"
skip: false
---

# Full-Stack 1 — Scaffolding

**Sub-Phase Goal:** Bootstrap the full-stack project with the chosen framework. Set up directories, toolchain, environment configuration, and shared utilities so that both BE and FE code can coexist within the same project.

**Gate:** Phase 3 must be LOCKED. `dev_mode` must be `"full_stack"`.

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate passes | `IN_PROGRESS` | Scaffolding begins |
| `IN_PROGRESS` | Project initialized + config set | `SCAFFOLDED` | Base project ready |
| `SCAFFOLDED` | Toolchain verified (build/dev work) | `VERIFIED` | Build + dev server pass |
| `VERIFIED` | User confirmation | `LOCKED` | Scaffolding complete |

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "fs-1"
  enters_from: "3"
  checks:
    - id: "GFS1-01"
      description: "Phase 3 status is LOCKED"
      type: "dependency_status"
      field: "phases.phase_3.status"
      operator: "eq"
      expected: "LOCKED"
    - id: "GFS1-02"
      description: "dev_mode is full_stack"
      type: "artifact_metadata"
      source: "{customize_config}"
      field: "workflow.dev_mode"
      operator: "eq"
      expected: "full_stack"
    - id: "GFS1-03"
      description: "api-spec.yaml is APPROVED or LOCKED"
      type: "artifact_metadata"
      source: "{api_spec_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]
  all_pass: false
```

---

## Step 0: Load Configuration

Read `{customize_config}` to determine:
- `workflow.default_frontend_framework` (used as full-stack framework)
- `workflow.default_database`
- `workflow.default_api_style`
- `workflow.default_auth_method`
- Output paths

The framework determines the project template (e.g., `react`/`next.js` → create-next-app, `vue`/`nuxt` → create-nuxt-app).

## Step 1: Gate Check

Evaluate GFS1 checks. Abort if any fail.

## Step 2: Project Initialization

### 2a. Framework Selection

Based on `customize.toml` frontend framework:

| Framework | Template Command | Notes |
|-----------|-----------------|-------|
| `next.js` | `create-next-app` | App Router (default), TypeScript |
| `nuxt` | `nuxi init` | Nuxt 3, TypeScript |
| `remix` | `create-remix` | TypeScript |
| `sveltekit` | `create-svelte` | SvelteKit, TypeScript |

### 2b. Directory Structure

```
{project}/
├── src/
│   ├── app/            # App Router (Next.js) or pages/ (others)
│   ├── components/     # Shared React/Vue/Svelte components
│   ├── lib/            # Shared utilities
│   │   ├── db/         # Database client + migrations
│   │   ├── auth/       # Auth utilities
│   │   └── api/        # API client + server utilities
│   ├── server/         # Server-side code (API routes)
│   │   ├── routes/     # API endpoints
│   │   ├── services/   # Business logic
│   │   └── validators/ # Input validation
│   └── styles/         # Global styles
├── prisma/             # ORM schema (if applicable)
├── public/             # Static assets
├── tests/              # E2E + integration tests
├── .env.example
├── package.json
└── tsconfig.json
```

### 2c. Toolchain Setup

Install and configure:
1. **TypeScript** — strict mode enabled
2. **ESLint** — project convention rules
3. **Prettier** — code formatting
4. **Testing framework** — Vitest (default for full-stack)
5. **E2E framework** — Playwright (default)
6. **Environment variables** — `.env.example` with required vars

### 2d. Shared Configuration

Create configuration files:
- Database connection config
- Auth provider config (JWT, NextAuth, etc.)
- API base URL / CORS settings
- Feature flags

## Step 3: Verify Toolchain

```bash
npm run dev     # Development server starts
npm run build   # Production build succeeds
npm run lint    # Lint passes
npm run test    # Tests run (0 tests initially)
```

If any command fails, fix and re-run.

## Step 4: Record State in Sprint Status

```yaml
phases:
  phase_4:
    substates:
      phase_fs_1:
        status: "LOCKED"
        state_history:
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "SCAFFOLDED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "project_scaffold", path: "{project_root}", status: "complete" }
```

## Phase Complete

Present summary and advance to Full-Stack 2 (Foundation).

```
═══════════════════════════════════════════
Full-Stack 1 — Scaffolding Complete
═══════════════════════════════════════════
Framework: {framework} v{version}
Project: {project_root}
Toolchain: TypeScript, ESLint, Prettier, Vitest, Playwright ✓
Build check: pass ✓
Dev server: pass ✓

Next: Full-Stack 2 — Foundation (database, auth, shared utilities)
```
