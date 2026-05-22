---
phase: 1
title: "Phase 1 — Analysis (Optional Pre-Research)"
version: "3.6.0"
description: "Optional pre-research phase that provides structured analysis before formal planning begins. Three skippable sub-phases — Brainstorming, Domain Research, and Product Brief — build foundational understanding. The entire phase can be skipped for well-understood projects."
dependencies: []
---

# Phase 1 — Analysis (Optional Pre-Research)

**Phase Goal:** Build foundational understanding through structured analysis methodologies before committing to formal planning. This phase is entirely optional — skip it if the problem domain is well-understood, or run individual sub-phases to fill specific knowledge gaps.

**Why Pre-Research:** Jumping straight to PRD without domain understanding leads to missed requirements and incorrect assumptions. This phase provides lightweight, structured research that feeds into Phase 2 planning. Every insight produced here traces to a planning decision downstream.

**Relationship to Phase 2:** Phase 2 (Planning) can start directly without Phase 1. If Phase 1 is run, its research outputs feed into Phase 2.1 Impact Mapping and Phase 2.3 JTBD.

---

## Phase-Level FSM

```
NOT_STARTED → IN_PROGRESS → ALL_SUB_PHASES_APPROVED → APPROVED → LOCKED
```

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | User enters Phase 1 | `IN_PROGRESS` | Analysis begins |
| `IN_PROGRESS` | All non-skipped sub-phases locked | `ALL_SUB_PHASES_APPROVED` | Sub-phase work complete |
| `ALL_SUB_PHASES_APPROVED` | User reviews research artifacts | `APPROVED` | Research is final |
| `APPROVED` | Phase 2 consumes research | `LOCKED` | Research becomes read-only baseline |
| `LOCKED` | Blocking CR filed | `UNLOCK_RESOLVE` | Research needs revision |

**BMAD Analysis States (per sub-phase):**
```
NOT_STARTED → RESEARCHING → ANALYZING → DOCUMENTED → VERIFIED
```

The entire Phase 1 is **SKIPPABLE**. If skipped, Phase 2 starts directly.

---

## Gate Card

```yaml
gate_card:
  phase: 1
  enters_from: null          # Phase 1 is an optional entry point
  checks:
    - id: "G1-01"
      description: "User confirms readiness to begin analysis (or explicitly skip)"
      type: "user_confirmation"
  all_pass: false
```

Phase 1 is always available but always optional. A simple user confirmation gates entry, and a skip prompt is presented first.

---

## Sub-Phase Routing Table

| Sub-Phase | Methodology | Reference File | Output | Required | BMAD Skill |
|-----------|------------|---------------|--------|----------|-----------|
| 1.1 | Brainstorming | `./references/sub-workflows/analysis/1-1-brainstorming.md` | `{research_output}/brainstorming.md` | *Skippable* | `/bmad-brainstorming` |
| 1.2 | Domain Research | `./references/sub-workflows/analysis/1-2-domain-research.md` | `{research_output}/domain-research.md` | *Skippable* | `/bmad-domain-research` |
| 1.3 | Product Brief | `./references/sub-workflows/analysis/1-3-product-brief.md` | `{research_output}/product-brief.md` | *Skippable* | bmad product-brief |

**All sub-phases are skippable.** The entire Phase 1 can be skipped on entry.

**Recommended Path:**
- **New domain, greenfield project**: Full 1.1 → 1.2 → 1.3
- **Established domain, new product**: 1.1 → 1.3 (skip domain research)
- **Scaffold/template project**: 1.1 only (brainstorming for sticky decisions)
- **Well-understood project**: Skip entire Phase 1

**Minimum Viable Path:** Skip entire Phase 1. Start at Phase 2.

---

## Phase 1 Entry

### Step 1: Skip Prompt

Before any gate check, present the skip prompt:

> "Phase 1 — Analysis (Optional Pre-Research)."
>
> "This phase provides structured research before formal planning begins:"
> "- **1.1 Brainstorming** — Explore ideas and align on direction"
> "- **1.2 Domain Research** — Research the problem space and existing solutions"
> "- **1.3 Product Brief** — Synthesize findings into a concise product brief"
>
> "All sub-phases are optional. You can:"
> "- Run the full analysis path"
> "- Pick specific sub-phases you need"
> "- Skip Phase 1 entirely and proceed to Phase 2 (Planning)"
>
> "What would you like to do?"
> "[1] Start Phase 1 Analysis (choose sub-phases)"
> "[2] Skip Phase 1 — Proceed to Phase 2 Planning"

If the user chooses to skip, write to `{status_phase_01_file}`:

```yaml
phases:
  phase_1:
    status: "SKIPPED"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "SKIPPED", at: "{ISO}" }
    gate_card:
      phase: 1
      checks: [{id: "G1-01", status: "skipped"}]
      all_pass: false
    substates:
      phase_1_1: { status: "NOT_STARTED" }
      phase_1_2: { status: "NOT_STARTED" }
      phase_1_3: { status: "NOT_STARTED" }
```

Then proceed to Phase 2.

---

### Step 2: Gate Card Check (If Entering)

Present to the user:

> "Phase 1: Pre-Research Analysis. We'll use structured methodologies to build foundational understanding before planning."
>
> "Available sub-phases:"
> "- **1.1 Brainstorming** — Explore the problem space and generate ideas"
> "- **1.2 Domain Research** — Research existing solutions, competitors, and domain patterns"
> "- **1.3 Product Brief** — Synthesize research into a concise product vision"
>
> "You can run any or all sub-phases in any order. Ready to begin? [Y] Proceed"

Record the gate check in `{status_phase_01_file}`:

```yaml
phases:
  phase_1:
    status: "IN_PROGRESS"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "IN_PROGRESS", at: "{ISO}" }
    gate_card:
      phase: 1
      checks: [{id: "G1-01", status: "pass"}]
      all_pass: true
    substates:
      phase_1_1:
        status: "NOT_STARTED"
      phase_1_2:
        status: "NOT_STARTED"
      phase_1_3:
        status: "NOT_STARTED"
```

---

### Step 3: Present Sub-Phase Menu

Present the Phase 1 sub-phase menu:

```
Phase 1 — Analysis (Optional Pre-Research)
═══════════════════════════════════════════

All sub-phases are skippable. Run in any order.

Sub-Phase Status:
  1.1 Brainstorming           [{status}] {output} [skippable]
  1.2 Domain Research         [{status}] {output} [skippable]
  1.3 Product Brief           [{status}] {output} [skippable]

Available Actions:
  [1] Start 1.1 — Brainstorming (/bmad-brainstorming)
  [2] Start 1.2 — Domain Research (/bmad-domain-research)
  [3] Start 1.3 — Product Brief (bmad product-brief)
  [D] Mark Phase 1 complete and proceed to Phase 2
  [S] View sub-phase status
  [Q] Return to main menu
```

**Selection Rules:**
- Sub-phases marked as `LOCKED` or `SKIPPED` show `[LOCKED]` or `[SKIPPED]` and are not selectable
- No sub-phase ordering dependencies — run in any sequence
- Show completed count: "X of Y selected sub-phases complete"
- Option `[D]` is always available — user can mark Phase 1 complete at any time

---

### Step 4: Route to Selected Sub-Phase

When the user selects a sub-phase:

1. **Present the skip prompt** (all sub-phases are skippable):
   > "{sub_phase_name} — {methodology}. {short description}"
   >
   > "Run this sub-phase or skip? [Y] Run  [N] Skip"

2. If skipped: write status to `{status_phase_01_file}`, return to menu

3. **Load the sub-workflow file** from the reference path in the routing table
4. **Read the entire file** before taking any action
5. **Invoke the BMAD skill** as specified in the routing table
6. **For 1.1:** Invoke `/bmad-brainstorming` with the project context
7. **For 1.2:** Invoke `/bmad-domain-research` with research topics
8. **For 1.3:** Invoke the bmad product-brief workflow
9. **Follow the sub-workflow's instructions** exactly as written
10. **After completion**, write to `{status_phase_01_file}` and return to the Phase 1 sub-phase menu

**CRITICAL:** Do not load more than one sub-workflow file at a time. Only the selected sub-phase file is read and executed.

---

### Step 5: Track Phase Completion

After each sub-phase completes (or is skipped), check if the user has indicated they are done:

**Phase 1 completion is user-driven** — the user selects `[D]` from the menu when satisfied.

When the user marks Phase 1 complete:

```
═══════════════════════════════════════════
Phase 1 — Analysis Complete
═══════════════════════════════════════════

Research Artifacts Produced:
  1.1 Brainstorming:        {status_1_1}
  1.2 Domain Research:      {status_1_2}
  1.3 Product Brief:        {status_1_3}

All research outputs are in: {research_output}/

Available Actions:
  [1] Review & Approve — Transition Phase 1 to APPROVED
  [2] Run additional sub-phases — Return to menu
  [D] Skip approval, proceed to Phase 2
```

If the user chooses to review, transition to `ALL_SUB_PHASES_APPROVED`.

---

## Step 6: Phase 1 Approval

When the user is ready to approve Phase 1:

> "All research artifacts are available at `{research_output}/`. Do you approve the analysis findings to feed into Phase 2 planning?"
>
> "[Y] Approve and lock research artifacts  [N] Continue revising"

On approval:
- Transition Phase 1: `ALL_SUB_PHASES_APPROVED` → `APPROVED`
- Update each artifact frontmatter: `status: "approved"`

---

## Step 7: Auto-Lock on Phase 2 Start

When Phase 2 is entered, Phase 1 automatically transitions to LOCKED (if not already SKIPPED). This creates a read-only research baseline that Phase 2 can reference.

If Phase 1 was SKIPPED, no lock is needed — Phase 2 starts directly.

---

## Step 8: Phase Complete Record

Write to `{status_phase_01_file}` when Phase 1 reaches LOCKED:

```yaml
phases:
  phase_1:
    status: "LOCKED"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "IN_PROGRESS", at: "{ISO}" }
      - { state: "ALL_SUB_PHASES_APPROVED", at: "{ISO}" }
      - { state: "APPROVED", at: "{ISO}" }
      - { state: "LOCKED", at: "{ISO}", by: "phase_2_start" }
    artifacts:
      - { type: "brainstorming", path: "{research_output}/brainstorming.md", status: "{locked|n/a}" }
      - { type: "domain_research", path: "{research_output}/domain-research.md", status: "{locked|n/a}" }
      - { type: "product_brief", path: "{research_output}/product-brief.md", status: "{locked|n/a}" }
    gate_card:
      all_pass: true
    substates:
      phase_1_1:
        status: "{LOCKED|SKIPPED}"
        # If LOCKED: include state_history + bmad_state + artifacts
        # If SKIPPED: include skip record
      phase_1_2:
        status: "{LOCKED|SKIPPED}"
      phase_1_3:
        status: "{LOCKED|SKIPPED}"
```

Or if skipped entirely:

```yaml
phases:
  phase_1:
    status: "SKIPPED"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "SKIPPED", at: "{ISO}" }
    substates:
      phase_1_1: { status: "NOT_STARTED" }
      phase_1_2: { status: "NOT_STARTED" }
      phase_1_3: { status: "NOT_STARTED" }
```

---

## Skip Mechanism

All sub-phases in Phase 1 are skippable. Additionally, Phase 1 itself is skippable.

### Per-Sub-Phase Skip Flow

1. User selects sub-phase 1.1, 1.2, or 1.3 from the menu
2. Orchestrator presents the skip prompt
3. If skipped: status set to `SKIPPED` in sprint-status.yaml
4. Skipped sub-phases are excluded from Phase 1 completion tracking
5. Sub-phase menu shows `[SKIPPED]` for skipped sub-phases

### Entire Phase Skip Flow

1. On initial entry, user is asked whether to enter Phase 1 or skip
2. If skipped: `phase_1.status = "SKIPPED"`, proceed to Phase 2
3. Phase 2 Gate Card must handle `phase_1.status == "SKIPPED"` as a valid pre-condition

Skip records in sprint-status.yaml:

```yaml
# Per-sub-phase skip:
phase_1_1:
  status: "SKIPPED"
  state_history:
    - { state: "NOT_STARTED", at: "{ISO}" }
    - { state: "SKIPPED", at: "{ISO}" }

# Entire phase skip:
phase_1:
  status: "SKIPPED"
  state_history:
    - { state: "NOT_STARTED", at: "{ISO}" }
    - { state: "SKIPPED", at: "{ISO}" }
```

---

## Completion Summary

When Phase 1 is complete and locked (not skipped), present:

> "Phase 1 complete — Analysis baseline established."
>
> "**Methodologies Applied:**"
> "- Brainstorming: {N} ideas generated, {M} key decisions documented" (or "Skipped for this project")
> "- Domain Research: {K} sources analyzed, {T} topics covered" (or "Skipped for this project")
> "- Product Brief: {P} problem statements, {S} solution hypotheses" (or "Skipped for this project")
>
> "**Artifacts:** [list of all locked artifacts with paths in {research_output}/]"
>
> "**Feed into Phase 2:** Research findings will inform Planning sub-phases (2.1 Impact Mapping, 2.3 JTBD)."
>
> "Ready for Phase 2: Planning."

If Phase 1 was skipped:

> "Phase 1 skipped. Research artifacts not generated. Proceeding directly to Phase 2: Planning."

Return to the main workflow menu.
