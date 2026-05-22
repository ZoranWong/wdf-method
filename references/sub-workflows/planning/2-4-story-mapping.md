---
sub_workflow: "2-4-story-mapping"
phase: 2
sub_phase: "2.4"
version: "3.6.0"
title: "Phase 2.4 — Story Mapping"
description: "Build a User Story Map using Jeff Patton's methodology. Organize user activities into a backbone, slice releases by walking skeleton, and link stories back to the Impact Map for full traceability."
dependencies: ["impact-map.md", "event-storm.md (optional)"]
methodology: "User Story Mapping by Jeff Patton"
---

# Phase 2.4 — Story Mapping

**Sub-Phase Goal:** Create a User Story Map — a visual representation of the user's journey through the product, organized by activity backbone, user tasks, and prioritized stories. This is the bridge from strategic analysis (Impact Map, JTBD) to tactical story delivery.

**Why This Matters:** Story Mapping ensures we build features in the right order — the 'walking skeleton' comes first. It prevents the common problem of building lower-priority features before the core journey is complete.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin Story Mapping |
| `IN_PROGRESS` | Backbone + user tasks defined | `BACKBONE_MAPPED` | Activity structure complete |
| `BACKBONE_MAPPED` | Stories placed under tasks | `STORIES_PLACED` | Full story map built |
| `STORIES_PLACED` | Slices + releases defined | `SLICES_DEFINED` | Priority slices identified |
| `SLICES_DEFINED` | User verifies map | `VERIFIED` | Map confirmed |
| `VERIFIED` | User locks artifact | `LOCKED` | Story map locked |

---

## Gate Card

```yaml
gate_card:
  phase: 2
  sub_phase: "2.4"
  enters_from: "2.1"
  checks:
    - id: "G2.4-01"
      description: "Impact Map is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_2.substates.phase_2_1.status"
      operator: "eq"
      expected: "LOCKED"
  all_pass: false
```

---

## Step 1: Gate Card Check

Verify that the Impact Map (Phase 2.1) is LOCKED:

> "Checking prerequisites: Phase 2.1 (Impact Map) status..."

If 2.1 is not LOCKED, HALT: "Phase 2.1 must be complete before Story Mapping can begin."

Record the gate check:

```yaml
phases:
  phase_2:
    substates:
      phase_2_4:
        status: "IN_PROGRESS"
        gate_card:
          checks: [{id: "G2.4-01", status: "pass"}]
          all_pass: true
```

---

## Step 2: Load Context

Read key upstream artifacts:
- `{impact_map_output}` — actors and deliverables
- `{jtbd_cards_output}` (if Phase 2.3 was completed, not skipped) — user jobs and motivations
- `{event_storming_output}` (if Phase 2.2 was completed, not skipped) — domain events

---

## Step 3: Define the Story Map Backbone

**Agent guides the user to define the backbone — the high-level activities users perform chronologically.**

Explain the concept:

> "The backbone represents the narrative flow — what users do from start to finish, in chronological order. These are high-level activities like 'Browse Products', 'Manage Cart', 'Checkout', 'Track Order'."

For each persona from the Impact Map, ask:

> "Walk me through [{persona}]'s journey. What are the major activities, in order?"

Create the horizontal backbone. Add to `{story_map_output}`:

```markdown
# User Story Map

## Backbone (Horizontal Narrative Flow)

{Activity 1} → {Activity 2} → {Activity 3} → {Activity 4} → ...
```

**Validation:** Does the backbone cover the full user journey? Are activities in a logical chronological order?

---

## Step 4: Define User Tasks (Under Each Activity)

For each backbone activity, ask:

> "Under '{Activity}', what specific tasks does the user need to complete?"

Tasks are more granular than activities but not yet stories. Example:
- Activity: "Manage Cart" → Tasks: "Add item", "Update quantity", "Remove item", "View cart total"

Add to output:

```markdown
## Activities and Tasks

### {Activity 1}
- {Task 1a}
- {Task 1b}
- {Task 1c}

### {Activity 2}
- {Task 2a}
- {Task 2b}
...
```

---

## Step 5: Place User Stories (Under Each Task)

For each task, ask:

> "What specific features or capabilities do we need to support '{Task}'? Think about variations, edge cases, and alternative paths."

Stories follow the standard format: "As a [persona], I want [feature], so that [benefit]."

Place stories vertically under their task (higher = more critical):

```markdown
### {Activity 1}

#### {Task 1a}
- [Critical] As a {persona}, I want {feature}, so that {benefit}
- [High] As a {persona}, I want {feature}, so that {benefit}
- [Medium] As a {persona}, I want {feature}, so that {benefit}

#### {Task 1b}
- [Critical] As a {persona}, I want {feature}, so that {benefit}
...
```

**Traceability:** Each story should reference which Impact Map deliverable it supports:

```markdown
- [Critical] As a {persona}, I want {feature}, so that {benefit}
  → Supports Deliverable: {impact map deliverable name}
```

---

## Step 6: Define Slices and Releases

**Agent guides slicing — cutting across the story map horizontally to define releases.**

Explain:

> "Now we'll slice the map to define releases. A slice cuts horizontally across all activities, delivering a thin but complete user journey — the 'walking skeleton'."

For each release, ask:

> "What's the minimum set of stories across all activities that delivers value in Release {N}?"

| Slice | Description | Stories Included | Target Outcome |
|-------|-------------|-----------------|----------------|
| Release 1 (MVP) | Walking skeleton — core journey end-to-end | {story count} stories | {MVP outcome} |
| Release 2 | Enhance and expand | {story count} stories | {outcome} |
| Release 3+ | Polish and delight | {story count} stories | {outcome} |

Add to output:

```markdown
## Release Slices

### Release 1 — Walking Skeleton (MVP)
*The bare minimum to complete the core user journey end-to-end*

| Activity | Stories Included |
|----------|-----------------|
| {Activity 1} | {stories} |
| {Activity 2} | {stories} |
...

**Total Stories: {N}**

### Release 2 — {Release Name}
...

### Release 3 — {Release Name}
...
```

---

## Step 7: Visualize the Map

Create a visual representation:

```markdown
## Story Map Visualization

ACTIVITIES →   Activity 1    Activity 2    Activity 3    Activity 4
              ────────────  ────────────  ────────────  ────────────
                Task 1a       Task 2a       Task 3a       Task 4a
CRITICAL  ──  [Story]        [Story]       [Story]       [Story]     ←── Release 1 slice
HIGH      ──  [Story]        [Story]                      [Story]     ←── Release 2 slice
MEDIUM    ──  [Story]                       [Story]
LOW       ──                                [Story]

                Task 1b       Task 2b       Task 3b
CRITICAL  ──  [Story]                       [Story]
HIGH      ──                                [Story]
```

---

## Step 8: Verify and Lock

Present the complete Story Map:

> "Here's the User Story Map. Let's verify:
> 1. The backbone covers the full user journey for all personas
> 2. Every task has stories beneath it
> 3. Release slices deliver complete user journeys (not partial features)
> 4. MVP slice is truly minimal — could we cut more?
> 5. Every story traces back to an Impact Map deliverable
>
> Does this look accurate? [Approve / Revise]"

Transition: `BACKBONE_MAPPED` → `STORIES_PLACED` → `SLICES_DEFINED` → `VERIFIED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_2:
    substates:
      phase_2_4:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "BACKBONE_MAPPED", at: "{ISO}" }
          - { state: "STORIES_PLACED", at: "{ISO}" }
          - { state: "SLICES_DEFINED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "story_map", path: "{story_map_output}", status: "locked" }
        gate_card:
          all_pass: true
```

---

## Step 9: Completion

Present summary:

> "Phase 2.4 complete — Story Map locked. Artifact: `{story_map_output}`."
>
> "Summary: {A} activities, {T} tasks, {S} stories across {R} release slices. Walking skeleton (MVP) contains {M} stories."

Return to the Phase 2 sub-phase menu.
