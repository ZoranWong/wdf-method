---
sub_workflow: "2-3-jobs-to-be-done"
phase: 2
sub_phase: "2.3"
version: "3.6.0"
title: "Phase 2.3 — Jobs to Be Done"
description: "Apply Jobs to Be Done (JTBD) methodology to understand user motivations at a deep level. For each persona, capture the situation, motivation, and expected outcome across functional, emotional, and social dimensions."
dependencies: ["impact-map.md"]
methodology: "Jobs to Be Done by Clayton Christensen / Tony Ulwick"
skip_allowed: true
---

# Phase 2.3 — Jobs to Be Done

**Sub-Phase Goal:** For each persona identified in the Impact Map, create JTBD cards that capture: the situation that triggers the job, the motivation for doing it, and the expected outcome. Classify each job across functional, emotional, and social dimensions.

**Why This Matters:** JTBD reveals *why* users care — not just what they do. It moves us from feature-thinking to outcome-thinking, ensuring we solve real user problems.

**Recommended For:** When user motivations need deep exploration. Skip when user needs are already well-understood.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin JTBD analysis |
| `NOT_STARTED` | User chooses skip | `SKIPPED` | Sub-phase not needed |
| `IN_PROGRESS` | All job statements drafted | `JOBS_IDENTIFIED` | Jobs captured per persona |
| `JOBS_IDENTIFIED` | Dimensions mapped | `DIMENSIONS_MAPPED` | Functional/emotional/social analysis complete |
| `DIMENSIONS_MAPPED` | User verifies cards | `VERIFIED` | Cards confirmed |
| `VERIFIED` | User locks artifact | `LOCKED` | JTBD cards locked |

---

## Gate Card

```yaml
gate_card:
  phase: 2
  sub_phase: "2.3"
  enters_from: "2.1"
  checks:
    - id: "G2.3-01"
      description: "Skip prompt — proceed or skip this sub-phase"
      type: "user_confirmation"
  all_pass: false
```

---

## Step 0: Skip Decision

Before entering, present the skip prompt:

> "This sub-phase is recommended when user motivations need deep exploration. For well-understood user needs, you may skip."
>
> "Proceed with Jobs to Be Done? [Y] Proceed [S] Skip"

If user chooses **Skip**:

Update `{sprint_tracking}`:

```yaml
phases:
  phase_2:
    substates:
      phase_2_3:
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
      phase_2_3:
        status: "IN_PROGRESS"
        gate_card:
          checks: [{id: "G2.3-01", status: "pass"}]
          all_pass: true
```

---

## Step 2: Load Personas from Impact Map

Read `{impact_map_output}`. Extract all actors from the Impact Map. These become the personas for JTBD analysis.

List the personas to the user:

> "Based on the Impact Map, our key personas are: [list of actors]. We'll explore the Jobs to Be Done for each."

---

## Step 3: JTBD Interview Framework (Per Persona)

**Agent guides the user through JTBD discovery for each persona.**

For each persona, follow this interview framework:

### 3a. Identify the Job Executor

> "For [{persona}], let's understand their Jobs to Be Done. A 'job' is the progress they're trying to make in a given circumstance."

### 3b. Discover Jobs Using the JTBD Prompt

For each potential job, ask:

> "Think about [{persona}]. When [situation/context], what are they trying to accomplish? What would a successful outcome look like?"

Frame each job using the standard JTBD statement format:

```
When [SITUATION],
I want to [MOTIVATION],
so I can [EXPECTED OUTCOME].
```

Example:
```
When I receive a notification that my package was delivered,
I want to confirm it arrived undamaged,
so I can feel confident my purchase is complete.
```

### 3c. Probe for Hidden Jobs

Ask probing questions to discover non-obvious jobs:

- "What's the last thing [{persona}] does before starting this job?"
- "What's the first thing they do after completing it?"
- "What frustrates them about how they currently do this?"
- "What workarounds have they created?"

### 3d. Capture Jobs

For each persona, add to `{jtbd_cards_output}`:

```markdown
# Jobs to Be Done Cards

## Persona: {persona name}

### Job {N}: {short title}

**Job Statement:**
When [{situation}],
I want to [{motivation}],
so I can [{expected outcome}].

**Current Solution:** {how they currently do this}
**Pain Points:** {frustrations with current solution}
**Success Metrics:** {how they measure success}
```

---

## Step 4: Map Functional, Emotional, and Social Dimensions

For each identified job, classify the dimensions:

| Dimension | Question | Example |
|-----------|----------|---------|
| **Functional** | What practical task needs to be done? | "Transfer money between accounts" |
| **Emotional** | How does the user want to feel? | "Feel in control of finances" |
| **Social** | How does the user want to be perceived? | "Be seen as financially responsible" |

Ask the user for each job:

> "For Job '{job title}':
> - What's the functional need? (the practical task)
> - What's the emotional need? (how they want to feel)
> - What's the social need? (how they want to be perceived)"

Add dimensions to each job card:

```markdown
### Dimensions

| Dimension | Description |
|-----------|-------------|
| Functional | {practical task} |
| Emotional | {desired feeling} |
| Social | {desired perception} |
```

---

## Step 5: Build Job Hierarchy

Organize jobs into a hierarchy:

- **Main Job** — The core job the persona is hiring the product for
- **Related Jobs** — Functional jobs that support the main job
- **Emotional Jobs** — Jobs related to feelings and perception
- **Consumption Chain Jobs** — Jobs across the full lifecycle (search, select, buy, use, maintain, dispose)

Add to output:

```markdown
## Job Hierarchy

### {Persona}

**Main Job:** {core job statement}

**Related Functional Jobs:**
- {job statement}
- {job statement}

**Emotional Jobs:**
- {job statement}

**Social Jobs:**
- {job statement}

**Consumption Chain Jobs:**
1. Search: {job}
2. Evaluate: {job}
3. Purchase/Start: {job}
4. Use: {job}
5. Maintain: {job}
6. Exit/Dispose: {job}
```

---

## Step 6: Identify Competing Solutions

For each main job, ask:

> "What are [{persona}]'s current alternatives for getting this job done? This includes direct competitors, manual workarounds, and 'do nothing'."

Add to output:

```markdown
## Competing Solutions

| Job | Current Solution | Our Advantage |
|-----|-----------------|---------------|
| {job title} | {current alternative} | {why our solution is better} |
...
```

---

## Step 7: Verify and Lock

Present the complete JTBD cards for review:

> "Here are the Jobs to Be Done cards. Let's verify:
> 1. Each persona has at least one main job captured
> 2. Job statements follow the When/I want to/So I can format
> 3. Functional, emotional, and social dimensions are covered
> 4. A job hierarchy is established
> 5. Competing solutions are identified
>
> Do these accurately capture user motivations? [Approve / Revise]"

Transition: `JOBS_IDENTIFIED` → `DIMENSIONS_MAPPED` → `VERIFIED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_2:
    substates:
      phase_2_3:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "JOBS_IDENTIFIED", at: "{ISO}" }
          - { state: "DIMENSIONS_MAPPED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "jtbd_cards", path: "{jtbd_cards_output}", status: "locked" }
        gate_card:
          all_pass: true
```

---

## Step 8: Completion

Present summary:

> "Phase 2.3 complete — JTBD cards locked. Artifact: `{jtbd_cards_output}`."
>
> "Summary: {N} personas analyzed, {M} jobs identified across functional ({F}), emotional ({E}), and social ({S}) dimensions."

Return to the Phase 2 sub-phase menu.
