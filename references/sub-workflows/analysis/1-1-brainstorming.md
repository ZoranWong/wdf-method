---
sub_workflow: "1-1-brainstorming"
phase: 1
sub_phase: "1.1"
version: "3.6.0"
title: "Phase 1.1 — Brainstorming"
description: "Optional BMAD brainstorming session to explore creative possibilities and generate initial ideas before structured requirements analysis begins. Skips by default; user opts in."
dependencies: []
methodology: "BMAD Brainstorming"
bmad_skill: "/bmad-brainstorming"
---

# Phase 1.1 — Brainstorming

**Sub-Phase Goal:** Run an optional BMAD brainstorming session to explore creative possibilities, surface hidden assumptions, and generate a broad set of ideas before structured requirements work begins. This serves as a "blue sky" prelude to the analysis phases.

**Why This First (Optional):** Brainstorming before structured analysis prevents premature convergence on a single solution and uncovers opportunities the user may not have considered. It is intentionally optional — many projects already have a clear idea and can skip directly to domain research or impact mapping.

**Duration:** One session. Runs once, then either transitions to LOCKED or SKIPPED.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | User selects sub-phase | `IN_PROGRESS` | Begin brainstorming session |
| `IN_PROGRESS` | BMAD brainstorming session active | `BRAINSTORMING` | Ideas being generated |
| `BRAINSTORMING` | Ideas captured in brainstorm.md | `IDEAS_DOCUMENTED` | Output file created |
| `IDEAS_DOCUMENTED` | User verifies brainstorm output | `VERIFIED` | Output reviewed and confirmed |
| `VERIFIED` | User locks artifact | `LOCKED` | Brainstorm becomes read-only |
| `NOT_STARTED` | User chooses to skip | `SKIPPED` | Sub-phase bypassed |

**SKIPPED state:** When the user elects to skip this sub-phase, the state transitions directly from `NOT_STARTED` to `SKIPPED`. This is a valid terminal state. The `SKIPPED` transition is offered at Step 1 and is the default behavior — the agent asks "Do you want to run BMAD brainstorming?" and skipping is the default response.

---

## Gate Card

```yaml
gate_card:
  phase: 1
  sub_phase: "1.1"
  enters_from: null
  checks:
    - id: "G1.1-01"
      description: "User opts in to brainstorming (default: skip)"
      type: "user_confirmation"
      default_response: "skip"
  all_pass: false
```

Phase 1.1 is the first entry point for analysis. It gates on a single user confirmation. If the user declines, the sub-phase transitions to `SKIPPED` and the workflow proceeds to Phase 1.2 (Domain Research) or 1.3 (Impact Mapping, depending on configuration).

---

## Step 1: Gate Card Check

Present to the user:

> "Phase 1.1: Brainstorming. This is an optional BMAD brainstorming session to explore ideas creatively before we begin structured requirements analysis. It's useful when you want to explore possibilities rather than locking into a direction immediately."
>
> "Do you want to run a brainstorming session? [Y] Yes, let's brainstorm [N] Skip (default)"

**If user chooses Skip (or N):**

Transition: `NOT_STARTED` → `SKIPPED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_1:
    substates:
      phase_1_1:
        status: "SKIPPED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "SKIPPED", at: "{ISO}", reason: "User opted out" }
        gate_card:
          checks: [{id: "G1.1-01", status: "fail", note: "User skipped"}]
          all_pass: false
```

> "Brainstorming skipped. Proceeding to Phase 1.2: Domain Research."

Return to the Phase 1 sub-phase menu.

**If user opts in:**

Transition: `NOT_STARTED` → `IN_PROGRESS`.

Record the gate check in `{sprint_tracking}`:

```yaml
phases:
  phase_1:
    substates:
      phase_1_1:
        status: "IN_PROGRESS"
        gate_card:
          checks: [{id: "G1.1-01", status: "pass"}]
          all_pass: true
```

---

## Step 2: Invoke BMAD Brainstorming Skill

**Agent invokes the BMAD brainstorming skill.**

Invoke: `/bmad-brainstorming`

**Instructions to pass to the skill:**

- This is a pre-requirements brainstorming session for a web development project.
- The goal is to generate a broad set of ideas, not to filter or prioritize them.
- Explore: potential features, user types, technical approaches, novel interactions, constraints, risks.
- Output should be captured to `{brainstorm_output}` (typically `_wdf_output/analysis/brainstorm.md`).

**Agent should prompt the user:**

> "Let's brainstorm. What problem are you trying to solve? What's the context? What ideas do you already have? Feel free to think broadly — we'll narrow down later in the analysis phases."

Transition: `IN_PROGRESS` → `BRAINSTORMING`.

---

## Step 3: Capture Brainstorm Output

The BMAD brainstorming skill will produce a set of ideas. The agent should ensure the output is saved to `{brainstorm_output}` with proper frontmatter:

```yaml
---
artifact_type: "brainstorm"
artifact_id: "{project}-brainstorm-v1"
phase: 1
sub_phase: "1.1"
status: "draft"
version: "3.6.0"
created_at: "{ISO_TIMESTAMP}"
---
```

The file should contain at minimum:

```markdown
# Brainstorm: {project_name}

## Session Context
{Problem statement, goals, constraints}

## Ideas Generated
### Feature Ideas
- ...

### Technical Ideas
- ...

### User Experience Ideas
- ...

### Risks & Concerns
- ...

### Out-of-Scope Ideas (Parking Lot)
- ...
```

Transition: `BRAINSTORMING` → `IDEAS_DOCUMENTED`.

---

## Step 4: Review and Verify

Present the brainstorm output summary to the user:

> "Brainstorming complete. Here's a summary of what was captured:"
>
> "- {N} feature ideas"
> "- {M} technical ideas"
> "- {K} UX ideas"
> "- {R} risks/concerns"
> "- {P} parking lot items"
>
> "The full output is at `{brainstorm_output}`."
>
> "Does this look complete? [Approve / Revise / Discard]"

- **Approve:** Transition `IDEAS_DOCUMENTED` → `VERIFIED`.
- **Revise:** Return to Step 3 for edits.
- **Discard:** Transition directly to `SKIPPED` (output is kept but marked as discarded).

Transition: `IDEAS_DOCUMENTED` → `VERIFIED`.

---

## Step 5: Lock Artifact

Update brainstorm output frontmatter:

```yaml
status: "locked"
locked_at: "{ISO_TIMESTAMP}"
```

Transition: `VERIFIED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_1:
    substates:
      phase_1_1:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "BRAINSTORMING", at: "{ISO}" }
          - { state: "IDEAS_DOCUMENTED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "brainstorm", path: "{brainstorm_output}", status: "locked" }
        gate_card:
          all_pass: true
```

---

## Step 6: Completion

Present summary:

> "Phase 1.1 complete — Brainstorming LOCKED."
>
> "Key artifact: `{brainstorm_output}`"
>
> "Summary: {N} feature ideas, {M} technical ideas, {K} UX ideas captured."
>
> "The brainstorm output will be available for reference during later analysis phases."

Return to the Phase 1 sub-phase menu.
