---
sub_workflow: "2-8-design-system"
phase: 2
sub_phase: "2.8"
version: "3.6.0"
title: "Phase 2.8 — Design System Specification"
description: "Define design tokens (colors, typography, spacing, shadows, breakpoints, border radius), specify the base component library (Button, Input, Modal, Table, Loading, Error, Empty, Toast), and establish the design system specification to be implemented in Phase 4."
dependencies: ["wireframes.md"]
skip_allowed: true
---

# Phase 2.8 — Design System Specification

**Sub-Phase Goal:** Define the visual language of the application — design tokens, component specifications, and interaction patterns. This creates a single source of truth for visual design that the implementation phase will build.

**Why This Matters:** A design system ensures visual consistency, reduces design debt, and accelerates implementation. By defining tokens and component specs here, we prevent the "every page looks different" problem.

**Recommended For:** Projects with custom UI. Skip if using a pre-built design system (Material UI, Ant Design, etc.).

---

## FSM State Transition Table

| Current State    | Valid Transition    | Trigger / Condition                                  | Next State      |
|:-----------------|:--------------------|:-----------------------------------------------------|:----------------|
| NOT_STARTED      | START               | Gate Card passes; phase execution begins             | IN_PROGRESS     |
| NOT_STARTED      | SKIP                | User chooses to skip (using existing design system)  | SKIPPED         |
| IN_PROGRESS      | TOKENS_DEFINED      | Design tokens documented                             | TOKENS_DEFINED  |
| TOKENS_DEFINED   | COMPONENTS_SPECCED  | All base component specs defined                     | COMPONENTS_SPECCED |
| COMPONENTS_SPECCED | VERIFY             | User reviews and approves                            | VERIFIED         |
| VERIFIED         | LOCK                | Artifact locked                                       | LOCKED          |
| NOT_STARTED      | (none)              | —                                                    | —               |
| IN_PROGRESS      | FAIL                | Irrecoverable error                                  | NOT_STARTED     |
| TOKENS_DEFINED   | RETOKEN             | Token changes needed                                 | IN_PROGRESS     |
| COMPONENTS_SPECCED | RESPEC            | Component spec changes needed                        | TOKENS_DEFINED  |
| VERIFIED         | UNLOCK              | Upstream wireframes changed                          | COMPONENTS_SPECCED |

**Final State:** `LOCKED` or `SKIPPED`
**State persistence:** `sprint-status.yaml` key `phase_2_8`

---

## Gate Card

```yaml
gate_card:
  phase: 2.8
  gates:
    - check: sprint_status.phase_2_7
      operator: equals
      expected: "LOCKED"
      fail_action: "HALT — Phase 2.7 (Wireframes) must be LOCKED before defining the design system"
  gate_pass_action: "Set phase_2_8 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step-by-Step Instructions

### Step 0 — Skip Decision

If the project uses a pre-built design system (Material UI, Ant Design, Chakra UI, etc.):

> "This sub-phase can be skipped if you're using a pre-built design system. Are you using: [1] Custom design (proceed) [2] Pre-built design system (skip)"

If user chooses **Skip**:

```yaml
phase_2_8: SKIPPED
```

Return to menu.

---

### Step 1 — Gate Card Check

Verify Phase 2.7 is LOCKED:

```yaml
phase_2_7: LOCKED
```

---

### Step 2 — Load Wireframes

Read `{wireframes_output}` to extract:
- All identified components (global, shared, page-specific)
- Layout patterns (header, sidebar, main, footer)
- Responsive behavior expectations
- Accessibility requirements

---

### Step 3 — Design Tokens

Define the fundamental design tokens. These become CSS custom properties or TypeScript constants in implementation.

#### 3a. Color Palette

```yaml
colors:
  primary:
    50: "#eff6ff"    # Lightest
    100: "#dbeafe"
    200: "#bfdbfe"
    300: "#93c5fd"
    400: "#60a5fa"
    500: "#3b82f6"    # Base
    600: "#2563eb"
    700: "#1d4ed8"
    800: "#1e40af"
    900: "#1e3a8a"    # Darkest
  neutral:
    50: "#fafafa"
    100: "#f5f5f5"
    200: "#e5e5e5"
    300: "#d4d4d4"
    400: "#a3a3a3"
    500: "#737373"
    600: "#525252"
    700: "#404040"
    800: "#262626"
    900: "#171717"
  semantic:
    success: "#22c55e"
    warning: "#f59e0b"
    error: "#ef4444"
    info: "#3b82f6"
```

#### 3b. Typography

```yaml
typography:
  font_families:
    sans: "'Inter', system-ui, -apple-system, sans-serif"
    mono: "'JetBrains Mono', 'Fira Code', monospace"
  scale:
    xs: { size: "0.75rem", line_height: "1rem" }      # 12px
    sm: { size: "0.875rem", line_height: "1.25rem" }   # 14px
    base: { size: "1rem", line_height: "1.5rem" }       # 16px
    lg: { size: "1.125rem", line_height: "1.75rem" }    # 18px
    xl: { size: "1.25rem", line_height: "1.75rem" }     # 20px
    2xl: { size: "1.5rem", line_height: "2rem" }        # 24px
    3xl: { size: "1.875rem", line_height: "2.25rem" }   # 30px
    4xl: { size: "2.25rem", line_height: "2.5rem" }     # 36px
  font_weights:
    normal: 400
    medium: 500
    semibold: 600
    bold: 700
```

#### 3c. Spacing (4px base unit)

```yaml
spacing:
  0: "0"
  1: "0.25rem"    # 4px
  2: "0.5rem"     # 8px
  3: "0.75rem"    # 12px
  4: "1rem"       # 16px
  5: "1.25rem"    # 20px
  6: "1.5rem"     # 24px
  8: "2rem"       # 32px
  10: "2.5rem"    # 40px
  12: "3rem"      # 48px
  16: "4rem"      # 64px
  20: "5rem"      # 80px
```

#### 3d. Shadows

```yaml
shadows:
  sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)"
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1)"
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1)"
  xl: "0 20px 25px -5px rgb(0 0 0 / 0.1)"
```

#### 3e. Border Radius

```yaml
border_radius:
  sm: "0.125rem"     # 2px
  md: "0.375rem"     # 6px
  lg: "0.5rem"       # 8px
  xl: "0.75rem"      # 12px
  2xl: "1rem"        # 16px
  full: "9999px"
```

#### 3f. Breakpoints

```yaml
breakpoints:
  sm: "640px"
  md: "768px"
  lg: "1024px"
  xl: "1280px"
  2xl: "1536px"
```

#### 3g. Z-Index Scale

```yaml
z_index:
  dropdown: 1000
  sticky: 1020
  fixed: 1030
  modal_backdrop: 1040
  modal: 1050
  popover: 1060
  tooltip: 1070
  toast: 1080
```

#### 3h. Transitions

```yaml
transitions:
  duration:
    fast: "150ms"
    normal: "250ms"
    slow: "350ms"
  easing:
    default: "cubic-bezier(0.4, 0, 0.2, 1)"
    in: "cubic-bezier(0.4, 0, 1, 1)"
    out: "cubic-bezier(0, 0, 0.2, 1)"
    in_out: "cubic-bezier(0.4, 0, 0.2, 1)"
```

Add all tokens to `{design_tokens_output}`.

---

### Step 4 — Base Component Specifications

For each base component extracted from the wireframes, create a specification:

```markdown
## Component: {Component Name}

### Purpose
{1-2 sentences describing the component's role}

### Anatomy
```
┌─────────────────────────┐
│ [icon] {label} [icon]    │  ← Component structure
│ {description/helper}     │
└─────────────────────────┘
```

### Props / API

| Prop | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| variant | 'primary' \| 'secondary' \| 'danger' \| 'ghost' | 'primary' | No | Visual style |
| size | 'sm' \| 'md' \| 'lg' | 'md' | No | Size variant |
| ... | ... | ... | ... | ... |

### Visual States

| State | Visual Treatment | Behavior |
|-------|-----------------|----------|
| Default | {styles} | {normal behavior} |
| Hover | {styles} | {hover behavior} |
| Focus | {styles} | {focus behavior} |
| Active | {styles} | {active behavior} |
| Disabled | {styles} | {disabled behavior} |
| Loading | {styles} | {loading behavior} |
| Error | {styles} | {error behavior} |

### Content States

| State | Layout | Example Trigger |
|-------|--------|-----------------|
| Empty | {layout description} | No items in list |
| Loading | Skeleton / Spinner | Data fetching |
| Error | Error message + retry | API failure |
| Ideal | Full content | Data loaded successfully |

### Accessibility

| Requirement | Implementation |
|------------|----------------|
| Role | {ARIA role} |
| Keyboard | {keyboard behavior} |
| Focus Mgmt | {focus trap / focus return} |
| Screen Reader | {announcement behavior} |
| Color Contrast | >= 4.5:1 for all text |

### Responsive Behavior

| Breakpoint | Behavior |
|-----------|----------|
| Mobile (< 768px) | {mobile behavior} |
| Tablet (768-1024px) | {tablet behavior} |
| Desktop (> 1024px) | {desktop behavior} |

### Usage Guidelines

- **Do:** {correct usage}
- **Don't:** {incorrect usage}
- **When to use:** {appropriate contexts}
- **When not to use:** {inappropriate contexts}
```

Required base components to spec (from wireframe analysis):

1. **Button** — primary, secondary, danger, ghost variants
2. **Input** — text, password, email, number with label, error, helper
3. **Modal** — overlay dialog with focus trap
4. **Table** — sortable, paginated data display
5. **Loading** — spinner, skeleton, full-page variants
6. **Error** — error boundary + inline error display
7. **Empty State** — inline and page-level empty displays
8. **Toast/Notification** — success, error, warning, info notifications

Add specs to `{component_specs_output}`.

---

### Step 5 — Verification

Present the design system for review:

```markdown
## Design System Verification Checklist

- [ ] Color palette covers all semantic needs (primary, neutral, success, warning, error, info)
- [ ] Typography scale is complete (xs through 4xl with line heights)
- [ ] Spacing scale is 4px-based and consistent
- [ ] Shadows defined for sm, md, lg, xl
- [ ] Border radius scale is defined
- [ ] Breakpoints are defined (sm, md, lg, xl, 2xl)
- [ ] Z-index scale prevents stacking conflicts
- [ ] Transitions are defined (duration + easing)
- [ ] Dark mode tokens defined (if required)
- [ ] All 8 base components have complete specs (props, states, a11y, responsive)
- [ ] Component states cover: default, hover, focus, active, disabled, loading, error
- [ ] Content states cover: empty, loading, error, ideal
- [ ] Every component spec includes accessibility requirements
- [ ] Every component spec includes responsive behavior
- [ ] Usage guidelines (do/don't) are provided for each component
```

Update `sprint-status.yaml`:

```yaml
phase_2_8: VERIFIED
```

---

### Step 6 — Report

Generate `{project-root}/design-system-spec.md`:

```yaml
---
artifact_id: "design-system-spec"
artifact_type: "specification"
phase: "2.8"
status: "LOCKED"
created: "{iso-timestamp}"
tokens_defined: true
components_speced: 8
---
```

Report body must include:
- Complete design token definitions
- Per-component specifications (all 8 base components)
- Global patterns (layout, navigation, forms, feedback)
- Accessibility guidelines
- Responsive design strategy

---

## Phase Complete

Lock the phase in `sprint-status.yaml`:

```yaml
phase_2_8: LOCKED
phase_2_8_artifact: "design-system-spec.md"
phase_2_8_locked_at: "{iso-timestamp}"
```

This unlocks the gate for Phase 2.9 (Interaction Design).
