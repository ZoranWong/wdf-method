---
sub_workflow: "2-10-design-acceptance"
phase: 2
sub_phase: "2.10"
version: "3.6.0"
title: "Phase 2.10 — Design Acceptance Criteria"
description: "Compile acceptance criteria for all design deliverables, validate UI/UX quality against heuristics and standards, define design-to-development handoff requirements, and lock the complete design specification."
dependencies: ["wireframes.md", "design-system-spec.md", "interaction-spec.md"]
---

# Phase 2.10 — Design Acceptance Criteria

**Sub-Phase Goal:** Compile comprehensive acceptance criteria for all design deliverables. Validate that every UX/UI decision is documented, every component has clear specs, and the design is ready for development handoff.

**Why This Matters:** Design acceptance formalizes the handoff between design and development. Clear, verifiable criteria prevent "the implementation doesn't match the design" issues.

---

## FSM State Transition Table

| Current State    | Valid Transition    | Trigger / Condition                                  | Next State      |
|:-----------------|:--------------------|:-----------------------------------------------------|:----------------|
| NOT_STARTED      | START               | Gate Card passes; phase execution begins             | IN_PROGRESS     |
| IN_PROGRESS      | CRITERIA_COMPILED   | All acceptance criteria compiled                     | CRITERIA_COMPILED |
| CRITERIA_COMPILED | VALIDATED          | Criteria validated against UX heuristics             | VALIDATED       |
| VALIDATED        | VERIFY              | User signs off on design acceptance                   | VERIFIED         |
| VERIFIED         | LOCK                | Acceptance artifact locked                            | LOCKED          |
| NOT_STARTED      | (none)              | —                                                    | —               |

**Final State:** `LOCKED`
**State persistence:** `sprint-status.yaml` key `phase_2_10`

---

## Gate Card

```yaml
gate_card:
  phase: 2.10
  gates:
    - check: sprint_status.phase_2_7
      operator: equals
      expected: "LOCKED"
      fail_action: "HALT — Phase 2.7 (Wireframes) must be LOCKED before design acceptance"
  gate_pass_action: "Set phase_2_10 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step-by-Step Instructions

### Step 1 — Gate Card Check

Verify Phase 2.7 is LOCKED:

```yaml
phase_2_7: LOCKED
```

---

### Step 2 — Collect Design Artifacts

Gather all design artifacts from previous sub-phases:

| Artifact | Source Phase | Required? |
|----------|-------------|-----------|
| User Flows + Sitemap | 2.6 | Required |
| Wireframes | 2.7 | Required |
| Design System Spec | 2.8 | Required (or marked SKIPPED) |
| Interaction Spec | 2.9 | Required (or marked SKIPPED) |

Verify each required artifact exists and is in its final state.

---

### Step 3 — Compile Acceptance Criteria

#### 3a. User Flow Acceptance

```yaml
user_flow_acceptance:
  - id: "UFA-01"
    criterion: "Every persona from the PRD has at least one complete user flow"
    verification: "Count flows per persona in user-flows.md"
    status: "pending"

  - id: "UFA-02"
    criterion: "Every flow includes: happy path, error path, empty state"
    verification: "Review each flow for completeness"

  - id: "UFA-03"
    criterion: "All pages in the site map have defined routes"
    verification: "Cross-reference sitemap with route definitions"

  - id: "UFA-04"
    criterion: "Navigation supports all user flows without dead ends"
    verification: "Walk each flow, verify every page has a forward path"
```

#### 3b. Wireframe Acceptance

```yaml
wireframe_acceptance:
  - id: "WFA-01"
    criterion: "Every page in the sitemap has a wireframe"
    verification: "Cross-reference wireframe inventory with sitemap pages"

  - id: "WFA-02"
    criterion: "Responsive behavior specified for all breakpoints (mobile, tablet, desktop)"
    verification: "Check each wireframe for responsive annotations"

  - id: "WFA-03"
    criterion: "Component breakdown complete (global, shared, page-specific)"
    verification: "Review component inventory completeness"

  - id: "WFA-04"
    criterion: "Content requirements documented for every content slot"
    verification: "Review content slot specifications"
```

#### 3c. Design System Acceptance

```yaml
design_system_acceptance:
  - id: "DSA-01"
    criterion: "Design tokens cover: colors, typography, spacing, shadows, border radius, breakpoints, z-index"
    verification: "Review design tokens completeness"

  - id: "DSA-02"
    criterion: "All 8 base components have complete specifications"
    verification: "Count component specs: Button, Input, Modal, Table, Loading, Error, Empty, Toast"

  - id: "DSA-03"
    criterion: "Every component spec covers: props, visual states, content states, accessibility, responsive"
    verification: "Review each component spec for completeness"

  - id: "DSA-04"
    criterion: "Color contrast >= 4.5:1 for all text on all backgrounds"
    verification: "Spot-check color pairs with contrast checker"
```

#### 3d. Interaction Design Acceptance

```yaml
interaction_acceptance:
  - id: "IDA-01"
    criterion: "Transition specs defined for: page navigation, modals, drawers"
    verification: "Review transition documentation"

  - id: "IDA-02"
    criterion: "Micro-interactions defined for: click, submit, add, remove, toggle"
    verification: "Review micro-interaction catalog"

  - id: "IDA-03"
    criterion: "Loading strategies defined: skeleton, progressive, optimistic, infinite scroll"
    verification: "Review loading strategy documentation"

  - id: "IDA-04"
    criterion: "Error and empty state patterns defined"
    verification: "Review error/empty state patterns"

  - id: "IDA-05"
    criterion: "Motion accessibility addressed (prefers-reduced-motion)"
    verification: "Verify reduced motion alternatives documented"
```

---

### Step 4 — Design Quality Validation

#### 4a. Heuristic Evaluation

Apply Jakob Nielsen's 10 heuristics to the complete design:

| # | Heuristic | Pass/Fail | Notes |
|---|-----------|-----------|-------|
| 1 | Visibility of system status | | |
| 2 | Match between system and real world | | |
| 3 | User control and freedom | | |
| 4 | Consistency and standards | | |
| 5 | Error prevention | | |
| 6 | Recognition rather than recall | | |
| 7 | Flexibility and efficiency of use | | |
| 8 | Aesthetic and minimalist design | | |
| 9 | Help users recognize, diagnose, recover | | |
| 10 | Help and documentation | | |

#### 4b. Accessibility Audit (Pre-Implementation)

```yaml
accessibility_audit:
  checks:
    - "Skip-to-content link on every page"
    - "Focus order follows visual order"
    - "All interactive elements keyboard accessible"
    - "Form inputs have associated labels"
    - "Images have alt text (specified in wireframes)"
    - "Heading hierarchy doesn't skip levels"
    - "Color is not the only means of conveying information"
    - "Touch targets >= 44x44px (mobile)"
    - "ARIA landmarks defined for page regions"
    - "prefers-reduced-motion respected in animations"
```

#### 4c. Cross-Reference Matrix

Verify every PRD feature maps to design artifacts:

| PRD Feature | User Flow | Wireframe Page | Design System Component | Interaction Pattern |
|------------|-----------|----------------|------------------------|-------------------|
| {Feature 1} | Flow: {name} | Page: {name} | {component(s)} | {pattern(s)} |
| ... | ... | ... | ... | ... |

Any PRD feature without design coverage is flagged as a gap.

---

### Step 5 — Design-to-Development Handoff

Define the handoff package that will be passed to implementation:

```yaml
design_handoff:
  deliverables:
    - { artifact: "user-flows.md", format: "Markdown", includes: "Flow diagrams + sitemap" }
    - { artifact: "wireframes.md", format: "Markdown with ASCII layouts", includes: "All pages + responsive specs" }
    - { artifact: "design-system-spec.md", format: "Markdown + YAML tokens", includes: "Tokens + component specs" }
    - { artifact: "interaction-spec.md", format: "Markdown + YAML specs", includes: "Animations + micro-interactions" }
    - { artifact: "design-acceptance.md", format: "Markdown + YAML criteria", includes: "This document" }

  conventions:
    naming: "BEM or CSS Modules (from design system spec)"
    spacing: "4px grid (from design tokens)"
    breakpoints: "{bp values} (from design tokens)"
    colors: "CSS custom properties named --color-{name}-{shade}"
    typography: "CSS custom properties named --text-{size}"

  implementation_sequence:
    1: "Design tokens → CSS custom properties"
    2: "Base components (Button, Input, etc.) → Component library"
    3: "Layout shell (Header, Sidebar, Footer) → App shell"
    4: "Page components → Wireframe implementations"
    5: "Interactions + animations → Micro-interaction library"
```

---

### Step 6 — Verification

Present the acceptance criteria for user sign-off:

```markdown
## Design Acceptance Summary

### Coverage
- User Flows: {N} flows covering {M} personas
- Wireframes: {X} pages, {Y} components identified
- Design System: {Z} tokens defined, {W} components spec'ed
- Interactions: {I} interaction patterns, {A} animation specs

### Quality
- Heuristic Evaluation: {pass_count}/10 heuristics pass
- Accessibility Audit: {pass_count}/10 checks pass
- PRD Coverage: {coverage}% of features mapped to design

### Handoff Readiness
- All design artifacts locked and ready for implementation
- Design-to-development conventions documented
- Implementation sequence defined
```

> "The design phase is complete. Do you approve the design for development handoff? [Approve / Revise]"

---

### Step 7 — Report

Generate `{project-root}/design-acceptance.md`:

```yaml
---
artifact_id: "design-acceptance"
artifact_type: "acceptance"
phase: "2.10"
status: "LOCKED"
created: "{iso-timestamp}"
user_flow_acceptance_passed: true
wireframe_acceptance_passed: true
design_system_acceptance_passed: true
interaction_acceptance_passed: true
heuristic_evaluation_score: 0
accessibility_audit_passed: true
prd_coverage_percent: 0
handoff_ready: true
---
```

Report body must include:
- Complete acceptance criteria with pass/fail status
- Heuristic evaluation results
- Accessibility audit results
- PRD-to-design cross-reference matrix
- Design handoff package definition
- Any deferred items or conditions

---

## Phase Complete

Lock the phase in `sprint-status.yaml`:

```yaml
phase_2_10: LOCKED
phase_2_10_artifact: "design-acceptance.md"
phase_2_10_locked_at: "{iso-timestamp}"
```

**Phase 2 (Planning) is now complete.** All design artifacts are locked and ready for Phase 3 (Solutioning).

Present summary:

> "Phase 2.10 complete — Design acceptance criteria verified and locked."
> "Phase 2 (Planning) is now LOCKED. All design artifacts are ready for development handoff."
> "Next: Phase 3 — Solutioning, where we define system architecture, APIs, and stories."
