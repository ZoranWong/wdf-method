---
sub_workflow: "2-2-event-storming"
phase: 2
sub_phase: "2.2"
version: "3.6.0"
title: "Phase 2.2 — Event Storming"
description: "Explore the domain using Alberto Brandolini's Event Storming methodology. Identify domain events, commands, aggregates, bounded contexts, and hotspots to build a comprehensive understanding of what happens in the system."
dependencies: ["impact-map.md"]
methodology: "Event Storming by Alberto Brandolini"
skip_allowed: true
---

# Phase 2.2 — Event Storming

**Sub-Phase Goal:** Map the domain's events in chronological order, identify commands and aggregates, discover bounded contexts, and flag hotspots (risks and unknowns).

**Why This Matters:** Event Storming reveals *what* happens in the domain before we decide *how* to build it. It uncovers hidden complexity, aligning the team around a shared mental model.

**Recommended For:** Complex or unfamiliar domains. Skip for simple CRUD applications where the domain is well-understood.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin Event Storming |
| `NOT_STARTED` | User chooses skip | `SKIPPED` | Sub-phase not needed |
| `IN_PROGRESS` | Events identified + timeline ordered | `EVENTS_IDENTIFIED` | Domain events captured |
| `EVENTS_IDENTIFIED` | Commands, aggregates, contexts mapped | `CONTEXTS_MAPPED` | Structure added to events |
| `CONTEXTS_MAPPED` | User verifies board | `VERIFIED` | Board accuracy confirmed |
| `VERIFIED` | User locks artifact | `LOCKED` | Event storm board locked |

---

## Gate Card

```yaml
gate_card:
  phase: 2
  sub_phase: "2.2"
  enters_from: "2.1"
  checks:
    - id: "G2.2-01"
      description: "Skip prompt — proceed or skip this sub-phase"
      type: "user_confirmation"
  all_pass: false
```

---

## Step 0: Skip Decision

Before entering, present the skip prompt:

> "This sub-phase is recommended for complex or unfamiliar domains. For simple CRUD apps, you may skip."
>
> "Proceed with Event Storming? [Y] Proceed [S] Skip"

If user chooses **Skip**:

Update `{sprint_tracking}`:

```yaml
phases:
  phase_2:
    substates:
      phase_2_2:
        status: "SKIPPED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "SKIPPED", at: "{ISO}" }
```

Return to the Phase 2 sub-phase menu.

If user chooses **Proceed**, continue to Step 1.

---

## Step 1: Gate Card Check

Record the gate check:

```yaml
phases:
  phase_2:
    substates:
      phase_2_2:
        status: "IN_PROGRESS"
        gate_card:
          checks: [{id: "G2.2-01", status: "pass"}]
          all_pass: true
```

---

## Step 2: Load Context

Read `{impact_map_output}` to understand:
- The business goal (provides context for event scope)
- Key actors (who triggers events)
- Key deliverables (what capabilities are expected)

---

## Step 3: Identify Domain Events (Orange Stickies)

**Agent guides the user to identify all domain events — things that happen in the domain.**

Explain the concept:

> "Domain events are things that *happened* in the past — facts that are relevant to the business. They are always phrased in past tense."
>
> "Example: 'User Registered', 'Order Placed', 'Payment Processed', 'Shipment Delivered'"

Guide the user to brainstorm events by asking:

1. **What significant things happen in this domain?** (Start broad)
2. **What triggers these events?** (Work backwards)
3. **What follows from these events?** (Work forwards)
4. **What events do actors from the Impact Map cause?**

Collect events without worrying about order initially. Then organize them chronologically.

Add to `{event_storming_output}`:

```markdown
# Event Storming Board

## Domain Events (Orange)

*Chronological timeline of domain events*

| # | Event (Past Tense) | Triggered By | Business Significance |
|---|-------------------|-------------|----------------------|
| 1 | {event} | {actor or preceding event} | {why this matters} |
| 2 | {event} | ... | ... |
...
```

**Validation:** Do we have at least 5-10 events covering the core domain? Is the timeline logical?

---

## Step 4: Identify Commands (Blue Stickies)

For each domain event, ask:

> "What command (action) caused this event? Who initiates it?"

Commands are imperative: "Register User", "Place Order", "Process Payment".

Add to output:

```markdown
## Commands (Blue)

| Command | Causes Event | Initiated By | Required Data |
|---------|-------------|-------------|---------------|
| {command} | {event #} | {actor} | {data needed} |
...
```

---

## Step 5: Identify Aggregates (Yellow Stickies)

For clusters of related events and commands, ask:

> "What is the thing these events happen to? What is the 'noun' that groups them?"

Aggregates are the core domain objects: "User", "Order", "Payment", "Shipment".

Add to output:

```markdown
## Aggregates (Yellow)

| Aggregate | Events It Produces | Key Business Rules |
|-----------|-------------------|-------------------|
| {aggregate} | {list of event #s} | {invariants / rules} |
...
```

---

## Step 6: Identify Bounded Contexts

Group aggregates into bounded contexts — cohesive areas with their own ubiquitous language.

For each context, define:
- **Name** — e.g., "User Management", "Order Processing", "Payment"
- **Aggregates** — which aggregates belong
- **Language** — any domain-specific terminology

Add to output:

```markdown
## Bounded Contexts

### {Context Name}
- **Aggregates:** {list}
- **Events:** {list of event #s}
- **Domain Language:** {key terms and their meanings}
- **Relationships:** {upstream/downstream to other contexts}

...
```

Create a context map:

```markdown
## Context Map

┌──────────────────┐     ┌──────────────────┐
│  {Context A}     │────>│  {Context B}     │
│                  │ U/D │                  │
└──────────────────┘     └──────────────────┘
         │
         │ P/S
         ▼
┌──────────────────┐
│  {Context C}     │
│                  │
└──────────────────┘

Legend: U/D = Upstream/Downstream, P/S = Partnership/Shared Kernel
```

---

## Step 7: Identify Hotspots (Purple Stickies)

Mark areas of uncertainty, disagreement, or risk:

> "What are we unsure about? Where might there be disagreement? What requires further research?"

Add to output:

```markdown
## Hotspots (Purple)

| # | Hotspot | Context | Severity | Resolution Approach |
|---|---------|---------|----------|-------------------|
| H1 | {description} | {context} | high / medium | {how to resolve} |
...
```

---

## Step 8: Verify and Lock

Present the complete Event Storming board:

> "Here's the Event Storming board. Let's verify:
> 1. The event timeline covers the full domain scope
> 2. Every event has a command and belongs to an aggregate
> 3. Bounded contexts are coherent and well-named
> 4. Hotspots are identified with resolution approaches
> 5. The board aligns with the Impact Map's actors and goals
>
> Does this look accurate? [Approve / Revise]"

Transition: `EVENTS_IDENTIFIED` → `CONTEXTS_MAPPED` → `VERIFIED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_2:
    substates:
      phase_2_2:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "EVENTS_IDENTIFIED", at: "{ISO}" }
          - { state: "CONTEXTS_MAPPED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "event_storm", path: "{event_storming_output}", status: "locked" }
        gate_card:
          all_pass: true
```

---

## Step 9: Completion

Present summary:

> "Phase 2.2 complete — Event Storming board locked. Artifact: `{event_storming_output}`."
>
> "Summary: {N} events, {M} commands, {K} aggregates across {C} bounded contexts. {H} hotspots flagged."

Return to the Phase 2 sub-phase menu.
