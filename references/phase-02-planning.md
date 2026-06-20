---
phase: 2
title: "Phase 2 — Planning (PRD + UX Design)"
version: "3.6.0"
description: "Consolidated planning phase merging the old requirements analysis (Phase 1) and UI/UX design (Phase 5) into a single structured planning pipeline. Ten sub-phases build a complete product specification — from business goals through wireframes and design acceptance criteria."
dependencies:
  - sprint-status.yaml
---

# Phase 2 — Planning (PRD + UX Design)

**Phase Goal:** Produce a complete planning baseline — a traceable PRD backed by Impact Mapping, Story Mapping, and Kano+RICE prioritization, followed by a validated UX design package covering user flows, wireframes, and design acceptance criteria. Every requirement in the PRD traces to a business impact; every wireframe page traces to a user story.

**Why Consolidated Planning:** In V2, requirements (Phase 1) and UI/UX (Phase 5) were separated by Architecture (Phase 2), Epics (Phase 3), and Story Design (Phase 4). This created a disconnected planning flow — UX designers had to wait for story design before creating wireframes. V3 consolidates all planning into a single phase: PRD → UX Design → Done. Architecture, Epics, and Story Design move to Phase 3 (Solutioning).

**Duration:** Sequential sub-phases with skip options. Minimum path: 2.1 → 2.4 → 2.5 → 2.6 → 2.7 → 2.10. Full path: all 10 sub-phases.

---

## Phase-Level FSM

```
NOT_STARTED → IN_PROGRESS → ALL_SUB_PHASES_APPROVED → APPROVED → LOCKED
```

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Enter Phase 2 |
| `IN_PROGRESS` | Sub-phases being executed | (sub-phase FSMs) | Sub-phases manage their own states |
| `IN_PROGRESS` | All non-skipped required sub-phases LOCKED | `ALL_SUB_PHASES_APPROVED` | All required sub-phase work complete |
| `ALL_SUB_PHASES_APPROVED` | User approves planning artifacts | `APPROVED` | Planning is final |
| `APPROVED` | Phase 3 consumes it | `LOCKED` | Read-only baseline |
| `LOCKED` | Blocking CR filed | `UNLOCK_RESOLVE` | Needs revision |

**BMAD Planning States (per sub-phase):**
```
NOT_STARTED → DRAFTING → ELABORATING → REVIEWING → FINAL
```

**Requirements Freeze:** Occurs at sub-phase 2.5 (PRD approved). Once 2.5 reaches LOCKED, requirements are frozen. No new features without a formal Change Request. This is the formal requirements baseline that gates all downstream work.

---

## Gate Card

```yaml
gate_card:
  phase: 2
  enters_from: 1
  checks:
    - id: "G2-01"
      description: "Phase 1 is LOCKED or SKIPPED"
      type: "dependency_status"
      source: "{status_global_file}"
      field: "phases.phase_1.status"
      operator: "in"
      expected: ["LOCKED", "SKIPPED"]

    - id: "G2-02"
      description: "User confirms readiness to begin planning"
      type: "user_confirmation"
  all_pass: false
```

**Gate Logic:** Phase 1 must be either LOCKED (research baseline available) or SKIPPED (no research needed). Both are valid entry states. If Phase 1 was run, its research artifacts should be available but are not mandatory prerequisites.

If gate fails:

> "Phase 1 must be complete or skipped before planning can begin. Current Phase 1 status: {status}. Please resolve Phase 1 first."

Abort and return to main menu. If gate passes, set `phase_2: IN_PROGRESS` in `{status_phase_02_file}`.

**On gate pass:** Phase 1 auto-locks if not already locked and not skipped.

---

## Sub-Phase Routing Table

### Part A — Requirements Definition (2.1─2.5)

| Sub-Phase | Methodology | Reference File | Output | Required | BMAD Skill | Origin |
|-----------|------------|---------------|--------|----------|-----------|--------|
| 2.1 | Impact Mapping | `./references/sub-workflows/planning/2-1-impact-mapping.md` | `{impact_map_output}` | **Required** | — | old 1.1 |
| 2.2 | Event Storming | `./references/sub-workflows/planning/2-2-event-storming.md` | `{event_storming_output}` | *Skippable* | — | old 1.2 |
| 2.3 | JTBD | `./references/sub-workflows/planning/2-3-jobs-to-be-done.md` | `{jtbd_cards_output}` | *Skippable* | — | old 1.3 |
| 2.4 | Story Mapping | `./references/sub-workflows/planning/2-4-story-mapping.md` | `{story_map_output}` | **Required** | — | old 1.4 |
| 2.5 | Kano + RICE + PRD | `./references/sub-workflows/planning/2-5-prioritization-spec.md` | `{prioritization_output}` + `{prd_output}` | **Required** | `/bmad-create-prd` | old 1.5 |

### Part B — UX Design (2.6─2.10)

| Sub-Phase | Methodology | Reference File | Output | Required | BMAD Skill | Origin |
|-----------|------------|---------------|--------|----------|-----------|--------|
| 2.6 | User Flows & IA | `./references/sub-workflows/planning/2-6-user-flows.md` | `{user_flows_output}` + `{sitemap_output}` | **Required** | `/bmad-create-ux-design`* | old 5.1 |
| 2.7 | Wireframes | `./references/sub-workflows/planning/2-7-wireframes.md` | `{wireframes_output}` | **Required** | `/bmad-create-ux-design`* | old 5.2 |
| 2.8 | Design System | `./references/sub-workflows/planning/2-8-design-system.md` | `{design_tokens_output}` + `{component_specs_output}` | *Skippable* | — | old 5.3 |
| 2.9 | Interaction Design | `./references/sub-workflows/planning/2-9-interaction-design.md` | `{interaction_spec_output}` | *Skippable* | — | old 5.4 |
| 2.10 | Design Acceptance | `./references/sub-workflows/planning/2-10-design-acceptance.md` | `{design_acceptance_output}` | **Required** | — | old 5.5 |

\* `/bmad-create-ux-design` is invoked **once** and spans sub-phases 2.6 (User Flows) and 2.7 (Wireframes). The BMAD skill produces the combined UX design output.

**Recommended Paths:**
- **Simple projects** (CRUD apps, well-understood domains, existing design system): 2.1 → 2.4 → 2.5 → 2.6 → 2.7 → 2.10 (skip 2.2, 2.3, 2.8, 2.9)
- **Consumer-facing apps**: 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.9 → 2.10 (skip 2.8 if using an existing design system)
- **Greenfield with new design language**: Full 2.1 through 2.10

**Minimum Viable Path:** 2.1 → 2.4 → 2.5 → 2.6 → 2.7 → 2.10

**Requirements Freeze at 2.5:** Once sub-phase 2.5 (PRD) is LOCKED, `global_state.requirements_frozen_at` is set in sprint-status.yaml. 2.6─2.10 (UX design) proceed with frozen requirements. No new features may be introduced without a formal Change Request beyond this point.

---

## Phase 2 Entry

### Step 1: Gate Card Check and Initialization

Evaluate all G2 checks. Record results to `{status_phase_02_file}`.

If gate passes, initialize phase state:

```yaml
phases:
  phase_2:
    status: "IN_PROGRESS"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "IN_PROGRESS", at: "{ISO}" }
    gate_card:
      phase: 2
      checks:
        - {id: "G2-01", status: "pass"}
        - {id: "G2-02", status: "pass"}
      all_pass: true
    substates:
      phase_2_1:  { status: "NOT_STARTED" }
      phase_2_2:  { status: "NOT_STARTED" }
      phase_2_3:  { status: "NOT_STARTED" }
      phase_2_4:  { status: "NOT_STARTED" }
      phase_2_5:  { status: "NOT_STARTED" }
      phase_2_6:  { status: "NOT_STARTED" }
      phase_2_7:  { status: "NOT_STARTED" }
      phase_2_8:  { status: "NOT_STARTED" }
      phase_2_9:  { status: "NOT_STARTED" }
      phase_2_10: { status: "NOT_STARTED" }
```

---

### Step 2: Present Sub-Phase Menu

Present the Phase 2 sub-phase menu:

```
Phase 2 — Planning (PRD + UX Design)
═══════════════════════════════════════════
Requirements Freeze: {frozen|not yet — freezes at 2.5}

── PART A: Requirements Definition ──
  2.1 Impact Mapping          [{status}] {output}
  2.2 Event Storming          [{status}] {output} [skippable]
  2.3 Jobs to Be Done         [{status}] {output} [skippable]
  2.4 Story Mapping           [{status}] {output}
  2.5 Kano + RICE + PRD       [{status}] {output} ★ REQUIREMENTS FREEZE

── PART B: UX Design ──
  2.6 User Flows & IA         [{status}] {output}
  2.7 Wireframes              [{status}] {output}
  2.8 Design System           [{status}] {output} [skippable]
  2.9 Interaction Design      [{status}] {output} [skippable]
  2.10 Design Acceptance      [{status}] {output}

Recommended order: 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8 → 2.9 → 2.10
Minimum path: 2.1 → 2.4 → 2.5 → 2.6 → 2.7 → 2.10

Available Actions:
  [1] Start 2.1 — Impact Mapping
  [2] Start 2.2 — Event Storming
  [3] Start 2.3 — Jobs to Be Done
  [4] Start 2.4 — Story Mapping
  [5] Start 2.5 — Kano + RICE + PRD
  [6] Start 2.6 — User Flows & Information Architecture
  [7] Start 2.7 — Wireframes
  [8] Start 2.8 — Design System Specification
  [9] Start 2.9 — Interaction Design & State Matrix
  [10] Start 2.10 — Design Acceptance Criteria
  [S] View sub-phase status
  [Q] Return to main menu
```

**Selection Rules:**
- Sub-phases marked as `LOCKED` or `SKIPPED` show `[LOCKED]` or `[SKIPPED]` and are not selectable
- 2.4 requires 2.1 to be LOCKED before it can start (impact map feeds story mapping)
- 2.5 requires 2.4 to be LOCKED before it can start (story map feeds PRD)
- 2.2 and 2.3 are skippable — present skip prompt on entry, no dependency on 2.1
- 2.6 requires 2.5 to be LOCKED before it can start (PRD feeds UX design)
- 2.7 requires 2.6 to be LOCKED before it can start (user flows feed wireframes)
- 2.8 and 2.9 require 2.7 to be LOCKED before they can start (skippable)
- 2.10 requires 2.7 to be LOCKED before it can start (design acceptance gates UX)
- Show completed count: "X of Y required sub-phases complete"
- When 2.5 reaches LOCKED, display: "★ REQUIREMENTS NOW FROZEN ★"

---

### Step 3: Route to Selected Sub-Phase

When the user selects a sub-phase:

1. **Load the sub-workflow file** from the reference path in the routing table
2. **Read the entire file** before taking any action
3. **For sub-phases 2.2, 2.3, 2.8, and 2.9:** Present the skip prompt first (defined in the sub-workflow file)
4. **For 2.5 (PRD):** Invoke `/bmad-create-prd` — pass the Impact Map, Story Map, Kano classification, and RICE scores
5. **For 2.6─2.7 (UX Design):** Invoke `/bmad-create-ux-design` once — the skill spans both sub-phases. When 2.6 completes with LOCKED, the UX design artifact feeds directly into 2.7.
6. **Follow the sub-workflow's instructions** exactly as written
7. **After completion**, write to `{status_phase_02_file}` and return to the Phase 2 sub-phase menu

**CRITICAL:** Do not load more than one sub-workflow file at a time. Only the selected sub-phase file is read and executed.

**BMAD UX Design Invocation (2.6─2.7):**
- `/bmad-create-ux-design` is invoked after 2.6 (User Flows) entry
- The BMAD skill produces user flows, information architecture, and wireframe guidance
- 2.6 captures the user flows and IA; 2.7 captures the wireframes
- Both share the same BMAD skill session context

---

### Step 4: Requirements Freeze at 2.5

When sub-phase 2.5 (PRD) reaches LOCKED, execute the Requirements Freeze:

1. Set `global_state.requirements_frozen_at` to the current ISO timestamp
2. Update `{status_global_file}` (requirements_frozen_at) and `{status_phase_02_file}`:

```yaml
global_state:
  requirements_frozen_at: "{ISO_TIMESTAMP}"
  requirements_frozen: true
```

3. Display freeze notice:

> "★ REQUIREMENTS FROZEN ★"
>
> "The PRD at `{prd_output}` is now the immutable requirements baseline. No new features may be introduced without a formal Change Request. UX sub-phases (2.6─2.10) will proceed with frozen requirements."
>
> "Any requirement changes discovered during UX design must be filed as blocking Change Requests."

---

### Step 5: Track Phase Completion

After each sub-phase completes (or is skipped), check the Phase 2 completion condition:

**All non-skipped required sub-phases must be LOCKED.** Required sub-phases: 2.1, 2.4, 2.5, 2.6, 2.7, 2.10.

When this condition is met:

1. Transition Phase 2 to `ALL_SUB_PHASES_APPROVED`
2. Show completion summary:

```
═══════════════════════════════════════════
Phase 2 — All Sub-Phases Complete
═══════════════════════════════════════════

── Requirements ──
  2.1 Impact Map:           {impact_map_output}        [LOCKED]
  2.2 Event Storming:       {status_2_2}
  2.3 JTBD Cards:           {status_2_3}
  2.4 Story Map:            {story_map_output}          [LOCKED]
  2.5 Kano + RICE + PRD:    {prd_output}                [LOCKED] ★ FROZEN

── UX Design ──
  2.6 User Flows & IA:      {user_flows_output}         [LOCKED]
  2.7 Wireframes:           {wireframes_output}         [LOCKED]
  2.8 Design System:        {status_2_8}
  2.9 Interaction Design:   {status_2_9}
  2.10 Design Acceptance:   {design_acceptance_output}   [LOCKED]

Traceability Chain:
  Business Goal → Actors → Impacts → Deliverables
      → User Jobs → Dimensions
      → Stories → Release Slices
      → Kano + RICE Priorities → PRD (FROZEN)
      → User Flows → Wireframes
      → Design Acceptance Criteria

Available Actions:
  [1] Review & Approve Planning Package — Transition to APPROVED
  [2] Revise specific sub-phase — Return to sub-phase menu
  [S] View full status details
```

---

## Step 6: Phase 2 Approval

When the user is ready to approve Phase 2:

> "The Planning package is complete:"
> "- PRD at `{prd_output}` (requirements frozen)"
> "- UX Design at `{user_flows_output}`, `{wireframes_output}`"
> "- Design acceptance criteria at `{design_acceptance_output}`"
>
> "Do you approve Phase 2 — Planning and freeze all planning artifacts?"
>
> "[Y] Approve and lock  [N] Continue revising"

On approval:
- Transition Phase 2: `ALL_SUB_PHASES_APPROVED` → `APPROVED`
- Update PRD frontmatter: `status: "approved"`, `approved_at: "{ISO_TIMESTAMP}"`
- Update UX design artifact frontmatters: `status: "approved"`

---

## Step 7: Auto-Lock on Phase 3 Start

When Phase 3 (Solutioning) is entered, Phase 2 automatically transitions to LOCKED. This creates a read-only planning baseline that downstream phases depend on.

---

## Step 8: Phase Complete Record

Write to `{status_phase_02_file}` when Phase 2 reaches LOCKED:

```yaml
phases:
  phase_2:
    status: "LOCKED"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "IN_PROGRESS", at: "{ISO}" }
      - { state: "ALL_SUB_PHASES_APPROVED", at: "{ISO}" }
      - { state: "APPROVED", at: "{ISO}" }
      - { state: "LOCKED", at: "{ISO}", by: "phase_3_start" }
    artifacts:
      - { type: "impact_map", path: "{impact_map_output}", status: "locked" }
      - { type: "story_map", path: "{story_map_output}", status: "locked" }
      - { type: "prioritization", path: "{prioritization_output}", status: "locked" }
      - { type: "prd", path: "{prd_output}", status: "locked" }
      - { type: "user_flows", path: "{user_flows_output}", status: "locked" }
      - { type: "sitemap", path: "{sitemap_output}", status: "locked" }
      - { type: "wireframes", path: "{wireframes_output}", status: "locked" }
      - { type: "design_acceptance", path: "{design_acceptance_output}", status: "locked" }
    gate_card:
      all_pass: true
    substates:
      phase_2_1:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "MAP_DRAFTED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "impact_map", path: "{impact_map_output}", status: "locked" }
        gate_card:
          all_pass: true
      phase_2_2:
        status: "{LOCKED|SKIPPED}"
      phase_2_3:
        status: "{LOCKED|SKIPPED}"
      phase_2_4:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "BACKBONE_BUILT", at: "{ISO}" }
          - { state: "STORIES_MAPPED", at: "{ISO}" }
          - { state: "RELEASES_SLICED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "story_map", path: "{story_map_output}", status: "locked" }
        gate_card:
          all_pass: true
      phase_2_5:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "FEATURES_CLASSIFIED", at: "{ISO}" }
          - { state: "PRIORITIZED", at: "{ISO}" }
          - { state: "PRD_DRAFTED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "prioritization", path: "{prioritization_output}", status: "locked" }
          - { type: "prd", path: "{prd_output}", status: "locked" }
        gate_card:
          all_pass: true
        bmad_state: "FINAL"
      phase_2_6:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "FLOWS_MAPPED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "user_flows", path: "{user_flows_output}", status: "locked" }
          - { type: "sitemap", path: "{sitemap_output}", status: "locked" }
        gate_card:
          all_pass: true
      phase_2_7:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "WIREFRAMES_CREATED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "wireframes", path: "{wireframes_output}", status: "locked" }
        gate_card:
          all_pass: true
      phase_2_8:
        status: "{LOCKED|SKIPPED}"
      phase_2_9:
        status: "{LOCKED|SKIPPED}"
      phase_2_10:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "DESIGN_REVIEWED", at: "{ISO}" }
          - { state: "APPROVED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "design_acceptance", path: "{design_acceptance_output}", status: "locked" }
        gate_card:
          all_pass: true
```

---

## Skip Mechanism

Sub-phases 2.2 (Event Storming), 2.3 (JTBD), 2.8 (Design System), and 2.9 (Interaction Design) can be skipped.

### Per-Sub-Phase Skip Flow

1. User selects skippable sub-phase from the menu
2. The sub-workflow file presents the skip prompt
3. If skipped: status set to `SKIPPED` in `{status_phase_02_file}`
4. Skipped sub-phases are excluded from Phase 2 completion requirements
5. Sub-phase menu shows `[SKIPPED]` for skipped sub-phases

### Skip Guidance

| Sub-Phase | Skip If | Run If |
|-----------|---------|--------|
| 2.2 Event Storming | CRUD apps, well-known domains | Complex/new domains, event-driven systems |
| 2.3 JTBD | Well-understood users | New audience, B2B products, platform tools |
| 2.8 Design System | Existing design system (MUI, shadcn, Tailwind UI) | Greenfield projects, custom brand |
| 2.9 Interaction Design | Standard CRUD patterns, simple forms | Dashboards, complex workflows, real-time UI |

---

## Completion Summary

When Phase 2 is locked, present:

> "Phase 2 complete — Planning baseline established."
>
> "**Requirements:**"
> "- Impact Mapping (2.1): SMART goal → {N} actors → {M} impacts → {K} deliverables"
> "- Event Storming (2.2): {status}" (or "Skipped")
> "- JTBD (2.3): {status}" (or "Skipped")
> "- Story Mapping (2.4): {A} activities → {R} release slices"
> "- Kano + RICE + PRD (2.5): {N} features classified, {M} prioritized ★ FROZEN"
>
> "**UX Design:**"
> "- User Flows (2.6): {P} user flows, {K} pages in IA"
> "- Wireframes (2.7): {W} pages wireframed"
> "- Design System (2.8): {status}" (or "Skipped")
> "- Interaction Design (2.9): {status}" (or "Skipped")
> "- Design Acceptance (2.10): {C} acceptance criteria compiled"
>
> "**Artifacts:** [list of all locked planning artifacts with paths]"
>
> "**Traceability:** Every PRD requirement traces to a business impact. Every wireframe traces to a user story. Requirements frozen — all future changes require a Change Request."
>
> "Ready for Phase 3: Solutioning."

Return to the main workflow menu.
