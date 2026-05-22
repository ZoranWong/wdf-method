---
sub_workflow: "1-2-domain-research"
phase: 1
sub_phase: "1.2"
version: "3.6.0"
title: "Phase 1.2 — Domain Research"
description: "Conduct domain research using BMAD's domain research skill to understand the problem space, market context, competitors, and best practices before requirements gathering."
dependencies: []
methodology: "BMAD Domain Research"
bmad_skill: "/bmad-domain-research"
---

# Phase 1.2 — Domain Research

**Sub-Phase Goal:** Conduct structured domain research to understand the problem space, market landscape, competitive offerings, regulatory requirements, and industry best practices. This research informs all downstream analysis and design decisions.

**Why This Matters:** Skipping domain research leads to reinventing wheels, missing competitive insights, and designing solutions that don't fit the market. This phase ensures your solution is informed by what already exists and what works.

**Duration:** One session. Runs once, then transitions to LOCKED or SKIPPED.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | User selects sub-phase | `IN_PROGRESS` | Begin domain research |
| `NOT_STARTED` | User chooses to skip | `SKIPPED` | Sub-phase bypassed |
| `IN_PROGRESS` | BMAD research skill invoked | `RESEARCHING` | Research in progress |
| `RESEARCHING` | Findings documented | `FINDINGS_DOCUMENTED` | Output file created |
| `FINDINGS_DOCUMENTED` | User verifies findings | `VERIFIED` | Findings reviewed and confirmed |
| `VERIFIED` | User locks artifact | `LOCKED` | Research becomes read-only |

**SKIPPED state:** This sub-phase is skippable. When the user elects to skip, the state transitions from `NOT_STARTED` to `SKIPPED`. The user is asked at the gate whether they want to conduct domain research. Skipping is a valid terminal state; domain research may already be complete or the project may have clear domain knowledge.

---

## Gate Card

```yaml
gate_card:
  phase: 1
  sub_phase: "1.2"
  enters_from: null
  checks:
    - id: "G1.2-01"
      description: "User confirms readiness for domain research (or chooses to skip)"
      type: "user_confirmation"
  all_pass: false
```

---

## Step 1: Gate Card Check

Present to the user:

> "Phase 1.2: Domain Research. We'll research the problem domain — competitors, market landscape, technical best practices, regulatory considerations. This ensures we build something informed rather than guessing."
>
> "Do you want to run domain research? [Y] Yes, research the domain [N] Skip"

**If user chooses Skip:**

Transition: `NOT_STARTED` → `SKIPPED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_1:
    substates:
      phase_1_2:
        status: "SKIPPED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "SKIPPED", at: "{ISO}", reason: "User opted out" }
        gate_card:
          checks: [{id: "G1.2-01", status: "fail", note: "User skipped"}]
          all_pass: false
```

> "Domain research skipped. Proceeding to Phase 1.3: Product Brief."

Return to the Phase 1 sub-phase menu.

**If user opts in:**

Transition: `NOT_STARTED` → `IN_PROGRESS`.

Record in `{sprint_tracking}`:

```yaml
phases:
  phase_1:
    substates:
      phase_1_2:
        status: "IN_PROGRESS"
        gate_card:
          checks: [{id: "G1.2-01", status: "pass"}]
          all_pass: true
```

---

## Step 2: Define Research Scope

Before invoking the BMAD research skill, clarify what to research:

> "What specific areas should we research? For example:"
>
> "1. Competitors — who else solves this problem and how?"
> "2. Market landscape — trends, size, growth, segments"
> "3. Technical domain — common architectures, tools, patterns in this space"
> "4. Regulatory/compliance — legal requirements, data privacy, industry standards"
> "5. User behavior — known UX patterns, common pain points in this domain"
>
> "Which areas are most important for this project?"

Capture the user's priorities for the research scope.

---

## Step 3: Invoke BMAD Domain Research Skill

Invoke: `/bmad-domain-research`

**Instructions to pass to the skill:**

- Research the defined scope areas based on user priorities.
- Focus on practical, actionable findings — not academic literature.
- For each area, produce: current state, key insights, implications for our project.
- Output to `{domain_research_output}` (typically `_bmad-output/web-dev-flow/analysis/domain-research.md`).
- Frontmatter must include `artifact_type: "domain_research"`, `phase: 1`, `sub_phase: "1.2"`, `status: "draft"`.

Transition: `IN_PROGRESS` → `RESEARCHING`.

---

## Step 4: Review Research Output

After the BMAD skill completes, the agent verifies the output exists and is structured.

Expected structure of `{domain_research_output}`:

```markdown
# Domain Research: {project_name}

## 1. Competitive Landscape
### Direct Competitors
| Competitor | Description | Strengths | Weaknesses | Key Takeaway |
|------------|-------------|-----------|------------|--------------|
| ... | ... | ... | ... | ... |

### Indirect Competitors
...

### Competitive Positioning
...

## 2. Market Landscape
- Market size / TAM
- Growth trends
- Key segments
- User expectations

## 3. Technical Domain Analysis
- Common architectures
- Tool recommendations
- Integration patterns
- Performance considerations

## 4. Regulatory & Compliance
- Applicable regulations
- Data privacy requirements
- Industry standards
- Accessibility requirements

## 5. User Behavior & UX Patterns
- Established interaction patterns
- Common pain points
- Expected features

## 6. Key Insights & Implications
- Top {N} insights
- Implications for our project
- Risks to watch
```

Transition: `RESEARCHING` → `FINDINGS_DOCUMENTED`.

---

## Step 5: Verify and Lock

Present the research summary to the user:

> "Domain research complete. Key findings:"
>
> "- {N} competitors analyzed"
> "- {M} market insights captured"
> "- {K} technical recommendations"
> "- {R} regulatory considerations identified"
>
> "The full research is at `{domain_research_output}`."
>
> "Does this look accurate and complete? [Approve / Revise]"

**Approve:** Transition `FINDINGS_DOCUMENTED` → `VERIFIED` → `LOCKED`.

Update research output frontmatter:

```yaml
status: "locked"
locked_at: "{ISO_TIMESTAMP}"
```

Update `{sprint_tracking}`:

```yaml
phases:
  phase_1:
    substates:
      phase_1_2:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "RESEARCHING", at: "{ISO}" }
          - { state: "FINDINGS_DOCUMENTED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "domain_research", path: "{domain_research_output}", status: "locked" }
        gate_card:
          all_pass: true
```

**Revise:** Return to Step 3 or 4 for edits.

---

## Step 6: Completion

Present summary:

> "Phase 1.2 complete — Domain Research LOCKED."
>
> "Key artifact: `{domain_research_output}`"
>
> "Summary: {N} competitors analyzed, {M} market insights, {K} technical recommendations."
>
> "The domain research will inform the Product Brief (1.3) and Impact Mapping (1.4)."

Return to the Phase 1 sub-phase menu.
