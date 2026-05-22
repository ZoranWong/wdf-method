---
sub_workflow: "3-2-architecture-style"
phase: 3
sub_phase: "3.2"
version: "3.6.0"
title: "Phase 3.2 — Architecture Style Decision"
description: "Evaluate architecture style candidates against the system context and NFRs, produce an Architecture Decision Record (ADR), and lock the architectural style decision."
dependencies:
  - system-context.md
  - prd.md
methodology: "Architecture Decision Records (ADR) by Michael Nygard"
---

# Phase 3.2 — Architecture Style Decision

**Sub-Phase Goal:** Evaluate candidate architecture styles (Monolith, Microservices, Modular Monolith, Serverless, Event-Driven, etc.) against the system context and PRD requirements. Document the decision as an Architecture Decision Record (ADR).

**Why This Matters:** The architecture style is the most expensive decision to change later. An ADR captures the context, options considered, decision rationale, and consequences — creating an audit trail for future maintainers.

**Duration:** This sub-phase continues until the architecture style is selected, documented as an ADR, and locked.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin style evaluation |
| `IN_PROGRESS` | Candidates evaluated + decision made | `STYLE_SELECTED` | Architecture style chosen |
| `STYLE_SELECTED` | ADR drafted | `ADR_WRITTEN` | Decision documented |
| `ADR_WRITTEN` | User verifies ADR | `VERIFIED` | Decision confirmed |
| `VERIFIED` | User locks ADR | `LOCKED` | ADR-001 locked |

---

## Gate Card

```yaml
gate_card:
  phase: 3
  sub_phase: "3.2"
  enters_from: "3.1"
  checks:
    - id: "G3.2-01"
      description: "System Context is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_3.substates.phase_3_1.status"
      operator: "eq"
      expected: "LOCKED"
  all_pass: false
```

---

## Step 1: Gate Card Check

Verify Phase 3.1 (System Context) is LOCKED.

---

## Step 2: Load Context

Read `{system_context_output}` for system boundary and integration landscape. Read `{prd_output}` for non-functional requirements.

---

## Step 3: Architecture Style Candidates

Present the standard architecture style candidates with their trade-offs:

| Style | Best For | Trade-offs |
|-------|----------|-----------|
| **Monolith** | Small teams, simple domains, early-stage products | Harder to scale team; deployment coupling |
| **Modular Monolith** | Medium domains, growing teams, future microservices option | Requires discipline on module boundaries |
| **Microservices** | Large teams, complex domains, independent scaling needs | Operational complexity, network overhead |
| **Serverless** | Event-driven, variable load, cost-sensitive | Cold starts, vendor lock-in, debugging complexity |
| **Event-Driven** | Async workflows, loose coupling, real-time needs | Eventual consistency, complex debugging |
| **Hexagonal / Clean Architecture** | Domain-heavy apps, testability priority | More boilerplate, learning curve |
| **CQRS / Event Sourcing** | Audit trails, complex query needs, high throughput | Complexity, eventual consistency |

---

## Step 4: Evaluate Against System Context

For each candidate style that is plausible given the system context, evaluate:

```yaml
evaluation_criteria:
  - factor: "Team size and structure"
    weight: high
  - factor: "Domain complexity"
    weight: high
  - factor: "Integration landscape"
    weight: high
  - factor: "Scalability needs"
    weight: medium
  - factor: "Deployment constraints"
    weight: medium
  - factor: "Time to market"
    weight: medium
  - factor: "Operational maturity"
    weight: low
```

Score each candidate:

| Candidate | Team Fit | Domain Fit | Integration | Scalability | Deployment | Time | Overall |
|-----------|----------|------------|-------------|-------------|------------|------|---------|
| {Style A} | {score} | {score} | {score} | {score} | {score} | {score} | {score} |

---

## Step 5: Make the Decision

Select the architecture style with justification. Document as ADR-001 using the standard ADR template (`{adr_template}`):

```yaml
# ADR-001: Architecture Style

- **Status:** Proposed
- **Date:** {ISO date}
- **Deciders:** {decision makers}

## Context
{Describe the system context — what are we building, what are the constraints?}

## Decision
{State the selected architecture style and variant}

## Options Considered
{List the top 2-4 candidates evaluated}

## Rationale
{Why this style over the alternatives? Include trade-offs.}

## Consequences
### Positive
- {benefit 1}
- {benefit 2}

### Negative
- {trade-off 1}
- {trade-off 2}

### Mitigations
- {how we mitigate each negative consequence}

## References
- System Context (3.1)
- PRD
```

Add to `{architecture_style_output}`.

---

## Step 6: Verify and Lock

Present the ADR for review:

> "Here's the Architecture Decision Record (ADR-001). The recommended architecture style is: {selected style}."
>
> "Do you confirm this architecture decision? [Approve / Revise]"

Transition: `STYLE_SELECTED` → `ADR_WRITTEN` → `VERIFIED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_3:
    substates:
      phase_3_2:
        status: "LOCKED"
        artifacts:
          - { type: "architecture_style", path: "{architecture_style_output}", status: "locked" }
```

---

## Step 7: Completion

Present summary:

> "Phase 3.2 complete — Architecture style selected and documented. Artifact: `{architecture_style_output}` with ADR-001."

Return to the Phase 3 sub-phase menu.
