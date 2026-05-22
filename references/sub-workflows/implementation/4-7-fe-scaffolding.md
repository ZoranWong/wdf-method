---
title: "Phase 4.7 — Frontend Scaffolding"
description: >
  Initialize the frontend project, configure the build toolchain, set up routing,
  create the base layout shell, and verify the scaffold is ready for development.
  This phase establishes the foundation that all subsequent frontend phases build upon.
sub_workflow: "4-7-fe-scaffolding"
phase: 4
sub_phase: "4.7"
version: "3.6.0"
inputs:
  - architecture.md
  - api-spec.yaml
outputs:
  - frontend-scaffold-report.md
dependencies:
  upstream: []
  downstream: [phase_4_8, phase_4_9]
---

# Phase 4.7 — Frontend Scaffolding

## FSM State Transition Table

| Current State   | Valid Transition        | Trigger / Condition                              | Next State    |
|:----------------|:------------------------|:-------------------------------------------------|:--------------|
| NOT_STARTED     | START                   | Gate Card passes; phase execution begins         | IN_PROGRESS   |
| IN_PROGRESS     | SCAFFOLD                | Project init + routing + layout complete         | SCAFFOLDED    |
| SCAFFOLDED      | VERIFY                  | Dev server starts, all routes render, lint pass  | VERIFIED      |
| VERIFIED        | LOCK                    | Scaffold report generated and reviewed           | LOCKED        |
| NOT_STARTED     | (none)                  | —                                                 | —             |
| IN_PROGRESS     | FAIL                    | Irrecoverable error in scaffolding               | NOT_STARTED   |
| SCAFFOLDED      | FAIL                    | Verification reveals fatal flaw                  | IN_PROGRESS   |
| VERIFIED        | UNLOCK                  | Gate re-evaluation required after upstream change| SCAFFOLDED    |

**Final State:** `LOCKED`
**State persistence:** `sprint-status.yaml` key `phase_4_7`

---

## Gate Card

```yaml
gate_card:
  phase: 4.7
  gates:
    - check: architecture.md.locked
      operator: equals
      expected: true
      fail_action: "HALT — architecture.md must be LOCKED before frontend scaffolding begins"
    - check: api_spec_yaml.approved
      operator: equals
      expected: true
      fail_action: "HALT — api-spec.yaml must be APPROVED before frontend scaffolding begins"
  gate_pass_action: "Set phase_4_7 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step-by-Step Instructions

### Step 1 — Gate Card Check

Read `{sprint_tracking}/sprint-status.yaml`. Verify both gate conditions:

- `architecture.md` status must be `locked: true`
- `api-spec.yaml` status must be `approved: true`

If either condition fails, **HALT** and report which gate is not met. Do not proceed until the upstream artifact is locked/approved.

If both gates pass, update `sprint-status.yaml`:

```yaml
phase_4_7: IN_PROGRESS
```

---

### Step 2 — Load Inputs

Read the following input artifacts in full:

1. **`{architecture_output}/architecture.md`**
   - Extract: frontend framework choice (React / Vue / Svelte / etc.)
   - Extract: component tree design (pages, layouts, shared components)
   - Extract: state management approach (Redux / Zustand / Pinia / etc.)
   - Extract: routing design (page routes, nested routes, guards)
   - Extract: CSS/styling framework (Tailwind / CSS Modules / styled-components / etc.)
   - Extract: bundler choice (Vite / Webpack / etc.)
   - Extract: testing framework choice (Jest + RTL / Vitest / Playwright / etc.)

2. **`{api_spec_output}/api-spec.yaml`**
   - Extract: base URL structure
   - Extract: authentication scheme (Bearer token / cookie / OAuth)
   - Extract: broad resource groupings (for service folder naming)

---

### Step 3 — Project Initialization

Based on the framework choice from `architecture.md`, scaffold the project:

```bash
# React + Vite + TypeScript
npm create vite@{version} {project-root} -- --template react-ts

# OR Vue + Vite + TypeScript
npm create vite@{version} {project-root} -- --template vue-ts

# OR Svelte + Vite + TypeScript
npm create vite@{version} {project-root} -- --template svelte-ts
```

Configure TypeScript strict mode in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true
  }
}
```

Set up ESLint + Prettier:

```bash
npm install -D eslint prettier eslint-config-prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

Create the canonical folder structure:

```
{project-root}/
  src/
    components/    # Shared/base UI components
    pages/         # Page-level components (one per route)
    hooks/         # Custom React/Vue composables
    services/      # API service functions
    stores/        # State management (Zustand/Pinia stores)
    types/         # Shared TypeScript types/interfaces
    utils/         # Pure utility functions
    styles/        # Global styles, design tokens, theme
  public/          # Static assets
  tests/           # Test setup, mocks, utilities
    components/    # Component tests
    pages/         # Page/integration tests
```

---

### Step 4 — Routing Setup

Install and configure the router per framework:

```bash
# React Router
npm install react-router-dom

# Vue Router
npm install vue-router

# SvelteKit (built-in) or svelte-spa-router
npm install svelte-spa-router
```

Create the route table from `architecture.md` routing design. Example structure:

```typescript
// src/router/index.ts
const routes = [
  { path: '/',           component: () => import('@/pages/HomePage') },
  { path: '/login',      component: () => import('@/pages/LoginPage') },
  { path: '/dashboard',  component: () => import('@/pages/DashboardPage'), guard: 'auth' },
  { path: '*',           component: () => import('@/pages/NotFoundPage') },
];
```

Implement the layout component structure:

- **AppShell** — outermost wrapper
- **Header** — top navigation bar
- **Sidebar** — collapsible side navigation (desktop)
- **MainContent** — `<Outlet />` or router-view area
- **Footer** — optional footer bar

---

### Step 5 — Base Layout Component

Create a responsive layout shell. Requirements:

```typescript
// Layout.tsx / Layout.vue / Layout.svelte
```

**Header:**
- Application logo/title (links to home)
- Primary navigation links
- User menu (avatar, logout) — placeholder until auth is wired
- Mobile hamburger toggle

**Sidebar:**
- Navigation links from route table
- Active route highlighting
- Collapsible on mobile (overlay or push)
- Icons for each nav item

**Main Content Area:**
- Standardized padding and max-width
- Loading state: full-page spinner or skeleton
- Error state: error boundary with retry button
- Empty state: centered illustration + message + CTA

**Footer:**
- Copyright, version info
- Secondary links (privacy, terms)

**Responsive breakpoints** (map to design tokens in Phase 4.8):
- Mobile: < 768px — sidebar hidden, hamburger toggle
- Tablet: 768px – 1024px — collapsed sidebar (icons only)
- Desktop: > 1024px — full sidebar

---

### Step 6 — Environment Configuration

Create `.env` file:

```env
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

Create `.env.example` (committed):

```env
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

Create typed environment constants:

```typescript
// src/utils/env.ts
export const env = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL as string,
} as const;
```

Configure CORS proxy in dev server (`vite.config.ts`):

```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: env.API_BASE_URL,
        changeOrigin: true,
      },
    },
  },
});
```

Add `.env` to `.gitignore` (ensure `.env.example` is NOT ignored).

---

### Step 7 — Verification

Run the following checks sequentially. **All must pass** to transition to VERIFIED.

```bash
# 1. Start dev server and verify it compiles without errors
npm run dev
# Manual: open browser, click through all routes, verify each renders

# 2. Lint
npm run lint
# Must exit 0 with zero errors (warnings OK per quality_gates config)

# 3. Type check
npm run type-check
# or: npx tsc --noEmit
# Must exit 0 with zero errors

# 4. Build check (optional but recommended)
npm run build
# Must produce a working production bundle
```

Checklist:
- [ ] Dev server starts without errors
- [ ] All routes defined in architecture.md render a component
- [ ] Base layout (header, sidebar, main, footer) renders on every page
- [ ] Mobile responsive (test at 375px, 768px, 1440px)
- [ ] `npm run lint` exits with 0 errors
- [ ] `npm run type-check` exits with 0 errors
- [ ] `.env.example` exists and is committed
- [ ] `.env` is gitignored

If any check fails, fix and re-run. Once all pass, update `sprint-status.yaml`:

```yaml
phase_4_7: VERIFIED
```

---

### Step 8 — Scaffold Report

Generate `{project-root}/frontend-scaffold-report.md` with the following frontmatter (per artifact-frontmatter-schema):

```yaml
---
artifact_id: "frontend-scaffold-report"
artifact_type: "report"
phase: "4.7"
status: "LOCKED"
created: "{iso-timestamp}"
framework: "{react|vue|svelte}"
bundler: "{vite|webpack}"
router: "{react-router|vue-router|svelte-spa-router}"
styling: "{tailwind|css-modules|styled-components}"
state_management: "{zustand|redux|pinia}"
typescript_strict: true
lint_passes: true
type_check_passes: true
---
```

Report body must include:
- Project initialization summary (framework, version, tooling)
- Route table (path → component mapping)
- Folder structure (tree diagram)
- Layout component description (header, sidebar, main, footer)
- Environment configuration summary
- Verification results (lint output, type-check output, dev-server screenshot or log)
- Known issues / TODO items carried forward

---

## Phase Complete

When all steps are done and the report is generated, lock the phase in `sprint-status.yaml`:

```yaml
phase_4_7: LOCKED
phase_4_7_artifact: "frontend-scaffold-report.md"
phase_4_7_locked_at: "{iso-timestamp}"
```

This unlocks Phase 4.8 and Phase 4.9 (both depend only on 4.7 being LOCKED).
