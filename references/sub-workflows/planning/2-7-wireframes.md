---
sub_workflow: "2-7-wireframes"
phase: 2
sub_phase: "2.7"
version: "3.6.0"
title: "Phase 2.7 — Wireframes"
description: "Create low-fidelity wireframes for every page/screen defined in the site map. Annotate layouts with component breakdown, responsive behavior, content requirements, and accessibility specifications."
dependencies: ["user-flows-report.md", "sitemap.md"]
bmad_skills:
  - "/bmad-create-ux-design"
---

# Phase 2.7 — Wireframes

**Sub-Phase Goal:** Create wireframes for every page and screen defined in the site map. Wireframes should be annotated with: component breakdown, responsive behavior, content requirements, interaction notes, and accessibility specifications.

**Why This Matters:** Wireframes translate abstract flows into concrete layouts. They reveal information hierarchy, spatial relationships, and content requirements before visual design begins.

---

## FSM State Transition Table

| Current State    | Valid Transition    | Trigger / Condition                                  | Next State      |
|:-----------------|:--------------------|:-----------------------------------------------------|:----------------|
| NOT_STARTED      | START               | Gate Card passes; phase execution begins             | IN_PROGRESS     |
| IN_PROGRESS      | WIREFRAMES_DONE     | All page wireframes created with annotations         | WIREFRAMED      |
| WIREFRAMED       | VERIFY              | User reviews and approves wireframes                  | VERIFIED         |
| VERIFIED         | LOCK                | Artifact locked                                      | LOCKED          |
| NOT_STARTED      | (none)              | —                                                    | —               |
| IN_PROGRESS      | FAIL                | Irrecoverable error                                  | NOT_STARTED     |
| WIREFRAMED       | REWIREFRAME         | Layout changes needed                                | IN_PROGRESS     |
| VERIFIED         | UNLOCK              | Upstream flows or IA changed                         | WIREFRAMED      |

**Final State:** `LOCKED`
**State persistence:** `sprint-status.yaml` key `phase_2_7`

---

## Gate Card

```yaml
gate_card:
  phase: 2.7
  gates:
    - check: sprint_status.phase_2_6
      operator: equals
      expected: "LOCKED"
      fail_action: "HALT — Phase 2.6 (User Flows & IA) must be LOCKED before creating wireframes"
  gate_pass_action: "Set phase_2_7 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step-by-Step Instructions

### Step 1 — Gate Card Check

Read `{sprint_tracking}/sprint-status.yaml`. Verify:

```yaml
phase_2_6: LOCKED
```

If the check fails, **HALT** and report: "Phase 2.6 is not yet LOCKED. User flows and IA must be complete before creating wireframes."

If the gate passes, update `sprint-status.yaml`:

```yaml
phase_2_7: IN_PROGRESS
```

---

### Step 2 — Load Inputs

1. **Site Map** (from Phase 2.6) — Extract every page/screen, route, and hierarchy
2. **User Flows** (from Phase 2.6) — Extract navigation patterns and content requirements
3. **PRD** — Extract feature descriptions and UX requirements

---

### Step 3 — Wireframe Creation

For each page in the site map, create a wireframe annotation. Include:

#### 3a. Page Frame

```markdown
### {Page Name} — {Page ID}

**Route:** `{route}`
**Personas:** {who sees this page}
**User Goal:** {what they accomplish here}
**Entry Points:** {how users arrive here}

#### Layout
┌─────────────────────────────────────┐
│ HEADER                              │
│  [Logo]        [Nav] [Search] [User]│
├─────────────────────────────────────┤
│ {describe main content area layout} │
│                                     │
│ [Sidebar if applicable] [Content]   │
│                                     │
│ [Grid] [Cards] [Table] [Form]       │
│                                     │
├─────────────────────────────────────┤
│ FOOTER                              │
└─────────────────────────────────────┘
```

#### 3b. Component Breakdown

```markdown
#### Component Inventory
| Component | Type | Source | Props/Variants |
|-----------|------|--------|---------------|
| Header | Global | Reused on all pages | {variants} |
| UserMenu | Shared | src/components/ | {props} |
| {Page-Specific Component} | Page-level | Created here | {props} |
```

#### 3c. Content Requirements

```markdown
#### Content Slots
| Slot | Content Type | Source | Constraints |
|------|-------------|--------|-------------|
| Page Title | Text | CMS / Static | Max 60 chars |
| Hero Image | Image | CMS upload | 1200x600, < 200KB |
| Feature Cards | Rich Text | CMS | 3-6 cards |
| ... | ... | ... | ... |
```

#### 3d. Responsive Behavior

```markdown
#### Responsive Breakpoints
| Breakpoint | Layout Change |
|-----------|--------------|
| Mobile (< 768px) | Sidebar hidden, card stack vertical, single-column form |
| Tablet (768-1024px) | Collapsed sidebar, 2-column grid |
| Desktop (> 1024px) | Full sidebar, 3-column grid |
```

#### 3e. Interaction Notes

```markdown
#### Interactions
| Element | Trigger | Behavior |
|---------|---------|----------|
| "Add to Cart" button | Click | Item added, cart badge updates, toast notification |
| Search input | Type + debounce 300ms | Live search results dropdown |
| Infinite scroll | Scroll to bottom | Load next page of results |
| Drag-and-drop reorder | Drag handle | Reorder list items, save order on drop |
```

#### 3f. Accessibility Specifications

```markdown
#### Accessibility Notes
- Heading hierarchy: H1 (page title) → H2 (sections) → H3 (subsections)
- Landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`
- Focus order: Header → Nav → Main Content → Sidebar → Footer
- ARIA: `aria-label` on icon buttons, `aria-expanded` on toggles
- Skip-to-content link at top of page
```

---

### Step 4 — Wireframe Review

Review all wireframes against UX heuristics:

#### 4a. Jakob Nielsen's 10 Usability Heuristics

| # | Heuristic | Check |
|---|-----------|-------|
| 1 | Visibility of system status | Do users always know what's happening? |
| 2 | Match between system and real world | Is the language familiar? |
| 3 | User control and freedom | Can users undo/redo? Is there a clear "back"? |
| 4 | Consistency and standards | Are patterns consistent across pages? |
| 5 | Error prevention | Are we preventing errors before they happen? |
| 6 | Recognition rather than recall | Are options visible, not hidden in memory? |
| 7 | Flexibility and efficiency of use | Power user shortcuts? |
| 8 | Aesthetic and minimalist design | Is every element necessary? |
| 9 | Help users recognize, diagnose, recover from errors | Are error messages helpful? |
| 10 | Help and documentation | Is help available when needed? |

---

### Step 5 — Verification

Present the wireframes for user review:

```markdown
## Wireframe Verification Checklist

- [ ] Every page from the site map has a wireframe
- [ ] Page name, ID, route, and persona are documented for each
- [ ] Component breakdown is complete (global, shared, page-specific)
- [ ] Content requirements are documented for every content slot
- [ ] Responsive behavior is specified at all breakpoints
- [ ] Interactions are documented (click, hover, scroll, drag, etc.)
- [ ] Accessibility specs are noted (headings, landmarks, focus order, ARIA)
- [ ] Nielsen's heuristics review completed
- [ ] Cross-reference: each PRD feature maps to at least one wireframe
```

Update `sprint-status.yaml`:

```yaml
phase_2_7: VERIFIED
```

---

### Step 6 — Report

Generate `{project-root}/wireframes-report.md`:

```yaml
---
artifact_id: "wireframes-report"
artifact_type: "report"
phase: "2.7"
status: "LOCKED"
created: "{iso-timestamp}"
pages_wireframed: 0
components_identified: 0
---
```

Report body must include:
- Page-by-page wireframe documentation
- Component inventory (global, shared, page-specific)
- Content requirements summary
- Responsive strategy summary
- Accessibility specification summary
- Heuristic review results
- Page-to-PRD-feature cross-reference table

---

## Phase Complete

Lock the phase in `sprint-status.yaml`:

```yaml
phase_2_7: LOCKED
phase_2_7_artifact: "wireframes-report.md"
phase_2_7_locked_at: "{iso-timestamp}"
```

This unlocks the gate for Phase 2.8 (Design System Spec).
