---
sub_workflow: "1-3-product-brief"
phase: 1
sub_phase: "1.3"
version: "3.6.0"
title: "Phase 1.3 — Product Brief"
description: "Produce a concise Product Brief using BMAD's product-brief agent. Synthesizes domain research and brainstorming into a one-page strategic summary that guides the entire project."
dependencies:
  - domain_research (Phase 1.2, if not skipped)
methodology: "BMAD Product Brief"
bmad_skill: "bmad product-brief agent"
---

# Phase 1.3 — Product Brief

**Sub-Phase Goal:** Produce a concise, one-page Product Brief that defines the product's strategic intent: target user, core problem, key differentiators, success metrics, and scope boundaries. This brief serves as the "north star" for all subsequent decisions.

**Why This Matters:** A clear product brief prevents scope creep, aligns stakeholders, and gives every team member a shared understanding of what we are building and why. It bridges the gap between open-ended research and structured requirements.

**Duration:** One session. Runs once, then transitions to LOCKED or SKIPPED.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | User selects sub-phase | `IN_PROGRESS` | Begin product briefing |
| `NOT_STARTED` | User chooses to skip | `SKIPPED` | Sub-phase bypassed |
| `IN_PROGRESS` | BMAD product-brief agent invoked | `BRIEFING` | Brief being generated |
| `BRIEFING` | Brief documented | `BRIEF_DOCUMENTED` | Output file created |
| `BRIEF_DOCUMENTED` | User verifies brief | `VERIFIED` | Brief reviewed and confirmed |
| `VERIFIED` | User locks artifact | `LOCKED` | Product brief becomes read-only |

**SKIPPED state:** This sub-phase is skippable. The user may already have a product brief from previous work, or the project may be sufficiently defined through other means. When skipped, state transitions directly from `NOT_STARTED` to `SKIPPED`.

---

## Gate Card

```yaml
gate_card:
  phase: 1
  sub_phase: "1.3"
  enters_from: null
  checks:
    - id: "G1.3-01"
      description: "User confirms readiness for product brief (or chooses to skip)"
      type: "user_confirmation"
  all_pass: false
```

---

## Step 1: Gate Card Check

Present to the user:

> "Phase 1.3: Product Brief. We'll create a one-page strategic brief that defines the product's purpose, target users, core problem, differentiators, and success metrics. This becomes the 'north star' for all subsequent design and development work."

If Phase 1.2 (Domain Research) is LOCKED, note:

> "We'll incorporate findings from your Domain Research ({domain_research_output})."

If Phase 1.1 (Brainstorming) is LOCKED, note:

> "We'll also reference brainstorm ideas from ({brainstorm_output})."

Then ask:

> "Do you want to create a Product Brief? [Y] Yes, let's define the product [N] Skip"

**If user chooses Skip:**

Transition: `NOT_STARTED` → `SKIPPED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_1:
    substates:
      phase_1_3:
        status: "SKIPPED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "SKIPPED", at: "{ISO}", reason: "User opted out" }
        gate_card:
          checks: [{id: "G1.3-01", status: "fail", note: "User skipped"}]
          all_pass: false
```

> "Product brief skipped. Proceeding to the next analysis phase."

Return to the Phase 1 sub-phase menu.

**If user opts in:**

Transition: `NOT_STARTED` → `IN_PROGRESS`.

Record in `{sprint_tracking}`:

```yaml
phases:
  phase_1:
    substates:
      phase_1_3:
        status: "IN_PROGRESS"
        gate_card:
          checks: [{id: "G1.3-01", status: "pass"}]
          all_pass: true
```

---

## Step 2: Gather Context

If available, read for context:
- `{brainstorm_output}` — brainstorm ideas (Phase 1.1, if not skipped)
- `{domain_research_output}` — domain research findings (Phase 1.2, if not skipped)

These are inform the product brief but are not prerequisites. The brief can be created independently.

---

## Step 3: Invoke BMAD Product Brief Agent

Invoke the BMAD product-brief agent.

**Instructions to pass to the agent:**

- Synthesize available research and brainstorming (if any) into a concise product brief.
- Focus on strategic clarity: who, what problem, why us, how measured.
- Output to `{product_brief_output}` (typically `_wdf_output/analysis/product-brief.md`).
- Frontmatter must include `artifact_type: "product_brief"`, `phase: 1`, `sub_phase: "1.3"`, `status: "draft"`.

The Product Brief must cover these sections:

```markdown
# Product Brief: {project_name}

## 1. Product Vision
**One-sentence vision statement** capturing the essence of the product.

## 2. Target User
**Primary persona** — who is this for? What's their context?

## 3. Core Problem
**What problem are we solving?** Why does it matter? What happens if it's not solved?

## 4. Value Proposition
**Why this solution?** What makes it different from alternatives?

## 5. Key Differentiators
| Differentiator | Description | Why It Matters |
|----------------|-------------|----------------|
| ... | ... | ... |

## 6. Success Metrics (KPIs)
| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| ... | ... | ... |

## 7. Scope Boundaries
### In Scope
- ...

### Out of Scope
- ...

### Future Considerations
- ...

## 8. Constraints & Assumptions
- ...

## 9. Key Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| ... | ... | ... |
```

Transition: `IN_PROGRESS` → `BRIEFING`.

---

## Step 4: Review and Finalize

After the BMAD agent completes, present a summary to the user:

> "Product Brief complete. Here's the summary:"
>
> "**Vision:** {one-line vision}"
> "**Target User:** {primary persona}"
> "**Core Problem:** {problem summary}"
> "**Success Metrics:** {N} KPIs defined"
> "**Scope:** {M} in-scope items, {K} out-of-scope items"
>
> "The full brief is at `{product_brief_output}`."
>
> "Does this accurately capture the product intent? [Approve / Revise]"

Transition: `BRIEFING` → `BRIEF_DOCUMENTED`.

---

## Step 5: Verify and Lock

**Approve:**

Transition `BRIEF_DOCUMENTED` → `VERIFIED` → `LOCKED`.

Update product brief frontmatter:

```yaml
status: "locked"
locked_at: "{ISO_TIMESTAMP}"
```

Update `{sprint_tracking}`:

```yaml
phases:
  phase_1:
    substates:
      phase_1_3:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "BRIEFING", at: "{ISO}" }
          - { state: "BRIEF_DOCUMENTED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "product_brief", path: "{product_brief_output}", status: "locked" }
        gate_card:
          all_pass: true
```

**Revise:** Return to Step 3 for edits.

---

## Step 6: Completion

Present summary:

> "Phase 1.3 complete — Product Brief LOCKED."
>
> "Key artifact: `{product_brief_output}`"
>
> "The product brief establishes the strategic foundation: target user, core problem, value proposition, success metrics, and scope boundaries. This will guide Impact Mapping (1.4) and the PRD (1.5)."

Return to the Phase 1 sub-phase menu.
