---
sub_workflow: "3-6-epics"
phase: 3
sub_phase: "3.6"
version: "3.6.0"
title: "Phase 3.6 — Epics & Feature Plan"
description: "Break down PRD features into epics and user stories, organize into a prioritized plan, tag stories by development track, and enforce the Requirements Freeze."
dependencies:
  - prd.md
  - architecture.md
methodology: "BMAD Create Epics and Stories"
bmad_skill: "/bmad-create-epics-and-stories"
---

# Phase 3.6 — Epics & Feature Plan

**Sub-Phase Goal:** Break down the PRD features into epics and user stories, organize them into a prioritized plan, tag each story with its development track (backend / frontend / full-stack), and produce a trackable epics document. **This sub-phase enforces the Requirements Freeze** — after this, no new features may be added without a formal Change Request.

**Why This Matters:** Structured epic planning ensures complete feature coverage, clear priorities, and a shared understanding of what will be built. The track tagging (backend / frontend / full-stack) enables parallel development routing in later phases.

**Duration:** This sub-phase continues until the epics document is complete, approved, and requirements are frozen.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin epic breakdown |
| `IN_PROGRESS` | Features extracted from PRD | `EPICS_EXTRACTED` | All features mapped to epics |
| `EPICS_EXTRACTED` | Acceptance criteria defined | `ACCEPTANCE_DEFINED` | All stories have ACs |
| `ACCEPTANCE_DEFINED` | Stories estimated | `ESTIMATED` | All stories have t-shirt sizes |
| `ESTIMATED` | Epics ordered by priority | `ORDERED` | Epics prioritized (P0, P1, P2) |
| `ORDERED` | User verifies epics | `VERIFIED` | Epics reviewed and confirmed |
| `VERIFIED` | User confirms requirements freeze | `LOCKED` | Requirements frozen, no new features |

---

## Gate Card

```yaml
gate_card:
  phase: 3
  sub_phase: "3.6"
  enters_from: null
  checks:
    - id: "G3.6-01"
      description: "Phase 2 (Planning) is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_2.status"
      operator: "eq"
      expected: "LOCKED"

    - id: "G3.6-02"
      description: "PRD artifact is available and LOCKED"
      type: "artifact_metadata"
      source: "{prd_output}"
      field: "frontmatter.status"
      operator: "eq"
      expected: "locked"

    - id: "G3.6-03"
      description: "Architecture artifact is LOCKED"
      type: "artifact_metadata"
      source: "{architecture_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]

    - id: "G3.6-04"
      description: "Architecture defines tech stack"
      type: "artifact_metadata"
      source: "{architecture_output}"
      field: "frontmatter.sections_complete"
      operator: "contains_all"
      expected:
        - tech_stack
        - deployment_architecture
        - component_tree
        - routing_design

    - id: "G3.6-05"
      description: "User confirms readiness for epic planning"
      type: "user_confirmation"
  all_pass: false
```

---

## Step 1: Gate Card Check

Evaluate all G3.6 checks. Record results in `{sprint_tracking}`.

**If gate fails**, surface the specific failed check(s):

> "Gate check failed: {failed_check_descriptions}. These prerequisites must be satisfied before we can begin epic planning."

Abort and return to the Phase 3 sub-phase menu.

**On gate pass**, record:

```yaml
phases:
  phase_3:
    substates:
      phase_3_6:
        status: "IN_PROGRESS"
        gate_card:
          checks: [{id: "G3.6-01", status: "pass"}, ...]
          all_pass: true
```

---

## Step 2: Read Inputs

Read for context:
- `{prd_output}` — features, priorities, user personas, functional/non-functional requirements
- `{architecture_output}` — tech stack, component tree, routing table, deployment architecture

Extract:
- All functional requirements and their priorities (P0, P1, P2)
- User personas (determine whose perspective each story targets)
- Component tree (maps to frontend stories)
- Backend modules (maps to backend stories)
- API requirements implied by PRD features

---

## Step 3: Invoke Epics Skill

Present to the user:

> "Phase 3.6: Epics & Feature Plan. We'll organize features from the PRD into epics grouped by user value — not by technical layer. Each story will be tagged for its development track (backend, frontend, or full-stack) to enable parallel development in Phase 4."

Invoke: `/bmad-create-epics-and-stories`

**Instructions to pass to the skill:**

1. Read PRD from `{prd_output}` and architecture from `{architecture_output}`.
2. Organize epics by user-facing feature area, NOT by technical layer.
3. Each epic must include: goal (one sentence), user value (why it matters), stories with acceptance criteria, dependencies.
4. Prioritize: P0 stories first, then P1, then P2.
5. Tag each story with `backend`, `frontend`, or `full-stack` for parallel dev routing in Phase 4.
6. Output to `{epics_output}`.
7. Frontmatter must include `artifact_type: "epics"`, `phase: 3`, `sub_phase: "3.6"`, `status: "draft"`.

### Epic Structure Template

```
Epic {N}: {Epic Title}
Priority: {P0|P1|P2}
Goal: {One-sentence goal}
User Value: {Why this matters to users}

Stories:
  Story {N}.1: {Story Title} [frontend|backend|full-stack]
    As a {persona}, I want {action} so that {outcome}
    Acceptance Criteria:
      1. {AC-1}
      2. {AC-2}
    Dependencies: {dependency_stories_or_none}
    Estimate: {t-shirt_size}

  Story {N}.2: ...
```

### Track Tagging Guidelines

- **`frontend`** — UI-only work (components, pages, styling, client state management)
- **`backend`** — API/DB-only work (endpoints, models, migrations, business logic)
- **`full-stack`** — Requires both frontend and backend (split into subtasks, or frontend follows backend)

Transition: `IN_PROGRESS` → `EPICS_EXTRACTED`.

---

## Step 4: Define Acceptance Criteria for All Stories

After epics are extracted, ensure every story has clear, testable acceptance criteria:

- Use **Given-When-Then** format where applicable
- Each story must have at least 2 acceptance criteria
- AC must be verifiable (testable, not subjective)
- Edge cases should be covered (empty states, error states, loading states)

Transition: `EPICS_EXTRACTED` → `ACCEPTANCE_DEFINED`.

---

## Step 5: Estimate Stories

Assign t-shirt size estimates to all stories:

| Size | Effort | Description |
|------|--------|-------------|
| XS | < 1 day | Trivial change, single file |
| S | 1-2 days | Small feature, few files |
| M | 3-5 days | Moderate feature, multiple components |
| L | 1-2 weeks | Large feature, significant scope |
| XL | > 2 weeks | Should be split further |

Transition: `ACCEPTANCE_DEFINED` → `ESTIMATED`.

---

## Step 6: Order Epics by Priority

Present the epics in priority order:

```
Epic Priority Order:

P0 — Critical Path (must be built first)
  Epic 1: {title} ({N} stories)
  Epic 2: {title} ({M} stories)

P1 — Important (build after P0)
  Epic 3: {title} ({K} stories)

P2 — Nice to Have (stretch goals)
  Epic 4: {title} ({J} stories)
```

Order within priority by dependency chain and user value.

Transition: `ESTIMATED` → `ORDERED`.

---

## Step 7: Verify Epics Output

After the epics skill completes, the agent verifies:

- [ ] `{epics_output}` exists with proper frontmatter
- [ ] All PRD features are covered by at least one epic
- [ ] Each story has clear, testable acceptance criteria
- [ ] Each story is tagged with its development track (backend / frontend / full-stack)
- [ ] Dependencies between stories are explicitly marked
- [ ] Each story has a t-shirt size estimate
- [ ] Epics are ordered by priority (P0 → P1 → P2)
- [ ] `sections_complete` in frontmatter lists all completed epics

Present the epics summary:

> "Epics draft complete. {N} epics, {M} stories ({B} backend, {F} frontend, {S} full-stack)."
>
> "Please review. Does this capture all PRD features? [Approve / Revise]"

Transition: `ORDERED` → `VERIFIED`.

---

## Step 8: Requirements Freeze

This is the **REQUIREMENTS FREEZE** gate — a critical project milestone.

Present the user:

> "### Requirements Freeze"
>
> "All {N} epics and {M} stories are approved. From this point forward, **no new features or stories may be added without a formal Change Request (CR)**."
>
> "This means:"
> "- New feature ideas → must go through a CR filed against the PRD (Phase 1)"
> "- Scope changes → must go through a CR"
> "- Priority reordering within approved scope → allowed without CR"
>
> "Do you confirm the Requirements Freeze? [Y] Confirm Freeze [N] Continue Iterating"

When user confirms:

Update epics output frontmatter:

```yaml
status: "approved"
requirements_frozen_at: "{ISO_TIMESTAMP}"
```

Transition: `VERIFIED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
global_state:
  requirements_frozen_at: "{ISO_TIMESTAMP}"
  overall_status: "requirements_frozen"

phases:
  phase_3:
    substates:
      phase_3_6:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "EPICS_EXTRACTED", at: "{ISO}" }
          - { state: "ACCEPTANCE_DEFINED", at: "{ISO}" }
          - { state: "ESTIMATED", at: "{ISO}" }
          - { state: "ORDERED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "epics", path: "{epics_output}", status: "locked" }
        total_epics: {N}
        total_stories: {M}
        story_tags:
          backend: {count}
          frontend: {count}
          full_stack: {count}
        gate_card:
          all_pass: true
```

> "Requirements are now frozen. New features require a CR filed against the PRD (Phase 1). Existing stories within scope can still be refined in Phase 3.7 (Stories)."

---

## Step 9: Completion

Present summary:

> "Phase 3.6 complete — Epics LOCKED, Requirements Frozen."
>
> "**Epics:** {N} epics, {M} stories"
> "**Tracks:** {B} backend, {F} frontend, {S} full-stack"
> "**Artifact:** `{epics_output}`"
>
> "Next: Phase 3.7 — Story Design, where we'll create detailed story files for each story."

Return to the Phase 3 sub-phase menu.
