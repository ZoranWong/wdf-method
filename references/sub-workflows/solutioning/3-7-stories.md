---
sub_workflow: "3-7-stories"
phase: 3
sub_phase: "3.7"
version: "3.6.0"
title: "Phase 3.7 — Story Design with Contract Freeze Gate"
description: "Transform epics into detailed, actionable user stories with complete acceptance criteria, technical notes, scope_write, acceptance_check, code_standards_source, and execution_units attributes. Enforce the Story Contract Freeze Gate and Development Order Freeze. Block non-compliant stories from entering Phase 4."
dependencies:
  - epics.md (Phase 3.6)
  - architecture.md
  - customize.toml (code_standards_source, protected_paths)
methodology: "BMAD Create Story (iterative) + StoryRail Contract Derivation Standard"
bmad_skill: "/bmad-create-story"
---

# Phase 3.7 — Story Design

**Sub-Phase Goal:** Transform each epic's story outline into detailed, actionable story files with complete acceptance criteria, technical specifications, UI notes, and execution-critical attributes (`parallel_safe`, `scope_write`, `acceptance_check`). **This sub-phase enforces the Development Order Freeze** — the global sequencing that all tracks must follow.

**Why This Matters:** Well-designed story files are the fuel for autonomous development. Each story must be self-contained enough that an agent in Phase 4 can implement it without additional context. The Development Order Freeze ensures consistent sequencing across parallel tracks.

**Duration:** Iterative — runs per story or per epic. User may return to this sub-phase for additional stories until all P0 stories are designed.

**Agent Templates:**
- For deep story design (full AC, scope, contract freeze): use `references/agents/story-planner.md` with `/bmad-create-story`.
- For bulk auto-generation (one stub story per epic as a starting scaffold): use `references/agents/story-slicer.md`. Output is a draft that must be refined by story-planner before the Contract Freeze Gate.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin story design |
| `IN_PROGRESS` | Stories split into individual files | `STORIES_SPLIT` | All stories have files |
| `STORIES_SPLIT` | Acceptance criteria written for all stories | `ACCEPTANCE_WRITTEN` | All stories have ACs |
| `ACCEPTANCE_WRITTEN` | Stories estimated with t-shirt sizes | `ESTIMATED` | All stories sized |
| `ESTIMATED` | Development order established | `ORDERED` | Dev sequence locked |
| `ORDERED` | User verifies all stories | `VERIFIED` | Stories reviewed and confirmed |
| `VERIFIED` | User confirms dev order freeze | `LOCKED` | Development order frozen |

---

## Gate Card

```yaml
gate_card:
  phase: 3
  sub_phase: "3.7"
  enters_from: "3.6"
  checks:
    - id: "G3.7-01"
      description: "Phase 3.6 (Epics) is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_3.substates.phase_3_6.status"
      operator: "eq"
      expected: "LOCKED"

    - id: "G3.7-02"
      description: "Epics artifact exists and is approved"
      type: "artifact_metadata"
      source: "{epics_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]

    - id: "G3.7-03"
      description: "Requirements are frozen"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "global_state.requirements_frozen_at"
      operator: "neq"
      expected: null

    - id: "G3.7-04"
      description: "Architecture is LOCKED"
      type: "artifact_metadata"
      source: "{architecture_output}"
      field: "frontmatter.status"
      operator: "eq"
      expected: "locked"

    - id: "G3.7-05"
      description: "User confirms readiness for story design"
      type: "user_confirmation"
  all_pass: false
```

---

## Step 1: Gate Card Check

Evaluate all G3.7 checks. Record results in `{sprint_tracking}`.

**If gate fails**, surface the specific failed check(s). Abort and return to the Phase 3 sub-phase menu.

**On gate pass**, record:

```yaml
phases:
  phase_3:
    substates:
      phase_3_7:
        status: "IN_PROGRESS"
        gate_card:
          all_pass: true
```

---

## Step 2: Read Epics and Present Selection Menu

Read `{epics_output}` and present the epic hierarchy:

```
Epics ready for story design:

[N] epics, [M] stories total ([B] backend, [F] frontend, [S] full-stack)

Select an approach:
[1] Design all stories in one epic (choose epic)
[2] Design a specific story (choose story ID)
[3] Design all stories sequentially by priority (P0 first)
[4] Design only [backend|frontend|full-stack] stories
[5] Resume from last in-progress story
```

---

## Step 3: Story Design Process (Iterative)

### 3.1 Invoke BMAD Story Skill for Each Story

For each selected story, invoke: `/bmad-create-story`

**Instructions to pass to the skill:**

- Read the parent epic context and story definition from `{epics_output}`.
- Read architecture for tech constraints from `{architecture_output}`.
- Produce a detailed story file with:
  - **Story statement** (As a... I want... So that...)
  - **Acceptance Criteria** (numbered, testable, Given-When-Then format)
  - **Technical Notes** (API endpoints needed, components affected, DB changes)
  - **UI Notes** (for frontend stories: mockup description, states, interactions)
  - **Edge Cases** (empty states, error states, loading states, boundary conditions)
  - **Definition of Done** checklist
  - **Test scenarios** (at least 3 per story)

### 3.2 Save Story File with Execution Attributes

Save to `{stories_output}/story-{N}-{slug}.md` with complete frontmatter:

```yaml
---
artifact_type: "story"
artifact_id: "{STORY_ID}"
epic: "{EPIC_ID}"
title: "{STORY_TITLE}"
phase: 3
sub_phase: "3.7"
track: "{backend|frontend|full-stack}"
priority: "{P0|P1|P2}"
status: "draft"
development_order: {N}
parallel_safe: {true|false}
scope_write:
  - "{path/agent/can/modify}"
out_of_scope:
  - "{path/agent/must/NOT/touch}"
acceptance_check:
  - "{executable verification command}"
code_standards_source:
  - "AGENTS.md"
  - "{additional standard source}"
depends_on: []
estimated_effort: "{XS|S|M|L|XL}"
created_at: "{ISO_TIMESTAMP}"
# Optional: Execution units for per-role parallel isolation (V3.1)
execution_units:
  backend:
    scope_write: ["{be/path}"]
    acceptance_check: ["{be/check/command}"]
    depends_on: []
  frontend:
    scope_write: ["{fe/path}"]
    acceptance_check: ["{fe/check/command}"]
    depends_on: ["backend"]
---
```

### Story Pack Attributes (Execution-Critical)

Each story must define these attributes to enable safe auto-continue development in Phase 4:

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `parallel_safe` | boolean | Yes | Can this story run in parallel with other `parallel_safe: true` stories? Stories touching shared infrastructure (DB schema, auth middleware, routing) should be `false`. |
| `scope_write` | string[] | Yes | Files/directories the implementing agent is allowed to modify. Prevents scope creep — the agent MUST NOT write outside these paths. |
| `out_of_scope` | string[] | Yes (V3.1) | Files/directories the agent MUST NOT touch. Explicitly listing this prevents accidental modification of shared surfaces. |
| `acceptance_check` | string[] | Yes | Executable commands that verify story completion. All must pass with exit code 0 before the story can be ACCEPTED. Must NOT be placeholders. |
| `code_standards_source` | string[] | Yes (V3.1) | Code standards that apply to this story. Inherits from `global_state.code_standards_source`. At minimum must reference `AGENTS.md` or equivalent. Stories without this are **blocked**. |
| `execution_units` | object | No (V3.1) | Optional per-role units (backend/frontend) with independent scope_write and acceptance_checks. Enables finer-grained parallel isolation. |

### V3.1 New Required Fields

**`code_standards_source` rules:**
- MUST be declared. Stories without `code_standards_source` are blocked at the Contract Freeze Gate.
- Inherits defaults from `customize.toml` `defaults.default_code_standards_source` (typically `["AGENTS.md"]`).
- Individual stories can extend or override with story-specific standards.
- Valid sources: `AGENTS.md`, `CLAUDE.md`, `eslint.config.*`, `.prettierrc*`, `tsconfig.json`, `pyproject.toml`, `checkstyle.xml`, etc.

**`out_of_scope` rules (V3.1):**
- MUST be explicitly listed. Cannot be empty or omitted.
- At minimum must list: shared contract paths, root config, schema/migration paths.
- Serves as a negative constraint — the agent must verify it does NOT touch these paths.

**`execution_units` rules (V3.1):**
- Optional. When present, unit-level `scope_write` and `acceptance_check` override story-level values.
- Each unit becomes an independent implementation track in Phase 4.
- Unit `depends_on` specifies intra-story ordering (e.g., frontend unit depends on backend unit).
- Without `execution_units`, the story is implemented as a single unit using story-level scope_write.

**`parallel_safe` rules:**
- `false` → Story must run sequentially. Blocks parallel execution of other `parallel_safe: false` stories.
- `true` → Story can run in parallel with other `parallel_safe: true` stories (in separate agent sessions).
- Infrastructure stories (DB migrations, auth setup, routing config) are typically `parallel_safe: false`.

**`scope_write` rules:**
- Define ALL directories/files the story will reasonably touch.
- The agent checks this at start — if it needs to write outside scope, it halts and requests scope expansion.
- Example backend: `["src/modules/auth/", "src/middleware/auth.ts"]`
- Example frontend: `["src/pages/Login/", "src/hooks/useAuth.ts"]`

**`acceptance_check` rules:**
- Must be shell commands that exit 0 on success, non-zero on failure.
- Should test the story's specific functionality, not the entire codebase.
- Executed AFTER implementation and tests pass — serves as final acceptance gate.
- Example: `["npm run test:auth", "npm run test:integration -- --grep auth"]`

### 3.3 Acceptance Checks Executable Validation (V3.1)

**Objective:** Before saving each story, validate that its `acceptance_check` commands are executable — not abstract descriptions or placeholder text.

**Validation Rules:**

1. **Reject Placeholders**: The following values are rejected as `acceptance_check` entries:
   - `"todo"`, `"tbd"`, `"none"`, `"n/a"`, `"-"`
   - `"通过测试"`, `"验证页面正常"`, `"对齐原型"`, `"符合规范"` (abstract descriptions)
   - `"pass tests"`, `"verify page works"` (vague English descriptions)
   - Empty strings or whitespace-only strings

2. **Validate Command Structure**: Each `acceptance_check` must:
   - Start with a known command prefix: `npm run`, `npx`, `pnpm`, `yarn`, `python`, `pytest`, `cargo`, `go test`, `mvn`, `make`, `docker`, `curl`
   - OR reference a known BMAD skill: `/bmad-`
   - OR be a script path: `./scripts/`, `bin/`

3. **Best-Effort Script Existence Check**: For `npm run <script>` commands:
   - Check if `package.json` exists in the project
   - Verify `<script>` key exists in `package.json.scripts`
   - If not found, emit a **warning** but don't block (script may be added later)

4. **Warning for Unverifiable Commands**: Commands that pass validation but reference tools not yet in the project emit a warning:
   ```
   ⚠ S-4.1 acceptance_check[2]: "npm run test:users" — script "test:users" not found in package.json
   ```
   This is a warning only; the story can still proceed.

**Failure Handling:**
If any `acceptance_check` fails validation:
```
✗ S-4.1 has invalid acceptance_checks:
  [1] "通过测试" — REJECTED: abstract description, must be executable command
  [2] "todo" — REJECTED: placeholder

Action required: Replace with executable commands before this story can be saved.
```

Stories with invalid `acceptance_checks` cannot be saved. The user must fix them.

### 3.4 Story Design Guidelines by Track

**Backend Stories:**
- Define exact API contract (method, path, request/response shape)
- Specify database operations (queries, mutations, transactions)
- Include auth/authorization requirements
- Note caching, rate limiting, or other middleware needs
- Define error response formats
- `scope_write` should cover: validators, services, controllers, routes, migrations

**Frontend Stories:**
- Define component hierarchy affected
- Specify UI states (loading, empty, error, success, edge cases)
- Define client-side data fetching strategy
- Note accessibility requirements (ARIA labels, keyboard nav, color contrast)
- Specify responsive breakpoints
- `scope_write` should cover: pages, components, hooks, styles

**Full-Stack Stories:**
- Define both API and UI aspects
- Note which must be built first (typically backend first for data contracts)
- Include `tasks.backend` and `tasks.frontend` arrays
- `scope_write` covers both BE and FE paths
- Consider splitting into sub-stories if very complex (> L effort)

### 3.5 Mode-Aware Story Format

**Separated Mode (default):**

```yaml
track: "backend"   # Phase 4 implements on backend track
track: "frontend"  # Phase 4 implements on frontend track
track: "full-stack"  # Both tracks, cross-track deps apply
```

**Full-Stack Mode:**

All stories are inherently full-stack. Each story has `tasks` that define the implementation order:

```yaml
---
track: "full-stack"
tasks:
  backend:
    - "Create /api/users POST endpoint with validation"
    - "Create /api/users GET endpoint with pagination"
    - "Add USER role and authorization middleware"
  frontend:
    - "Build UserListPage with table, loading, empty, error states"
    - "Build UserCreatePage with form validation"
    - "Wire useUsers hook with pagination"
  acceptance_check:
    - "npm run test:users"
    - "npm run test:e2e -- --grep users"
    - "npx axe src/pages/users/"
---
```

Full-stack story rules:
- No `depends_on` needed — stories are sequential within the auto-continue loop
- `tasks.backend` is implemented first, then `tasks.frontend`
- `scope_write` covers both BE and FE paths
- `acceptance_check` covers both sides

---

## Step 3.6: Story Contract Freeze Gate (V3.1)

**Objective:** Before proceeding to Development Order Freeze, validate that EVERY story satisfies the execution contract minimum requirements. Non-compliant stories are marked `blocked` and cannot enter Phase 4.

### Contract Freeze Gate Checks

For each story in the current design batch, verify:

```yaml
contract_freeze_gate:
  story_id: "{STORY_ID}"
  checks:
    - id: "CFG-01"
      description: "scope_write is non-empty and paths exist in project"
      rule: "Each scope_write path's parent directory must exist in the project filesystem"
      severity: "blocking"

    - id: "CFG-02"
      description: "out_of_scope is explicitly listed (non-empty)"
      rule: "out_of_scope must contain at least one entry. Cannot be empty or omitted."
      severity: "blocking"

    - id: "CFG-03"
      description: "acceptance_checks are executable (validated by Step 3.3)"
      rule: "All acceptance_check entries must be executable commands. No placeholders, no abstract descriptions."
      severity: "blocking"

    - id: "CFG-04"
      description: "code_standards_source is declared (non-empty)"
      rule: "Must reference at minimum one code standards document (e.g. AGENTS.md). Inherits global_state default if not overridden."
      severity: "blocking"

    - id: "CFG-05"
      description: "dependencies are explicitly listed"
      rule: "depends_on must be present. Write 'None' or empty array if no dependencies."
      severity: "warning"

    - id: "CFG-06"
      description: "parallel_safe is declared with reasoning"
      rule: "parallel_safe must be true or false. If false, should have parallel_notes explaining why."
      severity: "warning"

    - id: "CFG-07"
      description: "If frontend/full-stack story, UX truth source exists"
      rule: "Track is 'backend' OR (wireframes.md exists AND design-tokens.md exists)"
      severity: "blocking"
```

### Gate Evaluation Output

**If ALL blocking checks pass:**
```
✓ STORY-001: Contract Freeze Gate — PASSED
  scope_write: src/modules/auth/ ✓
  out_of_scope: shared/contract, root/config ✓
  acceptance_checks: npm run test:auth ✓ (executable)
  code_standards_source: AGENTS.md ✓
  dependencies: None ✓
  parallel_safe: true ✓
  UI truth: N/A (backend story) ✓
  → Status: ready for Development Order Freeze
```

**If any blocking check fails:**
```
✗ STORY-003: Contract Freeze Gate — BLOCKED
  scope_write: src/pages/Dashboard/ ✓
  out_of_scope: [EMPTY] ✗ BLOCKING — must explicitly list forbidden paths
  acceptance_checks: "验证页面正常" ✗ BLOCKING — abstract description, not executable
  code_standards_source: [EMPTY] ✗ BLOCKING — must declare at least one standard
  dependencies: None ✓
  parallel_safe: true ✓
  UI truth: wireframes.md ✓
  → Status: BLOCKED — cannot enter Phase 4 until all blocking checks pass
```

### Handling Blocked Stories

Stories that fail the Contract Freeze Gate:
1. Are marked `status: "blocked"` in their frontmatter
2. Are NOT included in the development order
3. Must be fixed and re-submitted through this gate
4. Fix options:
   - Fill in missing fields directly
   - Return to Step 3 to redesign the story
   - File a non-blocking CR if the issue is deferred

Only stories that pass ALL blocking checks proceed to Development Order Freeze.

---

## Step 4: Development Order Freeze

After all targeted stories are designed, establish the global development order.

### 4.1 Propose Development Order

Present a proposed order based on:
1. **Dependency graph**: Stories that depend on others go after their dependencies
2. **Priority**: P0 stories first, then P1, then P2
3. **Parallel tracks**: Backend and frontend stories are sequenced independently but interleaved for full-stack coherence

Example presentation:

```
Proposed Development Order:

Backend Track:
[1] S-3.1: Database Setup & Migrations
[2] S-3.2: Auth Endpoints
[3] S-4.1: User CRUD Endpoints
...

Frontend Track:
[1] S-1.1: Project Scaffold
[2] S-1.2: Layout & Navigation
[3] S-2.1: Login Page
...

Cross-Track Dependencies:
- Frontend S-2.1 (Login Page) → depends on → Backend S-3.2 (Auth Endpoints)
- Frontend S-4.1 (User List Page) → depends on → Backend S-4.1 (User CRUD Endpoints)

Parallel Groups:
  group=1: S-3.2 (BE Auth) ⇄ S-1.1 (FE Scaffold) — independent work
  group=2: S-4.1 (BE User CRUD) ⇄ S-1.2 (FE Layout) — independent work
```

### 4.2 Cross-Track Dependency Detection

**Objective:** Detect dependencies between stories on different tracks to ensure Phase 4 auto-continue correctly handles dependency blocking.

For each story in the development order:

1. Inspect story file frontmatter and epic context to identify cross-track dependencies.
2. A cross-track dependency occurs when:
   - A **frontend** story requires an API endpoint produced by a **backend** story
   - A **full-stack** story has a hard prerequisite on another track's story
3. **Detection heuristic** — Flag when a frontend/full-stack story's Technical Notes reference API endpoints produced by a specific backend story.

Update `depends_on` in the development order:

```yaml
development_order:
  - { track: "frontend", order: 4, story_id: "S-2.1", title: "Login Page",
      depends_on: [{story_id: "S-3.2", track: "backend"}] }
```

Present the dependency report:

```
Cross-Track Dependency Report:

FRONTEND S-2.1 (Login Page) ──depends on──> BACKEND S-3.2 (Auth Endpoints)
FRONTEND S-4.1 (User List Page) ──depends on──> BACKEND S-4.1 (User CRUD Endpoints)

No other cross-track dependencies detected.

These stories will be BLOCKED_BY_DEPENDENCY in Phase 4 until
their dependency stories are APPROVED on the other track.
```

Ask: *"Do these cross-track dependencies look correct? [Y] Confirm [N] Edit dependencies"*

### 4.3 Confirm Development Order Freeze

Ask user:

> "Review the proposed development order. This will be the global sequence for all development tracks. Changes after freeze require a Change Request."
>
> "Do you confirm this order? [Y] Freeze Development Order [N] Continue Editing"

When confirmed, write to `{status_phase_03_file}` and `{status_global_file}` (for development_order_frozen_at):

```yaml
global_state:
  development_order_frozen_at: "{ISO_TIMESTAMP}"
  development_order:
    - { track: "backend", order: 1, story_id: "S-3.1", title: "...", parallel_safe: false, scope_write: ["src/db/"], acceptance_check: ["npm run test:db"], code_standards_source: ["AGENTS.md"] }
    - { track: "backend", order: 2, story_id: "S-3.2", title: "...", parallel_safe: true, scope_write: ["src/modules/auth/"], acceptance_check: ["npm run test:auth"], code_standards_source: ["AGENTS.md"] }
    - { track: "frontend", order: 2, story_id: "S-1.1", title: "...", parallel_safe: true, scope_write: ["src/pages/"], acceptance_check: ["npm run test:components"], code_standards_source: ["AGENTS.md", "eslint.config.js"] }
    - { track: "backend", order: 3, story_id: "S-4.1", title: "...", parallel_safe: true, scope_write: ["src/modules/users/"], acceptance_check: ["npm run test:users"], code_standards_source: ["AGENTS.md"] }
    - { track: "frontend", order: 3, story_id: "S-1.2", title: "...", depends_on: [{story_id: "S-1.1", track: "frontend"}], parallel_safe: true, scope_write: ["src/components/layout/"], acceptance_check: ["npm run test:layout"], code_standards_source: ["AGENTS.md", "eslint.config.js"] }
    - { track: "frontend", order: 4, story_id: "S-2.1", title: "...", depends_on: [{story_id: "S-3.2", track: "backend"}], parallel_safe: true, scope_write: ["src/pages/Login/"], acceptance_check: ["npm run test:login"], code_standards_source: ["AGENTS.md", "eslint.config.js"] }
  overall_status: "development_order_frozen"

phases:
  phase_3:
    substates:
      phase_3_7:
        status: "LOCKED"
```

> "Development order is now frozen. All developers follow this sequence. Reordering requires a blocking CR filed against Phase 3.7."

Transition: `ORDERED` → `VERIFIED` → `LOCKED`.

---

## Step 5: Iteration Control

After each story or batch is designed, present:

```
Story {STORY_ID} designed → {stories_output}/story-{N}-{slug}.md

Progress: {designed_count}/{total_count} stories designed

[1] Design next story in this epic
[2] Choose a different epic
[3] Mark all P0 stories complete and freeze development order
[4] Return to Phase 3 menu (continue later)
```

Continue iterating until at minimum all P0 stories are designed and user chooses to complete.

---

## Step 6: Final Verification

Before locking, verify:
- [ ] At least all P0 stories are designed with complete story files
- [ ] Each story file has complete frontmatter with `artifact_type: "story"`
- [ ] Each story has testable acceptance criteria (Given-When-Then)
- [ ] Each story defines `parallel_safe`, `scope_write`, `out_of_scope`, and `acceptance_check`
- [ ] Each story defines `code_standards_source` (V3.1 — blocking if missing)
- [ ] All `acceptance_check` commands pass executable validation (V3.1 — no placeholders)
- [ ] All stories pass the Contract Freeze Gate (V3.1 — blocking checks all pass)
- [ ] Status directory has all stories in development order
- [ ] Development order is frozen in `{sprint_tracking}`
- [ ] Cross-track dependencies are detected and recorded

---

## Step 7: Completion

Update `{sprint_tracking}`:

```yaml
phases:
  phase_3:
    substates:
      phase_3_7:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "STORIES_SPLIT", at: "{ISO}" }
          - { state: "ACCEPTANCE_WRITTEN", at: "{ISO}" }
          - { state: "ESTIMATED", at: "{ISO}" }
          - { state: "ORDERED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "story", path: "{stories_output}/story-1-*.md", status: "locked" }
          - { type: "story", path: "{stories_output}/story-2-*.md", status: "locked" }
        stories_designed: {N}
        stories_backend: {count}
        stories_frontend: {count}
        stories_full_stack: {count}
        development_order_frozen_at: "{ISO_TIMESTAMP}"
        gate_card:
          all_pass: true
```

Present summary:

> "Phase 3.7 complete — Story Design LOCKED, Development Order Frozen."
>
> "**Stories:** {N} stories designed ({B} backend, {F} frontend, {S} full-stack)"
> "**Artifacts:** {N} story files in `{stories_output}/`"
> "**Development Order:** Frozen — sequential and parallel ordering locked"
>
> "Next: Phase 3.8 — API Design, where we design the API contract based on story requirements."

Return to the Phase 3 sub-phase menu.
