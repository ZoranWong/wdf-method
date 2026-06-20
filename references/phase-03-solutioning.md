---
phase: 3
title: "Phase 3 — Solutioning (Architecture + Epics + Stories + API + Readiness)"
version: "3.6.0"
description: "Consolidated solution design phase merging the old Architecture (Phase 2), Epics (Phase 3), Stories (Phase 4), and API Design (Phase 6) into a single technical solutioning pipeline. Nine sub-phases produce a complete technical specification — from C4 architecture through API contracts, with formal development order freeze."
dependencies:
  - sprint-status.yaml
  - prd.md
  - planning artifacts (Phase 2 locked)
---

# Phase 3 — Solutioning (Architecture + Epics + Stories + API + Readiness)

**Phase Goal:** Produce a complete, validated technical specification — architecture decisions (C4 Levels 1-3), epics and stories, API contracts, database schema, and a readiness assessment — all from the frozen planning baseline. Every story traces to an epic; every API endpoint traces to a story; every architecture decision traces to a quality requirement.

**Why Consolidated Solutioning:** In V2, Architecture (Phase 2), Epics (Phase 3), Stories (Phase 4), and API Design (Phase 6) were separated by UI/UX Design (Phase 5). This required jumping back and forth between technical and design concerns. V3 consolidates all technical solution design into one phase: C4 Architecture → Epics → Stories → API & Data → Readiness. Planning (Phase 2) already produced the UX design baseline, so solutioning can work with complete requirements.

**Duration:** Sequential sub-phases. 3.4 (Quality Attributes) is skippable. Minimum path: 3.1 → 3.2 → 3.3 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9 (skip 3.4).

---

## Phase-Level FSM

```
NOT_STARTED → IN_PROGRESS → ALL_SUB_PHASES_APPROVED → SOLUTIONING_COMPLETE → APPROVED → LOCKED
```

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Enter Phase 3 |
| `IN_PROGRESS` | All non-skipped required sub-phases LOCKED/story-frozen | `ALL_SUB_PHASES_APPROVED` | Sub-phases complete |
| `ALL_SUB_PHASES_APPROVED` | User approves solutioning package | `APPROVED` | Solution baseline is final |
| `APPROVED` | Phase 4 consumes it | `LOCKED` | Read-only baseline |
| `LOCKED` | Blocking CR filed | `UNLOCK_RESOLVE` | Needs revision |

**BMAD Solutioning States (per sub-phase):**
```
NOT_STARTED → DESIGNING → ANALYZING → VALIDATING → LOCKED
```

**Development Order Freeze:** Occurs at sub-phase 3.7 (stories finalized). Once stories are locked, the development order is frozen. This defines the sequence that Phase 4 implementation must follow. No re-ordering without a formal Change Request.

---

## Gate Card

```yaml
gate_card:
  phase: 3
  enters_from: 2
  checks:
    - id: "G3-01"
      description: "Phase 2 (Planning) is LOCKED"
      type: "dependency_status"
      source: "{status_global_file}"
      field: "phases.phase_2.status"
      operator: "eq"
      expected: "LOCKED"

    - id: "G3-02"
      description: "PRD exists and is approved"
      type: "artifact_metadata"
      source: "{prd_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]

    - id: "G3-03"
      description: "Requirements are frozen"
      type: "dependency_status"
      source: "{status_global_file}"
      field: "global_state.requirements_frozen_at"
      operator: "not_null"

    - id: "G3-04"
      description: "Wireframes and design acceptance are locked"
      type: "dependency_status"
      source: "{status_global_file}"
      field: "phases.phase_2.substates.phase_2_10.status"
      operator: "eq"
      expected: "LOCKED"

    - id: "G3-05"
      description: "User confirms readiness for technical solutioning"
      type: "user_confirmation"

    - id: "G3-06"
      description: "Code standards source is declared (V3.1)"
      type: "dependency_status"
      source: "{status_global_file}"
      field: "global_state.code_standards_source"
      operator: "not_empty"
      severity: "blocking"
  all_pass: false
```

**Gate Logic:** Phase 2 must be fully LOCKED, the PRD must be approved, requirements must be frozen, UX design acceptance (2.10) must be complete, and a code standards source must be declared. This ensures solutioning works from a complete, stable planning baseline with agreed-upon coding standards.

If gate fails:

> "Phase 2 (Planning) must be LOCKED with an approved PRD, frozen requirements, completed UX design, and declared code standards. Current status:"
> "- Phase 2: {phase_2_status}"
> "- PRD: {prd_status}"
> "- Requirements frozen: {frozen_status}"
> "- 2.10 Design Acceptance: {design_acc_status}"
> "- Code Standards: {code_standards_status}"
>
> "Please complete Phase 2 and declare code standards first."

Abort and return to main menu.

**On gate pass:** Phase 2 auto-locks if not already locked. Transition `NOT_STARTED` → `IN_PROGRESS`.

---

## Sub-Phase Routing Table

### Part A — Architecture Definition (3.1─3.5)

| Sub-Phase | Methodology | Reference File | Output | Required | BMAD Skill |
|-----------|------------|---------------|--------|----------|-----------|
| 3.1 | System Context (C4 L1) | `./references/sub-workflows/solutioning/3-1-system-context.md` | `{architecture_output}/system-context.md` | **Required** | — |
| 3.2 | Architecture Style | `./references/sub-workflows/solutioning/3-2-architecture-style.md` | `{architecture_output}/architecture-style.md` + ADR-001 | **Required** | — |
| 3.3 | Container Design (C4 L2) | `./references/sub-workflows/solutioning/3-3-container-design.md` | `{architecture_output}/container-design.md` + ADR-002~* | **Required** | `/bmad-create-architecture`* |
| 3.4 | Quality Attributes | `./references/sub-workflows/solutioning/3-4-quality-attributes.md` | `{architecture_output}/quality-attributes.md` | *Skippable* | — |
| 3.5 | Component Synthesis (C4 L3) | `./references/sub-workflows/solutioning/3-5-component-synthesis.md` | `{architecture_output}/component-design.md` + `{architecture_output}` | **Required** | `/bmad-create-architecture`* |

\* `/bmad-create-architecture` is invoked **once** and spans sub-phases 3.3 (Container Design) and 3.5 (Component Synthesis). The BMAD skill produces the full C4 architecture artifact.

### Part B — Development Blueprint (3.6─3.9)

| Sub-Phase | Methodology | Reference File | Output | Required | BMAD Skill |
|-----------|------------|---------------|--------|----------|-----------|
| 3.6 | Epics & Feature Plan | `./references/sub-workflows/solutioning/3-6-epics.md` | `{epics_output}` | **Required** | `/bmad-create-epics-and-stories` |
| 3.7 | Story Design + Freeze | `./references/sub-workflows/solutioning/3-7-stories.md` | `{stories_output}/` | **Required** | `/bmad-create-story` |
| 3.8 | API & Data Design | `./references/sub-workflows/solutioning/3-8-api-design.md` | `{api_spec_output}` + `{db_schema_output}` | **Required** | — |
| 3.9 | Readiness Check | `./references/sub-workflows/solutioning/3-9-readiness-check.md` | `{architecture_output}/readiness-check.md` | **Required** | `/bmad-check-implementation-readiness` |

**Recommended Paths:**
- **Simple projects** (monolithic apps, well-known patterns): 3.1 → 3.2 → 3.3 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9 (skip 3.4)
- **Complex systems, high-stakes projects**: Full 3.1 through 3.9

**Minimum Viable Path:** 3.1 → 3.2 → 3.3 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9

**Development Order Freeze at 3.7:** Once sub-phase 3.7 (Story Design) is LOCKED, `global_state.development_order_frozen_at` is set. The story implementation sequence is immutable beyond this point.

**Sub-Phase Dependencies:**

```
3.1 (System Context)
  └─→ 3.2 (Architecture Style) — gate: 3.1 LOCKED
        └─→ 3.3 (Container Design) — gate: 3.2 LOCKED
              ├─→ 3.4 (Quality Attributes) — gate: 3.3 LOCKED [skippable]
              └─→ 3.5 (Component Synthesis) — gate: 3.3 LOCKED [+ 3.4 LOCKED if not skipped]
                    └─→ 3.6 (Epics & Feature Plan) — gate: 3.5 LOCKED
                          └─→ 3.7 (Story Design) — gate: 3.6 LOCKED ★ DEV ORDER FREEZE
                                └─→ 3.8 (API & Data Design) — gate: 3.7 LOCKED
                                      └─→ 3.9 (Readiness Check) — gate: 3.8 LOCKED
```

---

## Phase 3 Entry

### Step 1: Gate Card Check and Initialization

Evaluate all G3 checks. Record results to `{status_phase_03_file}`.

If gate passes, initialize phase state:

```yaml
phases:
  phase_3:
    status: "IN_PROGRESS"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "IN_PROGRESS", at: "{ISO}" }
    gate_card:
      phase: 3
      checks:
        - {id: "G3-01", status: "pass"}
        - {id: "G3-02", status: "pass"}
        - {id: "G3-03", status: "pass"}
        - {id: "G3-04", status: "pass"}
        - {id: "G3-05", status: "pass"}
      all_pass: true
    substates:
      phase_3_1: { status: "NOT_STARTED" }
      phase_3_2: { status: "NOT_STARTED" }
      phase_3_3: { status: "NOT_STARTED" }
      phase_3_4: { status: "NOT_STARTED" }
      phase_3_5: { status: "NOT_STARTED" }
      phase_3_6: { status: "NOT_STARTED" }
      phase_3_7: { status: "NOT_STARTED", stories: [] }
      phase_3_8: { status: "NOT_STARTED" }
      phase_3_9: { status: "NOT_STARTED" }
```

---

### Step 2: Present Sub-Phase Menu

Present the Phase 3 sub-phase menu:

```
Phase 3 — Solutioning
═══════════════════════════════════════════
Dev Order: {frozen|not yet — freezes at 3.7}
Dev Mode:  {separated|full_stack} (set in 3.2 Architecture Style)

── PART A: Architecture Definition ──
  3.1 System Context (C4 L1)     [{status}] {output}
  3.2 Architecture Style         [{status}] {output} ★ sets dev_mode
  3.3 Container Design (C4 L2)   [{status}] {output}
  3.4 Quality Attributes         [{status}] {output} [skippable]
  3.5 Component Synthesis (C4 L3) [{status}] {output}

── PART B: Development Blueprint ──
  3.6 Epics & Feature Plan       [{status}] {output}
  3.7 Story Design + Freeze      [{status}] {output} ★ DEV ORDER FREEZE
  3.8 API & Data Design          [{status}] {output}
  3.9 Readiness Check            [{status}] {output}

Recommended order: 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9
Minimum path: 3.1 → 3.2 → 3.3 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9

Available Actions:
  [1] Start 3.1 — System Context (C4 Level 1)
  [2] Start 3.2 — Architecture Style Decision
  [3] Start 3.3 — Container Design (C4 Level 2)
  [4] Start 3.4 — Quality Attributes (ATAM-lite)
  [5] Start 3.5 — Component Synthesis (C4 Level 3 + 4+1 Views)
  [6] Start 3.6 — Epics & Feature Plan
  [7] Start 3.7 — Story Design
  [8] Start 3.8 — API & Data Design
  [9] Start 3.9 — Readiness Check
  [S] View sub-phase status
  [Q] Return to main menu
```

**Selection Rules:**
- Sub-phases marked as `LOCKED` or `SKIPPED` show `[LOCKED]` or `[SKIPPED]` and are not selectable
- Each sub-phase requires its immediate predecessor to be LOCKED (see dependency diagram)
- 3.2 (Architecture Style) sets `global_state.dev_mode` — `separated` or `full_stack` — which determines Phase 4 routing
- 3.4 is skippable — present skip prompt on entry
- 3.5 can start if 3.3 is LOCKED regardless of 3.4 status
- Show completed count: "X of Y required sub-phases complete"
- When 3.7 reaches LOCKED, display: "★ DEVELOPMENT ORDER FROZEN ★"

---

### Step 3: Route to Selected Sub-Phase

When the orchestrator enters a sub-phase:

1. **Load the prompt template** from `references/prompt-templates/phase-03-prompts.md` for the selected sub-phase
2. **Dispatch a sub-agent** with the template's clean_context and prompt_template
3. **For sub-phase 3.4 (Quality Attributes):** Skip if `auto_run.auto_skip.phase_3_4 = "skip"` or project is non-critical
4. **For 3.3─3.5 (Architecture):** Invoke `/bmad-create-architecture` once — the BMAD skill spans container design and component synthesis. Pass the PRD, tech stack preferences, and UX design artifacts.
5. **For 3.6 (Epics):** Invoke `/bmad-create-epics-and-stories` — pass the architecture, PRD, story map, and prioritization.
6. **For 3.7 (Stories):** Invoke `/bmad-create-story` for each story in the epic breakdown. Individual stories include `parallel_safe`, `scope_write`, and `acceptance_check` attributes.
7. **For 3.9 (Readiness):** Invoke `/bmad-check-implementation-readiness` — pass the full solutioning baseline.
8. **After completion**, write to `{status_phase_03_file}` and proceed to the next sub-phase

**CRITICAL (Thin Orchestrator):** The orchestrator reads prompt templates and artifact frontmatter (metadata), but not sub-workflow body content. It dispatches sub-agents with clean context and waits for results. Sub-agent context is NEVER propagated back.

**BMAD Architecture Invocation (3.3─3.5):**
- `/bmad-create-architecture` is invoked at 3.3 entry
- The BMAD skill produces the full C4 architecture with 4+1 views
- 3.3 captures Container Design (C4 L2) and architecture ADRs
- 3.5 captures Component Synthesis (C4 L3) and the final `architecture.md`
- 3.2 (Architecture Style) does NOT use the BMAD skill — it is a structured decision workshop

**Dev Mode Setting (3.2):**
Sub-phase 3.2 (Architecture Style) determines `global_state.dev_mode`:
- `separated` — Separate backend/frontend repos (React + Express, Vue + Nest, etc.) → Phase 4 runs dual-track
- `full_stack` — Unified framework (Next.js, Nuxt, Remix, SvelteKit) → Phase 4 runs merged track

This setting is recorded in sprint-status.yaml and controls Phase 4 routing.

---

### Step 4: Development Order Freeze at 3.7

When sub-phase 3.7 (Story Design) reaches LOCKED, execute the Development Order Freeze:

1. Set `global_state.development_order_frozen_at` to the current ISO timestamp
2. The `development_order` array (set in 3.6/3.7) contains all stories with their sequence, `parallel_safe`, `track` (for separated mode), and `depends_on`
3. Update `{status_global_file}` (development_order_frozen_at + development_order) and `{status_phase_03_file}`:

```yaml
global_state:
  development_order_frozen_at: "{ISO_TIMESTAMP}"
  development_order:
    - id: "S-001"
      title: "User Registration"
      track: "backend"
      parallel_safe: false
      depends_on: []
      order: 1
    - id: "S-002"
      title: "User Registration UI"
      track: "frontend"
      parallel_safe: true
      depends_on: ["S-001"]
      order: 2
    # ... all stories
```

4. Display freeze notice:

> "★ DEVELOPMENT ORDER FROZEN ★"
>
> "{N} stories are now sequenced and frozen. The implementation order is:"
> "{ordered story list}"
>
> "No re-ordering, insertion, or story modification without a formal Change Request. Sub-phases 3.8 (API & Data) and 3.9 (Readiness) complete the solutioning baseline."

---

### Step 5: Track Phase Completion

After each sub-phase completes (or is skipped), check the Phase 3 completion condition:

**All non-skipped required sub-phases must have reached their completion state.** Required sub-phases: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9.

When this condition is met:

1. Transition Phase 3 to `ALL_SUB_PHASES_APPROVED`
2. Show completion summary:

```
═══════════════════════════════════════════
Phase 3 — All Sub-Phases Complete
═══════════════════════════════════════════

── Architecture ──
  3.1 System Context:        {system_context_output}    [LOCKED]
  3.2 Architecture Style:    {architecture_style_output} [LOCKED]
       Dev Mode:             {separated|full_stack}
  3.3 Container Design:      {container_design_output}   [LOCKED]
  3.4 Quality Attributes:    {status_3_4}
  3.5 Component Synthesis:   {component_design_output}   [LOCKED]
       Architecture:         {architecture_output}        [LOCKED]

── Development Blueprint ──
  3.6 Epics:                 {epics_output}              [LOCKED]
  3.7 Stories:               {N} stories designed        [LOCKED] ★ FROZEN
       Development Order:    {N} items sequenced
  3.8 API & Data:            {api_spec} + {db_schema}    [LOCKED]
  3.9 Readiness:             {readiness_check_output}    [LOCKED]

Traceability Chain:
  PRD → Epics → Stories → API Endpoints
       Architecture (C4 L1→L2→L3) → Quality Attributes
       Stories → Development Order → Implementation Readiness
  Dev Mode: {separated|full_stack} → Phase 4 routing

Available Actions:
  [1] Review & Approve Solution Baseline — Transition to APPROVED
  [2] Revise specific sub-phase — Return to sub-phase menu
  [S] View full status details
```

---

## Step 6: Phase 3 Approval

When the user is ready to approve Phase 3:

> "The Solutioning baseline is complete:"
> "- Architecture: `{architecture_output}` (C4 L1-L3, ADR-001 through ADR-{N})"
> "- Epics: `{epics_output}` ({E} epics)"
> "- Stories: {S} stories in `{stories_output}/` (development order frozen)"
> "- API Spec: `{api_spec_output}` ({E} endpoints)"
> "- Database Schema: `{db_schema_output}`"
> "- Readiness: `{readiness_check_output}` (all gates passed)"
>
> "Dev Mode: {separated|full_stack} — Phase 4 routing will follow this mode."
>
> "Do you approve Phase 3 — Solutioning?"
>
> "[Y] Approve and lock  [N] Continue revising"

On approval:
- Transition Phase 3: `ALL_SUB_PHASES_APPROVED` → `APPROVED`
- Update all artifact frontmatters: `status: "approved"`, `approved_at: "{ISO_TIMESTAMP}"`

---

## Step 7: Auto-Lock on Phase 4 Start

When Phase 4 (Implementation) is entered, Phase 3 automatically transitions to LOCKED. This creates a read-only solutioning baseline that implementation depends on.

---

## Step 8: Phase Complete Record

Write to `{status_phase_03_file}` when Phase 3 reaches LOCKED:

```yaml
phases:
  phase_3:
    status: "LOCKED"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "IN_PROGRESS", at: "{ISO}" }
      - { state: "ALL_SUB_PHASES_APPROVED", at: "{ISO}" }
      - { state: "APPROVED", at: "{ISO}" }
      - { state: "LOCKED", at: "{ISO}", by: "phase_4_start" }
    artifacts:
      - { type: "system_context", path: "{architecture_output}/system-context.md", status: "locked" }
      - { type: "architecture_style", path: "{architecture_output}/architecture-style.md", status: "locked" }
      - { type: "container_design", path: "{architecture_output}/container-design.md", status: "locked" }
      - { type: "component_design", path: "{architecture_output}/component-design.md", status: "locked" }
      - { type: "architecture", path: "{architecture_output}", status: "locked" }
      - { type: "epics", path: "{epics_output}", status: "locked" }
      - { type: "stories", path: "{stories_output}/", status: "locked" }
      - { type: "api_spec", path: "{api_spec_output}", status: "locked" }
      - { type: "db_schema", path: "{db_schema_output}", status: "locked" }
      - { type: "readiness_check", path: "{architecture_output}/readiness-check.md", status: "locked" }
    gate_card:
      all_pass: true
    substates:
      phase_3_1:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "CONTEXT_MAPPED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "system_context", path: "{architecture_output}/system-context.md", status: "locked" }
        gate_card:
          all_pass: true
        bmad_state: "LOCKED"
      phase_3_2:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "STYLE_SELECTED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "architecture_style", path: "{architecture_output}/architecture-style.md", status: "locked" }
          - { type: "adr", path: "{architecture_output}/adr-001-architecture-style.md", status: "locked" }
        dev_mode: "{separated|full_stack}"
        gate_card:
          all_pass: true
        bmad_state: "LOCKED"
      phase_3_3:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "CONTAINERS_DESIGNED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "container_design", path: "{architecture_output}/container-design.md", status: "locked" }
          - { type: "adr", path: "{architecture_output}/adr-002-*.md", status: "locked" }
        gate_card:
          all_pass: true
        bmad_state: "LOCKED"
      phase_3_4:
        status: "{LOCKED|SKIPPED}"
        bmad_state: "{LOCKED|n/a}"
      phase_3_5:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "COMPONENTS_MAPPED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "component_design", path: "{architecture_output}/component-design.md", status: "locked" }
          - { type: "architecture", path: "{architecture_output}", status: "locked" }
        gate_card:
          all_pass: true
        bmad_state: "LOCKED"
      phase_3_6:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "EPICS_DEFINED", at: "{ISO}" }
          - { state: "FEATURES_PLANNED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "epics", path: "{epics_output}", status: "locked" }
        gate_card:
          all_pass: true
        bmad_state: "LOCKED"
      phase_3_7:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "STORIES_DESIGNED", at: "{ISO}" }
          - { state: "DEVELOPMENT_ORDER_FROZEN", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "stories", path: "{stories_output}/", story_count: "{N}", status: "locked" }
        gate_card:
          all_pass: true
        bmad_state: "LOCKED"
      phase_3_8:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "API_SPEC_DEFINED", at: "{ISO}" }
          - { state: "DB_SCHEMA_DEFINED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "api_spec", path: "{api_spec_output}", status: "locked" }
          - { type: "db_schema", path: "{db_schema_output}", status: "locked" }
        gate_card:
          all_pass: true
        bmad_state: "LOCKED"
      phase_3_9:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "READINESS_EVALUATED", at: "{ISO}" }
          - { state: "ALL_GATES_PASSED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "readiness_check", path: "{architecture_output}/readiness-check.md", status: "locked" }
        gate_card:
          all_pass: true
        bmad_state: "LOCKED"
```

---

## Skip Mechanism

Sub-phase 3.4 (Quality Attributes / ATAM-lite) is the only skippable sub-phase in Phase 3.

### Skip Flow for 3.4

When the orchestrator reaches 3.4:

> "3.4 — Quality Attributes (ATAM-lite) evaluates the architecture against quality scenarios: performance, security, availability, scalability, and maintainability."
>
> "**Skip if:** Simple CRUD app, internal tool, prototype, or if quality risks are well-understood."
> "**Run if:** Consumer-facing app, high-traffic system, strict performance/SLA requirements, regulated domain."
>
> "Run 3.4 or skip to 3.5?"

If skipped, mark `phase_3_4: SKIPPED` in `{status_phase_03_file}` and proceed to 3.5.

Skip record:
```yaml
phase_3_4:
  status: "SKIPPED"
  state_history:
    - { state: "NOT_STARTED", at: "{ISO}" }
    - { state: "SKIPPED", at: "{ISO}" }
```

---

## Completion Summary

When Phase 3 is locked, present:

> "Phase 3 complete — Solutioning baseline established."
>
> "**Architecture:**"
> "- System Context (C4 L1): {N} external systems mapped"
> "- Architecture Style (3.2): {style}, ADR-001 captured"
> "- Container Design (C4 L2): {C} containers, ADR-002 through ADR-{M}"
> "- Quality Attributes (3.4): {status}" (or "Skipped")
> "- Component Synthesis (C4 L3): {K} components, 4+1 views validated"
>
> "**Development Blueprint:**"
> "- Epics (3.6): {E} epics across {R} releases"
> "- Stories (3.7): {S} stories designed, development order frozen ★"
> "- API & Data (3.8): {E} endpoints, {T} tables/collections"
> "- Readiness (3.9): All gates passed, ready for implementation"
>
> "**Dev Mode:** {separated|full_stack} — controls Phase 4 routing (dual-track or merged)"
>
> "**Artifacts:** [list of all locked solutioning artifacts with paths]"
>
> "Ready for Phase 4: Implementation."

Return to the main workflow menu.
