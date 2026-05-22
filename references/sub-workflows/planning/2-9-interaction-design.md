---
sub_workflow: "2-9-interaction-design"
phase: 2
sub_phase: "2.9"
version: "3.6.0"
title: "Phase 2.9 — Interaction Design"
description: "Define interaction patterns, animations, transitions, gestures, micro-interactions, loading strategies, error feedback, and motion design for all user interfaces. Complement wireframes with how things feel and behave."
dependencies: ["wireframes.md", "design-system-spec.md"]
skip_allowed: true
---

# Phase 2.9 — Interaction Design

**Sub-Phase Goal:** Define how every interface element behaves — transitions between states, animations, gestures, micro-interactions, loading patterns, error feedback, and motion design language.

**Why This Matters:** Interaction design bridges the gap between static wireframes and a living product. It defines the "feel" — how the interface responds to user actions.

**Recommended For:** Applications with complex interactions or when interaction feel is critical. Skip for simple CRUD interfaces with standard behavior.

---

## FSM State Transition Table

| Current State    | Valid Transition    | Trigger / Condition                                  | Next State      |
|:-----------------|:--------------------|:-----------------------------------------------------|:----------------|
| NOT_STARTED      | START               | Gate Card passes; phase execution begins             | IN_PROGRESS     |
| NOT_STARTED      | SKIP                | User chooses to skip                                 | SKIPPED         |
| IN_PROGRESS      | PATTERNS_DEFINED    | Interaction patterns documented                      | PATTERNS_DEFINED |
| PATTERNS_DEFINED | ANIMATIONS_DEFINED  | Animation specs complete                             | ANIMATIONS_DEFINED |
| ANIMATIONS_DEFINED | VERIFY            | User reviews and approves                            | VERIFIED         |
| VERIFIED         | LOCK                | Artifact locked                                       | LOCKED          |
| NOT_STARTED      | (none)              | —                                                    | —               |

**Final State:** `LOCKED` or `SKIPPED`
**State persistence:** `sprint-status.yaml` key `phase_2_9`

---

## Gate Card

```yaml
gate_card:
  phase: 2.9
  gates:
    - check: sprint_status.phase_2_7
      operator: equals
      expected: "LOCKED"
      fail_action: "HALT — Phase 2.7 (Wireframes) must be LOCKED before defining interactions"
  gate_pass_action: "Set phase_2_9 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step-by-Step Instructions

### Step 0 — Skip Decision

> "This sub-phase is recommended for applications with complex interactions. For simple interfaces, you may skip."

If skipped, update `sprint-status.yaml`:

```yaml
phase_2_9: SKIPPED
```

---

### Step 1 — Gate Card Check

Verify Phase 2.7 is LOCKED:

```yaml
phase_2_7: LOCKED
```

---

### Step 2 — Load Wireframes

Read wireframes to extract all interactive elements:
- Buttons, links, inputs, selects, toggles, sliders
- Modals, drawers, popovers, tooltips
- Drag-and-drop zones, sortable lists
- Infinite scroll areas, pull-to-refresh
- Forms (multi-step, validation feedback)
- Navigation (tabs, accordion, breadcrumbs)

---

### Step 3 — Define Interaction Patterns

#### 3a. Page Transitions

```yaml
page_transitions:
  navigation:
    type: "fade + subtle slide"
    duration: "250ms"
    easing: "ease-in-out"
    direction: "forward (slide left), back (slide right)"

  modal:
    type: "fade overlay + scale content"
    duration: "250ms"
    entry: "scale(0.95) → scale(1), opacity 0 → 1"
    exit: "scale(1) → scale(0.95), opacity 1 → 0"
```

#### 3b. Micro-Interactions

```yaml
micro_interactions:
  button_click:
    feedback: "Scale down to 0.97 on press, spring back to 1.0"
    duration: "150ms"

  form_validation:
    feedback: "Shake animation on invalid submission, error text fade in"
    duration: "300ms for shake, 200ms for text appear"

  item_add:
    feedback: "New item slides in from top with fade"
    duration: "300ms"

  item_remove:
    feedback: "Item fades and collapses height"
    duration: "250ms"

  toggle:
    feedback: "Switch knob slides + color transitions"
    duration: "200ms"
```

#### 3c. Gestures

```yaml
gestures:
  swipe_to_delete:
    element: "List items"
    gesture: "Swipe left reveals delete action"
    threshold: "50% of item width"
    feedback: "Item slides and fades, undo toast appears"

  pull_to_refresh:
    element: "Scrollable lists"
    gesture: "Pull down from top"
    threshold: "80px from top"
    feedback: "Spinner appears, list bounces back on release"

  long_press:
    element: "Grid items, cards"
    gesture: "Press and hold for 500ms"
    feedback: "Haptic feedback, context menu appears"
```

#### 3d. Loading Strategies

```yaml
loading_strategies:
  skeleton:
    use_case: "Page loads, list loads, card loads"
    pattern: "Animated placeholder matching final layout"
    fallback: "Spinner (if layout unknown)"

  progressive:
    use_case: "Image-heavy pages"
    pattern: "Low-res placeholder → full image (fade transition)"

  optimistic:
    use_case: "Immediate feedback for known actions"
    pattern: "Show expected result immediately, rollback on error"

  infinite_scroll:
    use_case: "Long lists (feeds, search results)"
    pattern: "Load next page when 200px from bottom"
    feedback: "Skeleton rows at bottom during load"
```

#### 3e. Error & Empty States

```yaml
error_patterns:
  inline_validation:
    trigger: "On blur OR on submit"
    feedback: "Red border + error text below input"
    timing: "Immediate on blur, delayed 300ms on type"

  api_error:
    trigger: "Network failure, 4xx, 5xx"
    feedback: "Inline error or toast, depending on context"
    recovery: "Retry button, auto-retry (with backoff)"

  form_submission:
    trigger: "Submit click"
    feedback: "Button loading state, disable all inputs"
    success: "Success toast + redirect or reset form"
    failure: "Error summary at top + field-level errors"

empty_state_patterns:
  first_use: "Guided empty state with CTA"
  cleared: "Illustration + 'Nothing here' + action"
  filtered: "'No results for [filter]' + clear filter link"
```

---

### Step 4 — Animation Specifications

Provide detailed animation specs for key interactions:

```yaml
animations:
  fade:
    enter: { opacity: [0, 1], duration: "200ms", easing: "ease-out" }
    exit: { opacity: [1, 0], duration: "150ms", easing: "ease-in" }

  slide_up:
    enter: { transform: ["translateY(10px)", "translateY(0)"], opacity: [0, 1], duration: "300ms", easing: "ease-out" }

  scale:
    enter: { transform: ["scale(0.95)", "scale(1)"], opacity: [0, 1], duration: "250ms" }

  stagger:
    use_case: "Lists loading children"
    pattern: "Each child delays by 50ms (stagger)"
    total_duration: "< 500ms for whole list"

  spring:
    use_case: "Pull to refresh release"
    stiffness: 300
    damping: 30
```

**Accessibility consideration:**

```yaml
motion_accessibility:
  prefers_reduced_motion:
    behavior: "Remove all animations when OS setting enabled"
    alternative: "Instant transitions without motion"
  vestibular_safety:
    no_parallax: true
    no_auto_scroll: true
    max_animation_duration: "300ms"
```

---

### Step 5 — Component Interaction Specs

For each component from the wireframes, add interaction behavior:

```markdown
| Component | Trigger | Animation | Duration | Easing | Notes |
|-----------|---------|-----------|----------|--------|-------|
| Dropdown | Click | Slide + fade in | 200ms | ease-out | Focus first item on open |
| Tooltip | Hover | Fade in, delay 500ms | 150ms | ease-out | Position auto-adjusts to viewport |
| Tabs | Click | Content fade + slide | 250ms | ease-in-out | Active indicator slides |
| Accordion | Click | Height transition | 300ms | ease-in-out | ARIA expanded updated |
| Carousel | Swipe / Arrow | Slide with momentum | 400ms | ease-out | Pause on hover, resume on leave |
| Drag Handle | Mouse down | Item lifts (shadow + scale) | 0ms | — | Drop target highlights |
```

---

### Step 6 — Verification

Present interactions for review:

```markdown
## Interaction Design Verification Checklist

- [ ] Page transitions are defined (navigation, modal, drawer)
- [ ] Micro-interactions defined for all common actions (click, submit, add, remove)
- [ ] Gesture interactions defined if applicable (swipe, pull-to-refresh, long-press)
- [ ] Loading strategies defined (skeleton, progressive, optimistic, infinite scroll)
- [ ] Error feedback patterns defined (inline, API error, form submission)
- [ ] Empty state patterns defined (first use, cleared, filtered)
- [ ] Animation specs documented (fade, slide, scale, stagger, spring)
- [ ] Motion accessibility (prefers-reduced-motion) addressed
- [ ] Component-level interaction table complete
- [ ] All interactions align with wireframe layout
```

Update `sprint-status.yaml`:

```yaml
phase_2_9: VERIFIED
```

---

### Step 7 — Report

Generate `{project-root}/interaction-spec.md`:

```yaml
---
artifact_id: "interaction-spec"
artifact_type: "specification"
phase: "2.9"
status: "LOCKED"
created: "{iso-timestamp}"
patterns_defined: 0
animations_speced: 0
---
```

Report body must include:
- Complete interaction pattern catalog
- Animation specifications
- Gesture definitions (if applicable)
- Loading strategy documentation
- Error and empty state patterns
- Motion accessibility guidelines
- Component interaction table

---

## Phase Complete

Lock the phase in `sprint-status.yaml`:

```yaml
phase_2_9: LOCKED
phase_2_9_artifact: "interaction-spec.md"
phase_2_9_locked_at: "{iso-timestamp}"
```

This unlocks the gate for Phase 2.10 (Design Acceptance).
