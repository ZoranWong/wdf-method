---
sub_workflow: "2-1-impact-mapping"
phase: 2
sub_phase: "2.1"
version: "3.6.0"
title: "Phase 2.1 — Impact Mapping"
description: "Align on business goals using Gojko Adzic's Impact Mapping methodology. Define SMART goals, identify actors, analyze impacts, and map deliverables to build a traceable chain from business objective to feature."
dependencies: []
methodology: "Impact Mapping by Gojko Adzic"
---

# Phase 2.1 — Impact Mapping

**Sub-Phase Goal:** Create an Impact Map that connects a SMART business goal to concrete deliverables through actors and their impacts. This is the anchor of the entire planning chain — every downstream artifact traces back to this map.

**Why This First:** Before we design anything, we must answer *Why are we building this?* Impact Mapping ensures every feature directly supports a measurable business objective, preventing scope creep and feature bloat.

**Duration:** This sub-phase continues until the Impact Map is drafted, verified, and locked.

---

## Methodology Overview

Impact Mapping (Gojko Adzic) structures thinking around four layers:

```
  ┌─────────────┐
  │    GOAL     │  ← SMART business objective
  └──────┬──────┘
         │
    ┌────┴────┐
    │ ACTORS  │  ← Who can influence the goal?
    └────┬────┘
         │
    ┌────┴────┐
    │ IMPACTS │  ← How should their behavior change?
    └────┬────┘
         │
    ┌────┴────┐
    │DELIVER..│  ← What can we build to cause that change?
    └─────────┘
```

**Traceability chain:** Goal → Actor → Impact → Deliverable. Every deliverable must be tied to at least one impact.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin Impact Mapping |
| `IN_PROGRESS` | Map fully drafted | `MAP_DRAFTED` | All four layers completed |
| `MAP_DRAFTED` | User verifies map | `VERIFIED` | Map accuracy confirmed |
| `VERIFIED` | User locks artifact | `LOCKED` | Impact map becomes read-only |

---

## Gate Card

```yaml
gate_card:
  phase: 2
  sub_phase: "2.1"
  enters_from: null
  checks:
    - id: "G2.1-01"
      description: "User confirms readiness to start Impact Mapping"
      type: "user_confirmation"
  all_pass: false
```

Phase 2.1 is the entry point for planning analysis. A simple user confirmation gates entry.

---

## Step 1: Gate Card Check

Present to the user:

> "Phase 2.1: Impact Mapping. We'll define a clear business goal and trace it through actors, impacts, and deliverables. This will be the foundation for all downstream decisions."

Record the gate check in `{sprint_tracking}`:

```yaml
phases:
  phase_2:
    substates:
      phase_2_1:
        status: "IN_PROGRESS"
        gate_card:
          checks: [{id: "G2.1-01", status: "pass"}]
          all_pass: true
```

---

## Step 2: Define the SMART Business Goal

**Agent guides the user through defining a single, measurable business goal.**

Ask the user:

> "Let's start with the core business goal. What is the primary measurable outcome this project should achieve? Think in terms of business metrics, not features."

Guide the user to formulate a SMART goal:

| Criterion | Question to Ask | Example |
|-----------|----------------|---------|
| **S**pecific | What exactly should change? | "Increase user signups" |
| **M**easurable | How will we measure success? | "From 100/week to 500/week" |
| **A**ctionable | Can we influence this outcome? | "Yes, by improving onboarding" |
| **R**elevant | Does this align with business strategy? | "Supports Q3 growth target" |
| **T**ime-bound | By when should this be achieved? | "Within 3 months of launch" |

Capture the final goal statement. Example:

```
GOAL: Increase new user signups from 100/week to 500/week
within 3 months of launch, supporting Q3 growth targets.
```

**Validate:** Ask the user to confirm this is the right goal and there are no competing goals. If there are multiple goals, pick the most important one first — other goals can be handled in a separate Impact Map.

Output to `{impact_map_output}`:

```markdown
# Impact Map

## Business Goal
**SMART Goal:** {final goal statement}

| Dimension | Detail |
|-----------|--------|
| Specific | {specific detail} |
| Measurable | {measurement} |
| Actionable | {why actionable} |
| Relevant | {business alignment} |
| Time-bound | {deadline or timeframe} |
```

---

## Step 3: Identify Actors

**Agent guides the user to identify all actors who can influence the goal.**

Explain:

> "Now let's identify all the people (and systems) who can help or hinder this goal. Think beyond just end users."

Prompt the user with categories:

1. **End users** — Who directly uses the product?
2. **Internal stakeholders** — Admin, support, sales, legal?
3. **External influencers** — Regulators, partners, competitors?
4. **System actors** — Third-party APIs, automated processes?

For each actor, capture:
- **Name** (e.g., "New User", "Customer Support Agent")
- **Type** (end-user, internal, external, system)
- **Relevance** (how they influence the goal)

Add to `{impact_map_output}`:

```markdown
## Actors

| Actor | Type | How They Influence the Goal |
|-------|------|---------------------------|
| {actor 1} | {type} | {influence description} |
| {actor 2} | {type} | {influence description} |
...
```

**Validation:** Have we captured at least 3 distinct actor types? Are there any indirect actors we missed?

---

## Step 4: Analyze Impacts

**Agent guides the user to define how each actor's behavior should change.**

For each actor, ask:

> "How should [{actor}]'s behavior change to help us achieve the goal? What do they need to start doing, stop doing, or do differently?"

Impacts should be behavioral changes, NOT features. Frame them as:
- "Start doing X" (new behavior)
- "Stop doing Y" (reduce friction)
- "Do more of Z" (accelerate)
- "Do less of W" (reduce negative behavior)

For each impact, classify as:
- **Help** — positively contributes to the goal
- **Hinder** — obstructs or prevents the goal

Add to `{impact_map_output}`:

```markdown
## Impacts

| Actor | Impact (Behavior Change) | Direction | Priority |
|-------|------------------------|-----------|----------|
| {actor} | {impact description} | help / hinder | high / medium / low |
...
```

---

## Step 5: Map Deliverables

**Agent maps deliverables (features/solutions) to impacts.**

For each high-priority impact, ask:

> "What could we build or deliver to cause [{actor}] to [{impact}]?"

Deliverables can be:
- Software features
- Content (docs, tutorials)
- Process changes
- Integrations

Every deliverable must connect to at least one impact. Flag orphan deliverables (no impact connection) for discussion.

Add to `{impact_map_output}`:

```markdown
## Deliverables

| Deliverable | Addresses Impact | Type | Notes |
|------------|-----------------|------|-------|
| {deliverable} | {which impact from above} | feature / content / process / integration | {notes} |
...
```

---

## Step 6: Visualize the Map

Create an ASCII-art summary showing the full chain:

```markdown
## Impact Map Visualization

GOAL: {goal summary}
│
├── Actor: {actor 1}
│   ├── Impact: {impact 1a} [help]
│   │   └── Deliverable: {deliverable}
│   └── Impact: {impact 1b} [hinder]
│       └── Deliverable: {deliverable}
│
├── Actor: {actor 2}
│   ├── Impact: {impact 2a} [help]
│   │   ├── Deliverable: {deliverable}
│   │   └── Deliverable: {deliverable}
│   └── Impact: {impact 2b} [help]
│       └── Deliverable: {deliverable}
│
└── Actor: {actor 3}
    ├── Impact: {impact 3a} [help]
    │   └── Deliverable: {deliverable}
    └── Impact: {impact 3b} [hinder]
        └── Deliverable: {deliverable}
```

---

## Step 7: Verify and Lock

Present the complete Impact Map to the user for review:

> "Here's the complete Impact Map. Let's verify:
> 1. The goal is SMART and agreed upon
> 2. All relevant actors are identified
> 3. Impacts represent real behavioral changes (not features)
> 4. Every deliverable connects to an impact
> 5. No orphan deliverables exist
>
> Does this look accurate? [Approve / Revise]"

Transition: `MAP_DRAFTED` → `VERIFIED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_2:
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
```

---

## Step 8: Completion

Present summary:

> "Phase 2.1 complete — Impact Map locked. Key artifact: `{impact_map_output}`."
>
> "Summary: {N} actors, {M} impacts, {K} deliverables traced to SMART goal: {goal summary}"
>
> "This Impact Map will inform Event Storming (2.2) and Story Mapping (2.4)."

Return to the Phase 2 sub-phase menu.
