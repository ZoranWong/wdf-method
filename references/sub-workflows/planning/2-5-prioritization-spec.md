---
sub_workflow: "2-5-prioritization-spec"
phase: 2
sub_phase: "2.5"
version: "3.6.0"
title: "Phase 2.5 — Kano + RICE + PRD"
description: "Prioritize stories using Kano Model classification and RICE scoring. Synthesize analysis from all previous sub-phases into a comprehensive Product Requirements Document (PRD). Includes methodology-agnostic essentials section and quality checklist."
dependencies: ["story-map.md", "jtbd-cards.md (optional)", "event-storm.md (optional)"]
methodologies: ["Kano Model by Noriaki Kano", "RICE Scoring by Sean McBride / Intercom"]
bmad_skills:
  - "/bmad-create-prd"
---

# Phase 2.5 — Kano + RICE + PRD

**Sub-Phase Goal:** Apply Kano Model classification to categorize stories, use RICE scoring to prioritize them numerically, and synthesize everything from all analysis sub-phases into a comprehensive PRD.

**Why This Matters:** Prioritization frameworks prevent feature bias. Kano ensures we balance delighters with basics. RICE provides objective scoring. The PRD is the system of record that all subsequent phases reference.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin prioritization |
| `IN_PROGRESS` | Kano classification complete | `KANO_COMPLETE` | Stories categorized |
| `KANO_COMPLETE` | RICE scores assigned | `RICE_COMPLETE` | Stories scored |
| `RICE_COMPLETE` | PRD drafted via bmad-create-prd | `PRD_DRAFTED` | PRD produced |
| `PRD_DRAFTED` | User verifies and approves | `APPROVED` | PRD accepted |
| `APPROVED` | User locks artifact | `LOCKED` | PRD locked |

---

## Gate Card

```yaml
gate_card:
  phase: 2
  sub_phase: "2.5"
  enters_from: "2.4"
  checks:
    - id: "G2.5-01"
      description: "Story Map is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_2.substates.phase_2_4.status"
      operator: "eq"
      expected: "LOCKED"
  all_pass: false
```

---

## Step 1: Gate Card Check

Verify that the Story Map (Phase 2.4) is LOCKED:

> "Checking prerequisites: Phase 2.4 (Story Mapping) status..."

If 2.4 is not LOCKED, HALT: "Phase 2.4 must be complete before prioritization can begin."

Record the gate check:

```yaml
phases:
  phase_2:
    substates:
      phase_2_5:
        status: "IN_PROGRESS"
        gate_card:
          checks: [{id: "G2.5-01", status: "pass"}]
          all_pass: true
```

---

## Step 2: Load Context

Read:
- `{story_map_output}` — story list with release slices
- `{impact_map_output}` — goals, actors, deliverables
- `{jtbd_cards_output}` (if Phase 2.3 completed) — job priorities
- `{event_storming_output}` (if Phase 2.2 completed) — domain insights

---

## Step 3: Kano Model Classification

**Agent guides the user through Kano classification for stories in the MVP slice (Release 1).**

Explain the Kano categories:

| Category | Definition | Example | Strategy |
|----------|-----------|---------|----------|
| **Must-be (Basic)** | Expected — absence causes dissatisfaction, presence does NOT increase satisfaction | Login, data persistence, error handling | Ship or fail |
| **Performance (One-Dimensional)** | More is better — satisfaction proportional to how well it's done | Search speed, image quality, response time | Continuously improve |
| **Attractive (Delighter)** | Unexpected pleasure — presence increases satisfaction, absence does NOT decrease it | Animations, personalized recommendations, confetti | Include selectively |
| **Indifferent** | Users don't care either way | Non-standard analytics, rarely-used admin features | Remove or de-scope |
| **Reverse** | Users actively dislike this | Forced email notifications, auto-playing video | Remove |

For each story in the MVP slice, ask the Kano question pair:

> **Functional form:** "If the product had [{story feature}], how would you feel?"
> - I like it
> - I expect it
> - I am neutral
> - I can tolerate it
> - I dislike it
>
> **Dysfunctional form:** "If the product did NOT have [{story feature}], how would you feel?"
> - I like it
> - I expect it
> - I am neutral
> - I can tolerate it
> - I dislike it

Map the answers to the Kano evaluation table (standard 5x5 matrix) and classify.

Add to `{prioritization_output}`:

```markdown
# Kano + RICE Prioritization

## Kano Classification

| Story | Functional Answer | Dysfunctional Answer | Kano Category |
|-------|------------------|---------------------|---------------|
| {story ID} | {answer} | {answer} | {category} |
...

## Kano Distribution Summary

| Category | Count | Strategy |
|----------|-------|----------|
| Must-be (Basic) | {N} | Required for launch |
| Performance | {N} | Invest in quality |
| Attractive (Delighter) | {N} | Choose 1-2 for MVP |
| Indifferent | {N} | Consider removing |
| Reverse | {N} | Remove now |
```

---

## Step 4: RICE Scoring

**Agent guides RICE scoring for MVP stories.**

For each story in the MVP slice, ask the four RICE questions:

### Reach

> "How many users will this story affect in a given time period (e.g., per month)?"
>
> Use actual numbers or estimates: 100, 500, 1000, 5000, etc.

### Impact

> "How much will this story move the needle for the user? Use a scale:"
>
> - **3.0 = Massive impact** — fundamental behavior change
> - **2.0 = High impact** — significant improvement
> - **1.0 = Medium impact** — noticeable improvement
> - **0.5 = Low impact** — minor improvement
> - **0.25 = Minimal impact** — barely noticeable

### Confidence

> "How confident are we in these estimates? Use percentages:"
>
> - **100% = High confidence** — we have data or user research
> - **80% = Medium confidence** — informed estimate
> - **50% = Low confidence** — best guess
> - **20% = Moonshot** — speculative

### Effort

> "How much engineering effort, in person-months? Include design, dev, testing, deployment."
>
> Use fractional months: 0.5, 1, 2, 3, 6, etc.

**Calculate RICE score:** `(Reach × Impact × Confidence) / Effort`

Add to output:

```markdown
## RICE Scores

| Story | Reach | Impact (0.25-3.0) | Confidence (%) | Effort (person-months) | RICE Score | Rank |
|-------|-------|-------------------|----------------|----------------------|------------|------|
| {story} | {N} | {X.X} | {Y}% | {Z} | {calculated} | {rank} |
...

## RICE Score Distribution

- Highest: {story} ({score})
- Median: {score}
- Lowest: {story} ({score})
```

---

## Step 5: Kano-RICE Synthesis

Combine Kano classification with RICE scores to produce a final priority:

```markdown
## Kano-RICE Priority Matrix

| Priority | Story | Kano Category | RICE Score | Rationale |
|----------|-------|--------------|------------|-----------|
| P0 - Launch Blocking | {story} | Must-be | {score} | Must-be stories ship regardless of RICE |
| P1 - High Priority | {story} | Performance | {score} | High RICE performance stories |
| P2 - Medium Priority | {story} | Performance | {score} | Medium-value performance stories |
| P3 - Nice to Have | {story} | Attractive | {score} | Delighters for post-MVP |
| Remove | {story} | Indifferent / Reverse | - | Not adding value |
```

**Rules:**
1. All **Must-be** stories are P0 (blocking), regardless of RICE score
2. **Reverse** and **Indifferent** stories should be removed or heavily re-scoped
3. Among **Performance** and **Attractive** stories, sort by RICE score
4. For the MVP, select the top-performing stories that complete the walking skeleton

---

## Step 6: PRD Generation

**Agent invokes `/bmad-create-prd` using all analysis artifacts as input context:**

Pass the following context to the BMAD skill:
- Impact Map (`impact_map_output`)
- Kano classification and RICE scores (`prioritization_output`)
- Story Map with release slices (`story_map_output`)
- JTBD cards (if available)
- Event Storming board (if available)

The BMAD skill will produce a PRD at `{prd_output}`. The agent should verify it includes:

### PRD Content Verification

After the BMAD skill produces the PRD, verify it includes:

```markdown
## Required PRD Sections

- [ ] **Executive Summary** — Problem, solution vision, target audience
- [ ] **Goals & Success Metrics** — From Impact Map SMART goal
- [ ] **User Personas** — From Impact Map actors + JTBD analysis
- [ ] **User Journey** — From Story Map backbone
- [ ] **Feature List (Prioritized)** — From Kano-RICE synthesis
- [ ] **Release Plan** — From Story Map slices
- [ ] **Scope Boundaries** — What's in vs out for MVP
- [ ] **Non-Functional Requirements** — Performance, security, accessibility
- [ ] **Dependencies & Risks** — From Event Storming hotspots
- [ ] **Assumptions & Open Questions**
```

If any section is missing, prompt the BMAD skill or the user to fill it in.

---

### Methodology-Agnostic Essentials

Regardless of the specific methodologies used in prior sub-phases, every PRD MUST contain these essential sections:

```markdown
## Methodology-Agnostic PRD Essentials

### 1. Project Name & Version
- Clear, unique project identifier
- PRD version with date and author

### 2. Problem Statement
- What problem are we solving?
- Who experiences this problem?
- What evidence validates this problem exists? (user research, data, market analysis)

### 3. Solution Overview
- High-level description of the solution
- Key differentiators from alternatives
- Core value proposition

### 4. Target Audience
- Primary and secondary user personas
- Key user characteristics, needs, and pain points

### 5. Success Criteria
- Measurable success metrics (OKRs or similar)
- Baseline (current state) vs Target (desired state)
- How success will be measured and tracked

### 6. Feature Scope
- Complete feature list with priorities (must-have, should-have, could-have, won't-have)
- Feature dependencies and sequencing constraints
- Explicitly stated out-of-scope items

### 7. User Experience Overview
- Key user flows (happy path)
- Critical user interactions
- Platform/browser support requirements

### 8. Technical Constraints & Assumptions
- Platform, language, framework preferences
- Integration requirements
- Infrastructure/deployment assumptions
- Third-party dependencies

### 9. Timeline & Milestones
- High-level release plan
- Key milestones and checkpoints
- Dependencies on external teams or systems

### 10. Risks & Mitigations
- Identified risks (technical, market, resource)
- Mitigation strategies
- Contingency plans

### 11. Stakeholders
- Key decision-makers and approvers
- Team composition
- Communication plan
```

The agent MUST verify that each of these 11 sections is present and substantively filled. Empty sections or single-line placeholders are not acceptable. If the BMAD skill output is missing any section, the agent adds it by synthesizing information from upstream artifacts.

---

## Step 7: PRD Quality Checklist

After the PRD is drafted, run this quality checklist:

```yaml
prd_quality_checklist:
  - check: "SMART goal from Impact Map is reflected in Success Criteria"
    source: "{impact_map_output}"
  - check: "All actors from Impact Map appear as personas in the PRD"
    source: "{impact_map_output}"
  - check: "Story Map backbone is reflected in User Journey section"
    source: "{story_map_output}"
  - check: "Kano-RICE priorities match the Feature List ordering"
    source: "{prioritization_output}"
  - check: "No orphan features (features not traced to any analysis artifact)"
  - check: "MVP scope is clearly defined and minimal"
  - check: "All 11 methodology-agnostic essential sections are present and filled"
  - check: "No contradictions between sections (e.g., feature in scope but not in release plan)"
  - check: "PRD frontmatter follows artifact-frontmatter-schema"
```

Present the checklist results:

> "PRD Quality Checklist:"
> "[x] 9 of 9 checks passed"
> or
> "[x] 7 of 9 checks passed — 2 issues need attention: ..."

---

## Step 8: Verify and Lock

Present the final PRD and prioritization results for approval:

> "Here's the complete PRD with Kano-RICE prioritization. Key outputs:"
> "- PRD at `{prd_output}`"
> "- Kano-RICE scores at `{prioritization_output}`"
> "- MVP scope: {N} stories (P0: {M}, P1: {K})"
> "- Estimated effort (MVP): {X} person-months"
>
> "The traceability chain is: Impact Map → Story Map → Kano-RICE → PRD."
> "All features trace back to the original business goal."
>
> "Does this look complete and correct? [Approve / Revise]"

Transition: `KANO_COMPLETE` → `RICE_COMPLETE` → `PRD_DRAFTED` → `APPROVED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_2:
    substates:
      phase_2_5:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "KANO_COMPLETE", at: "{ISO}" }
          - { state: "RICE_COMPLETE", at: "{ISO}" }
          - { state: "PRD_DRAFTED", at: "{ISO}" }
          - { state: "APPROVED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "prioritization", path: "{prioritization_output}", status: "locked" }
          - { type: "prd", path: "{prd_output}", status: "locked" }
        gate_card:
          all_pass: true
```

**Phase 2 Lock:** When all sub-phases that were NOT skipped are LOCKED, lock Phase 2 as a whole:

```yaml
phases:
  phase_2:
    status: "LOCKED"
    locked_at: "{ISO}"
```

---

## Step 9: Completion

Present summary:

> "Phase 2.5 complete — Kano-RICE prioritization locked and PRD approved."
>
> "Artifacts: `{prioritization_output}`, `{prd_output}`"
>
> "Traceability: {N} stories traced from PRD → Story Map → Impact Map goal."
>
> "MVP scope: {M} stories prioritized (P0: {X}, P1: {Y}), estimated {Z} person-months."
>
> "Next: Phase 3 — Epics & Feature Plan, where we'll organize stories into epics."

Return to the Phase 2 sub-phase menu. Phase 2 is now LOCKED and ready for Phase 3.
