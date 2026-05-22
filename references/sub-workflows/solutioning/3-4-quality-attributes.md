---
sub_workflow: "3-4-quality-attributes"
phase: 3
sub_phase: "3.4"
version: "3.6.0"
title: "Phase 3.4 — Quality Attributes (ATAM-lite)"
description: "Analyze quality attribute requirements using a lightweight ATAM (Architecture Tradeoff Analysis Method) approach. Identify quality attribute scenarios, evaluate the architecture against them, and document sensitivity points, tradeoffs, and risks."
dependencies:
  - container-design.md
methodology: "ATAM-lite (based on SEI Architecture Tradeoff Analysis Method)"
skip_allowed: true
---

# Phase 3.4 — Quality Attributes (ATAM-lite)

**Sub-Phase Goal:** Identify key quality attribute scenarios (performance, security, availability, modifiability, testability, usability), evaluate the architecture against each, and document tradeoffs, sensitivity points, and risks.

**Why This Matters:** Functional requirements tell you WHAT the system does. Quality attributes tell you HOW WELL it does it. A system that works but is insecure, slow, or unmaintainable is a failed system.

**Recommended For:** Systems with significant non-functional requirements. Skip for simple applications or prototypes.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin quality analysis |
| `NOT_STARTED` | User skips | `SKIPPED` | Sub-phase not needed |
| `IN_PROGRESS` | Scenarios identified | `SCENARIOS_IDENTIFIED` | QA scenarios captured |
| `SCENARIOS_IDENTIFIED` | Architecture evaluated | `EVALUATED` | Tradeoffs documented |
| `EVALUATED` | User verifies | `VERIFIED` | Analysis confirmed |
| `VERIFIED` | User locks | `LOCKED` | QA report locked |

---

## Gate Card

```yaml
gate_card:
  phase: 3
  sub_phase: "3.4"
  enters_from: "3.3"
  checks:
    - id: "G3.4-01"
      description: "Container Design is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_3.substates.phase_3_3.status"
      operator: "eq"
      expected: "LOCKED"
  all_pass: false
```

---

## Step-by-Step Instructions

### Step 0 — Skip Decision

> "This sub-phase is recommended for systems with significant quality requirements. For simple applications, you may skip. Proceed? [Y/N]"

If skipped:

```yaml
phase_3_4: SKIPPED
```

---

### Step 1: Gate Card Check

Verify Phase 3.3 is LOCKED.

---

### Step 2: Load Architecture

Read `{container_design_output}` to understand the current architecture. This is what we will evaluate against quality attributes.

---

### Step 3: Identify Quality Attribute Scenarios

Present the standard quality attribute categories and generate scenarios:

#### 3a. Performance

```yaml
performance_scenarios:
  - id: "PERF-01"
    scenario: "Under normal load ({N} concurrent users), {operation} completes within {T}ms"
    source: "PRD non-functional requirements"
    stimulus: "{N} concurrent users performing {operation}"
    response: "{operation} completes"
    measure: "Response time < {T}ms, p95 < {T2}ms"
```

#### 3b. Security

```yaml
security_scenarios:
  - id: "SEC-01"
    scenario: "Unauthenticated user attempts to access protected resource"
    stimulus: "Unauthenticated request to protected endpoint"
    response: "401 Unauthorized with no data leakage"
    measure: "100% of unauthenticated requests rejected"

  - id: "SEC-02"
    scenario: "SQL injection attempt in user input field"
    stimulus: "Malicious SQL in input field"
    response: "Input rejected or sanitized; no SQL execution"
    measure: "0 successful injections (verified by security testing)"
```

#### 3c. Availability

```yaml
availability_scenarios:
  - id: "AVAIL-01"
    scenario: "Database connection fails during peak traffic"
    stimulus: "Database becomes unreachable"
    response: "Circuit breaker opens; degraded mode with cached data"
    measure: "System remains available (degraded); recovery < 30s after DB restored"

  - id: "AVAIL-02"
    scenario: "Single server instance crashes"
    stimulus: "Server process terminates unexpectedly"
    response: "Health check fails; traffic routed to healthy instances; new instance started"
    measure: "No user-visible downtime; instance replacement < 60s"
```

#### 3d. Modifiability

```yaml
modifiability_scenarios:
  - id: "MOD-01"
    scenario: "Add new payment provider (e.g., Stripe → PayPal)"
    stimulus: "Requirement to add new payment provider"
    response: "New provider class implements PaymentProvider interface"
    measure: "Change limited to one new file + registration; no existing code modified"
```

#### 3e. Testability

```yaml
testability_scenarios:
  - id: "TEST-01"
    scenario: "Run full test suite before deployment"
    stimulus: "Developer pushes code or CI trigger"
    response: "All tests execute and report results"
    measure: "Full suite < 5 minutes; coverage report generated"
```

#### 3f. Usability

```yaml
usability_scenarios:
  - id: "UX-01"
    scenario: "New user completes primary task without training"
    stimulus: "First-time user on landing page"
    response: "User guided through core workflow"
    measure: "90% of users complete primary task in < 3 minutes"
```

---

### Step 4: Evaluate Architecture Against Scenarios

For each scenario, evaluate how the current architecture satisfies it:

```markdown
## Architecture Evaluation

| Scenario ID | QA Category | Current Architecture Support | Risk Level | Mitigation |
|------------|-------------|------------------------------|------------|-----------|
| PERF-01 | Performance | {How architecture handles this} | Low/Med/High | {mitigation if needed} |
| SEC-01 | Security | {How architecture handles this} | Low/Med/High | {mitigation} |
| ... | ... | ... | ... | ... |
```

---

### Step 5: Identify Sensitivity Points and Tradeoffs

```markdown
## Sensitivity Points & Tradeoffs

### Sensitivity Points
*A sensitivity point is an architectural decision that significantly affects one quality attribute.*

| Sensitivity Point | Affected QA | Impact | Rationale |
|------------------|-------------|--------|-----------|
| Database choice | Performance, Availability | High | All reads/writes go through DB |
| Caching strategy | Performance, Consistency | High | Cache freshness vs response time |
| Monolith vs Microservices | Modifiability, Performance | High | Affects deployment + latency |

### Tradeoffs
*A tradeoff is a decision that improves one QA at the expense of another.*

| Tradeoff | Improved QA | Compromised QA | Justification |
|----------|------------|----------------|--------------|
| Eventual consistency | Availability, Performance | Consistency | Acceptable for non-critical data |
| Monolithic deployment | Simplicity, Performance | Modifiability | Team size justifies monolith |
| Denormalized reads | Performance (reads) | Consistency, Storage | Read-heavy workload |
```

---

### Step 6: Risk Assessment

```markdown
## Risk Assessment

| Risk ID | Risk | Likelihood | Impact | Mitigation | Residual Risk |
|---------|------|-----------|--------|-----------|--------------|
| R-01 | {risk description} | High/Med/Low | High/Med/Low | {mitigation strategy} | High/Med/Low |
| R-02 | ... | ... | ... | ... | ... |
```

---

### Step 7: Verify and Lock

Present the Quality Attributes report:

> "Here's the Quality Attributes analysis (ATAM-lite). Let's verify:
> 1. All critical quality attributes from the PRD are covered
> 2. Architecture evaluation is realistic (not optimistic)
> 3. Tradeoffs are explicitly acknowledged
> 4. Risks have clear mitigation strategies
> 5. Sensitivity points are documented for future reference
>
> Does this analysis look complete? [Approve / Revise]"

Update `{sprint_tracking}`:

```yaml
phases:
  phase_3:
    substates:
      phase_3_4:
        status: "LOCKED"
        artifacts:
          - { type: "quality_attributes", path: "{quality_attributes_output}", status: "locked" }
```

---

## Phase Complete

Present summary:

> "Phase 3.4 complete — Quality Attributes analysis locked. Artifact: `{quality_attributes_output}`."
>
> "Summary: {N} scenarios across {M} quality attributes, {K} risks identified, {T} tradeoffs documented."

Return to the Phase 3 sub-phase menu.
