---
sub_workflow: "3-1-system-context"
phase: 3
sub_phase: "3.1"
version: "3.6.0"
title: "Phase 3.1 — System Context (C4 Level 1)"
description: "Define the System Context diagram (C4 Level 1) showing the system and its external actors, external system integrations, and data flows at the highest level of abstraction."
dependencies:
  - prd.md
methodology: "C4 Model by Simon Brown (Level 1)"
---

# Phase 3.1 — System Context (C4 Level 1)

**Sub-Phase Goal:** Create a System Context diagram that shows the software system being built and how it fits into the world — external users, external systems, and data flow direction.

**Why This Matters:** The System Context is the "50,000 foot view." It establishes the system boundary — what's inside (we build it) and what's outside (we integrate with it). This prevents scope creep and ensures integration points are identified early.

**Duration:** This sub-phase continues until the context diagram is drafted, verified, and locked.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin system context definition |
| `IN_PROGRESS` | Context diagram drafted | `CONTEXT_MAPPED` | All external actors and systems identified |
| `CONTEXT_MAPPED` | User verifies | `VERIFIED` | Context accuracy confirmed |
| `VERIFIED` | User locks | `LOCKED` | System context artifact locked |

---

## Gate Card

```yaml
gate_card:
  phase: 3
  sub_phase: "3.1"
  enters_from: null
  checks:
    - id: "G3.1-01"
      description: "PRD is APPROVED or LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_2.status"
      operator: "eq"
      expected: "LOCKED"
    - id: "G3.1-02"
      description: "User confirms readiness to start architecture"
      type: "user_confirmation"
  all_pass: false
```

---

## Step 1: Gate Card Check

Verify Phase 2 (Planning) is LOCKED:

> "Checking prerequisites: Phase 2 (Planning) status..."

If Phase 2 is not LOCKED, HALT: "Phase 2 must be LOCKED before solutioning can begin."

Record the gate check in `{sprint_tracking}`:

```yaml
phases:
  phase_3:
    substates:
      phase_3_1:
        status: "IN_PROGRESS"
        gate_card:
          checks:
            - {id: "G3.1-01", status: "pass"}
            - {id: "G3.1-02", status: "pass"}
          all_pass: true
```

---

## Step 2: Load Context

Read `{prd_output}` for:
- Feature list (what the system must do)
- Integration requirements (third-party services)
- User personas (who interacts with the system)
- Non-functional requirements (performance, security constraints)

---

## Step 3: Identify the System

Define what "the system" is — give it a clear name and boundary statement:

> "What is the name of this software system? What is its primary responsibility — the one thing it exists to do?"

Capture:

```markdown
## System Definition

**System Name:** {system name}
**Primary Responsibility:** {one-sentence description of what the system does}
**System Boundary:** {what is INSIDE the system vs what is OUTSIDE}
```

---

## Step 4: Identify External Actors (People)

Identify all **people** (users, roles, personas) who interact with the system.

For each actor, capture:

```markdown
## People (External Actors)

| Actor | Role | Type | Interaction |
|-------|------|------|------------|
| {actor name} | {what they do} | End User / Admin / Support / etc. | {how they interact with the system} |
```

All actors identified in the PRD's persona section should appear here. Add any additional actors discovered during architecture analysis.

---

## Step 5: Identify External Systems

Identify all **external software systems** the system integrates with.

For each external system, capture:

```markdown
## External Systems

| System | Purpose | Protocol/Method | Data Direction | Criticality |
|--------|---------|----------------|----------------|-------------|
| {system name} | {why we integrate} | REST / GraphQL / Message Queue / File Transfer | IN / OUT / BIDIRECTIONAL | high / medium / low |
```

---

## Step 6: Create the System Context Diagram

Create an ASCII-art diagram showing the system at the center with all actors and external systems:

```markdown
## System Context Diagram (C4 Level 1)

┌─────────────────────────────────────────────────────┐
│                                                     │
│  ┌──────────┐                    ┌──────────┐       │
│  │  {Actor} │                    │  {Actor} │       │
│  └─────┬────┘                    └─────┬────┘       │
│        │ Uses                          │ Uses        │
│        ▼                               ▼            │
│  ┌─────────────────────────────────────────────┐    │
│  │                                             │    │
│  │            {System Name}                    │    │
│  │          [Software System]                  │    │
│  │                                             │    │
│  │  {Brief description of what the system     │    │
│  │   does and its primary responsibility}      │    │
│  │                                             │    │
│  └──────┬──────────────────────┬───────────────┘    │
│         │ Sends data to        │ Gets data from      │
│         ▼                      ▼                     │
│  ┌────────────┐        ┌──────────────┐             │
│  │  {External │        │  {External   │             │
│  │   System}  │        │   System}    │             │
│  └────────────┘        └──────────────┘             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Step 7: Document Integration Points

For each external system, detail the integration:

```markdown
## Integration Details

### {External System Name}

- **Purpose:** {why we integrate with this system}
- **Protocol:** {REST, GraphQL, gRPC, Message Queue, Webhook, File Transfer}
- **Direction:** {System → External / External → System / Bidirectional}
- **Data:** {what data flows between systems}
- **Authentication:** {how we authenticate — API key, OAuth2, mTLS, etc.}
- **Resilience:** {what happens if unavailable — retry, circuit breaker, graceful degradation?}
- **Rate Limits:** {any known limits or quotas}
- **SLA/Reliability:** {uptime requirements, data freshness requirements}
```

Add to `{system_context_output}`.

---

## Step 8: Verify and Lock

Present the complete System Context diagram for review:

> "Here's the System Context diagram (C4 Level 1). Let's verify:
> 1. All people/actors from the PRD are represented
> 2. All external system integrations are identified
> 3. Data flow direction is correct for every connection
> 4. The system boundary is clearly defined
> 5. No integration points are missing
>
> Does this accurately represent the system? [Approve / Revise]"

Transition: `CONTEXT_MAPPED` → `VERIFIED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_3:
    substates:
      phase_3_1:
        status: "LOCKED"
        artifacts:
          - { type: "system_context", path: "{system_context_output}", status: "locked" }
```

---

## Step 9: Completion

Present summary:

> "Phase 3.1 complete — System Context locked. Artifact: `{system_context_output}`."
>
> "Summary: {N} external actors, {M} external systems, {K} integration points identified."

Return to the Phase 3 sub-phase menu.
