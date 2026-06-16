---
sub_workflow: "4-1-sprint-planning"
phase: 4
sub_phase: "4.1"
version: "3.6.0"
title: "Phase 4.1 — Sprint Planning"
description: "Plan the implementation sprint: assess capacity, assign stories to BE and FE tracks, establish sprint goals, and lock the sprint backlog for auto-continue execution."
dependencies:
  - All Phase 3 (Solutioning) artifacts
  - sprint-status.yaml (development order)
methodology: "BMAD Sprint Planning"
bmad_skill: "/bmad-sprint-planning"
---

# Phase 4.1 — Sprint Planning

**Sub-Phase Goal:** Plan the implementation sprint by assessing team capacity, assigning stories from the frozen development order to backend and frontend tracks, establishing sprint goals, and producing a locked sprint plan. This is the final planning step before autonomous implementation begins.

**Step Audit Protocol:** Every step writes a Step Completion Record to `{step_audit_log_output}` after completion. See `specs/step-audit.md` for the full template. Records include: step_id, timestamp, status, skill_used, command_run, summary, quality, artifacts_produced, state_transition, next_action.

**Why This Matters:** Jumping directly into implementation without sprint planning leads to unrealistic expectations, overloaded tracks, and missed dependencies. Sprint planning ensures each track has a manageable, ordered set of stories with clear acceptance criteria.

**Output:** `{sprint_plan_output}` (typically `_wdf_output/sprint-plan.md`)

**Duration:** One session. Runs once at the start of Phase 4, then transitions to LOCKED.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin sprint planning |
| `IN_PROGRESS` | Capacity assessed, tracks planned | `CAPACITY_PLANNED` | Capacity and assignment done |
| `CAPACITY_PLANNED` | Stories assigned to tracks | `STORIES_ASSIGNED` | Stories distributed |
| `STORIES_ASSIGNED` | Sprint backlog locked by user | `SPRINT_LOCKED` | Sprint plan frozen |
| `SPRINT_LOCKED` | Sprint plan verified | `LOCKED` | Implementation ready |

---

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "4.1"
  enters_from: null
  checks:
    - id: "G4.1-01"
      description: "Phase 3 (Solutioning) is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_3.status"
      operator: "eq"
      expected: "LOCKED"

    - id: "G4.1-02"
      description: "Development order is frozen"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "global_state.development_order_frozen_at"
      operator: "neq"
      expected: null

    - id: "G4.1-03"
      description: "Requirements are frozen"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "global_state.requirements_frozen_at"
      operator: "neq"
      expected: null

    - id: "G4.1-04"
      description: "API spec is LOCKED"
      type: "artifact_metadata"
      source: "{api_spec_output}"
      field: "frontmatter.status"
      operator: "eq"
      expected: "locked"

    - id: "G4.1-05"
      description: "DB schema is LOCKED"
      type: "artifact_metadata"
      source: "{db_schema_output}"
      field: "frontmatter.status"
      operator: "eq"
      expected: "locked"

    - id: "G4.1-06"
      description: "All story files exist with LOCKED status"
      type: "all_stories_complete"
      source: "{stories_output}"

    - id: "G4.1-07"
      description: "Implementation readiness check (3.9) is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_3.substates.phase_3_9.status"
      operator: "eq"
      expected: "LOCKED"

    - id: "G4.1-08"
      description: "User confirms readiness for sprint planning"
      type: "user_confirmation"
  all_pass: false
```

---

## Step 1: Gate Card Check

Evaluate all G4.1 checks. Record results in `{sprint_tracking}`.

**If gate fails**, surface the specific failed check(s):

> "Sprint Planning cannot begin yet. The following prerequisites are not met:"
> "- {failed_check_1}"
> "- {failed_check_2}"
>
> "Please complete the missing prerequisites before proceeding."

Abort and return to the Phase 4 sub-phase menu.

**On gate pass**, record:

```yaml
phases:
  phase_4:
    substates:
      phase_4_1:
        status: "IN_PROGRESS"
        gate_card:
          all_pass: true
```

---

## Step 2: Load Development Order and Story Context

Read from `{sprint_tracking}`:
- `global_state.development_order` — the frozen story sequence
- `phases.phase_3.substates.phase_3_7` — story counts by track

Read from `{stories_output}/`:
- All story files for their details (effort estimates, dependencies, track assignments)

Present an overview:

```
Implementation Sprint Overview:

Story Breakdown:
  Backend track:   {B} stories
  Frontend track:  {F} stories
  Full-stack:      {S} stories

Total scope: {total} stories across both tracks

Development Order (from 3.7):
  BE [1] S-3.1: DB Setup (M, parallel_safe: false)
  BE [2] S-3.2: Auth Endpoints (M, parallel_safe: true)
  FE [2] S-1.1: Project Scaffold (S, parallel_safe: true)
  BE [3] S-4.1: User CRUD (M, parallel_safe: true)
  FE [3] S-1.2: Layout & Nav (S, depends_on: FE S-1.1)
  FE [4] S-2.1: Login Page (M, depends_on: BE S-3.2)
  ...
```

---

## Step 3: Assess Capacity and Velocity

Invoke: `/bmad-sprint-planning`

**Instructions to pass to the skill:**

- Assess the capacity for each track based on the development mode.
- For **single-developer mode**: one track is implemented at a time, stories are serial within that track.
- For **parallel mode**: BE and FE tracks run in separate sessions, parallel-safe stories can be concurrent.
- For **full-stack mode**: stories are implemented sequentially across both layers.

### Capacity Assessment

Present to the user:

> "Let's assess capacity for this sprint. How many stories do you estimate can be completed per day on each track?"

Capture:

| Track | Stories Per Day | Parallel Capability |
|-------|-----------------|---------------------|
| Backend | {N} | Can run independently |
| Frontend | {M} | Can run independently |

### Sprint Duration Estimation

Based on the development order and capacity:

```
Estimated Sprint Duration:

Backend Track:  {B} stories @ {N}/day = {B_days} days
Frontend Track: {F} stories @ {M}/day = {F_days} days

With parallel execution (separate sessions):
  Max duration: {max_days} days
  Optimized with parallel-safe grouping: {optimized_days} days

With serial execution (single session):
  Total duration: {B_days + F_days} days
```

Transition: `IN_PROGRESS` → `CAPACITY_PLANNED`.

---

## Step 4: Assign Stories to Sprint Backlog

Based on the development order and capacity, organize stories into a sprint backlog.

### 4.1 Backend Track Sprint Backlog

```
Backend Track Sprint:

  Week 1:
    [1] S-3.1: DB Setup & Migrations (M, parallel_safe: false)
    [2] S-3.2: Auth Endpoints (M, parallel_safe: true)
    ⇄ Can run in parallel with FE S-1.1

  Week 2:
    [3] S-4.1: User CRUD Endpoints (M, parallel_safe: true)
    [4] S-5.1: {Resource} CRUD Endpoints (L, depends_on: S-3.2)
    ⇄ Can run in parallel with FE S-1.2, S-2.1

  Week 3:
    [5] S-6.1: {Additional} Endpoints (M, depends_on: S-4.1)
```

### 4.2 Frontend Track Sprint Backlog

```
Frontend Track Sprint:

  Week 1:
    [1] S-1.1: Project Scaffold (S, parallel_safe: true)
    [2] S-1.2: Layout & Navigation (S, depends_on: FE S-1.1)
    ⇄ Can run in parallel with BE S-3.2

  Week 2:
    [3] S-2.1: Login Page (M, depends_on: BE S-3.2)
    [4] S-4.1: User List Page (M, depends_on: BE S-4.1)
    ⇄ Can run in parallel with BE S-4.1

  Week 3:
    [5] S-5.1: {Resource} Pages (M, depends_on: BE S-5.1)
```

### 4.3 Parallel Group Mapping

Identify stories that can run in parallel across tracks:

```
Parallel Groups:
  Group A (Week 1):
    BE S-3.2 (Auth Endpoints)  ⇄  FE S-1.1 (Project Scaffold)
    — Independent work, separate code areas

  Group B (Week 2):
    BE S-4.1 (User CRUD)      ⇄  FE S-1.2 (Layout & Nav)
    — Independent work, no shared files

  Group C (Week 3):
    BE S-5.1 ({Resource})     ⇄  FE S-4.1 (User List) + FE S-2.1 (Login)
    — Login depends on BE S-3.2, User List depends on BE S-4.1
```

### 4.4 Dependency Timeline

Map cross-track dependencies to ensure FE stories don't start before their BE dependencies are complete:

```
Dependency Timeline:

  BE S-3.2 (Auth) → completes Week 1
    └── FE S-2.1 (Login) → can start Week 2

  BE S-4.1 (User CRUD) → completes Week 2
    └── FE S-4.1 (User List) → can start Week 3

  BE S-5.1 ({Resource}) → completes Week 3
    └── FE S-5.1 ({Resource} Pages) → can start Week 4
```

Transition: `CAPACITY_PLANNED` → `STORIES_ASSIGNED`.

---

## Step 5: Define Sprint Goals

Establish measurable sprint goals for each track:

```
Backend Track Goals:
  1. All {B} backend stories implemented and tested
  2. Test coverage >= {threshold}%
  3. All endpoints match API spec contract
  4. All acceptance checks pass (exit 0)

Frontend Track Goals:
  1. All {F} frontend stories implemented and tested
  2. Lighthouse scores >= {threshold} all categories
  3. All UI states handled (loading, empty, error, success)
  4. Accessibility audit passes (axe-core)
  5. All acceptance checks pass (exit 0)
```

---

## Step 6: Generate Sprint Plan

Write the sprint plan to `{sprint_plan_output}` with frontmatter:

```yaml
---
artifact_type: "sprint_plan"
artifact_id: "{project}-sprint-plan-v1"
phase: 4
sub_phase: "4.1"
status: "draft"
version: "3.6.0"
created_at: "{ISO_TIMESTAMP}"
---
```

Sprint plan content must include:

```markdown
# Sprint Plan: {project_name}

## Sprint Overview
- **Start Date:** {date}
- **Estimated Duration:** {days} days
- **Mode:** {separated|full-stack|single-developer}
- **Total Stories:** {total} (BE: {B}, FE: {F}, Full-stack: {S})

## Backend Track Sprint Backlog
| Order | Story ID | Title | Effort | Dependencies | Parallel Safe |
|-------|----------|-------|--------|-------------|---------------|
| 1 | S-3.1 | DB Setup | M | none | false |
| 2 | S-3.2 | Auth Endpoints | M | none | true |
| ... | ... | ... | ... | ... | ... |

## Frontend Track Sprint Backlog
| Order | Story ID | Title | Effort | Dependencies | Parallel Safe |
|-------|----------|-------|--------|-------------|---------------|
| 1 | S-1.1 | Project Scaffold | S | none | true |
| 2 | S-1.2 | Layout & Nav | S | FE S-1.1 | true |
| ... | ... | ... | ... | ... | ... |

## Parallel Groups
...

## Cross-Track Dependencies
...

## Sprint Goals
...

## Risk Register
| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| ... | ... | ... | ... |
```

---

## Step 7: Lock Sprint Plan

Present the complete sprint plan to the user:

> "Sprint plan complete. Here's the summary:"
>
> "- **Backend Track:** {B} stories, estimated {B_days} days"
> "- **Frontend Track:** {F} stories, estimated {F_days} days"
> "- **Parallel Groups:** {G} groups with independent execution"
> "- **Cross-Track Dependencies:** {D} dependencies that affect ordering"
>
> "This sprint plan will govern the auto-continue execution in subsequent sub-phases."
>
> "Do you want to lock this sprint plan? [Y] Lock Sprint Plan [N] Edit"

When user confirms:

Transition: `STORIES_ASSIGNED` → `SPRINT_LOCKED`.

Update sprint plan frontmatter:

```yaml
status: "locked"
locked_at: "{ISO_TIMESTAMP}"
```

Update `{sprint_tracking}`:

```yaml
global_state:
  sprint_plan_locked_at: "{ISO_TIMESTAMP}"
  sprint_backlog:
    backend:
      - { order: 1, story_id: "S-3.1", effort: "M", parallel_safe: false }
      - { order: 2, story_id: "S-3.2", effort: "M", parallel_safe: true }
      ...
    frontend:
      - { order: 1, story_id: "S-1.1", effort: "S", parallel_safe: true }
      ...

phases:
  phase_4:
    substates:
      phase_4_1:
        status: "SPRINT_LOCKED"
        sprint_plan: "{sprint_plan_output}"
```

> "Sprint plan locked. All stories in the backlog are committed for this sprint."

---

## Step 8: Scope Write Validation and Git Tag

### 8.1 Validate All Stories Have scope_write

For every story in the development order, verify `scope_write` is defined and non-empty:

**Console Output** (follow specs/scope-lock.md Operation 2 format):

```
═══════════════════════════════════════════════════════
SCOPE LOCK — Scope Write Validation
═══════════════════════════════════════════════════════
  Phase:    4.1
  Step:     8.1
  Skill:    /bmad-sprint-planning
  Command:  N/A (reads sprint-status.yaml)
  Status:   PASS
───────────────────────────────────────────────────────
  Story Validation:
    ✓ S-3.1: scope_write = ["src/db/", "src/migrations/"]
    ✓ S-3.2: scope_write = ["src/modules/auth/", "src/middleware/auth.ts"]
    ...
  Result: {total}/{total} stories have valid scope_write
───────────────────────────────────────────────────────
  Summary:  All {total} stories have valid scope_write
  Next:     Step 8.2 — Parallel Scope Overlap Detection
═══════════════════════════════════════════════════════
```

**Document Record** — append to `{scope_audit_log_output}` (see specs/scope-lock.md Operation 2).

If any story has an empty or missing `scope_write`, halt:
> "Sprint Planning cannot proceed. Story {story_id} has no scope_write defined. Return to Phase 3.7 to add scope_write for this story."

### 8.2 Detect Parallel Story Scope Overlap

For stories that can run in parallel (same `parallel_group` or `parallel_safe: true`), check for `scope_write` overlap:

**Console Output** (follow specs/scope-lock.md Operation 3 format):

```
═══════════════════════════════════════════════════════
SCOPE LOCK — Parallel Scope Overlap Detection
═══════════════════════════════════════════════════════
  Phase:    4.1
  Step:     8.2
  Skill:    /bmad-sprint-planning
  Command:  N/A (compares scope_write arrays)
  Status:   PASS
───────────────────────────────────────────────────────
  Parallel Groups Checked:
    Group A: S-3.2 (BE) ⇄ S-1.1 (FE) — NO overlap ✓
    Group B: S-4.1 (BE) ⇄ S-1.2 (FE) — NO overlap ✓
  Overlaps Found: 0
───────────────────────────────────────────────────────
  Summary:  0 scope overlaps across {G} parallel groups
  Next:     Step 8.3 — Create Git Scope Tag
═══════════════════════════════════════════════════════
```

**Document Record** — append to `{scope_audit_log_output}` (see specs/scope-lock.md Operation 3).

### 8.3 Create Git Scope Tag

Create a git tag as the scope freeze baseline for all scope verification during Phase 4:

```bash
git tag -a scope-freeze/pre-implementation -m "Scope freeze: implementation boundary locked before Phase 4 execution"
```

**Console Output** (follow specs/scope-lock.md Operation 4 format):

```
═══════════════════════════════════════════════════════
SCOPE LOCK — Git Scope Tag Creation
═══════════════════════════════════════════════════════
  Phase:    4.1
  Step:     8.3
  Skill:    N/A
  Command:  git tag -a scope-freeze/pre-implementation -m "..."
  Status:   PASS
───────────────────────────────────────────────────────
  Tag:     scope-freeze/pre-implementation
  Base:    HEAD ({commit_sha})
  Purpose: Diff baseline for all scope verification in Phase 4
───────────────────────────────────────────────────────
  Summary:  Git scope tag created — scope-freeze/pre-implementation
  Next:     Step 9 — Verify and Final Lock
═══════════════════════════════════════════════════════
```

**Document Record** — append to `{scope_audit_log_output}` (see specs/scope-lock.md Operation 4).

---

## Step 9: Verify and Final Lock

Final verification checklist:
- [ ] Sprint plan covers all stories from development order
- [ ] Cross-track dependencies are documented in the plan
- [ ] Parallel group assignments are consistent with `parallel_safe` flags
- [ ] Sprint goals are measurable and trackable
- [ ] Sprint plan is saved and locked
- [ ] All stories have non-empty `scope_write` (Step 8.1)
- [ ] No parallel story `scope_write` overlaps (Step 8.2)
- [ ] Git scope tag `scope-freeze/pre-implementation` created (Step 8.3)

Transition: `SPRINT_LOCKED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_4:
    substates:
      phase_4_1:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "CAPACITY_PLANNED", at: "{ISO}" }
          - { state: "STORIES_ASSIGNED", at: "{ISO}" }
          - { state: "SPRINT_LOCKED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "sprint_plan", path: "{sprint_plan_output}", status: "locked" }
        sprint_stats:
          total_stories: {N}
          backend_stories: {B}
          frontend_stories: {F}
          full_stack_stories: {S}
          parallel_groups: {G}
          cross_track_deps: {D}
          estimated_days_total: {T}
        gate_card:
          all_pass: true
```

---

## Step 9: Completion

Present summary:

> "Phase 4.1 complete — Sprint Planning LOCKED."
>
> "**Sprint Plan:** `{sprint_plan_output}`"
> "**Backend Track:** {B} stories, {B_days} estimated days"
> "**Frontend Track:** {F} stories, {F_days} estimated days"
> "**Parallel Groups:** {G} independent work streams"
> "**Cross-Track Dependencies:** {D}"
>
> "The sprint plan governs the auto-continue execution in subsequent implementation sub-phases."
>
> "Next: Phase 4.2 — Backend Scaffolding."

Return to the Phase 4 sub-phase menu.
