---
title: "Phase 4.8 — Design System & Shared Components"
description: >
  Define design tokens (colors, typography, spacing) and build the base component library
  (Button, Input, Modal, Table, Loading, Error, Empty, Toast). Each component must handle
  all visual states and pass accessibility checks before this phase can lock.
sub_workflow: "4-8-fe-design-system"
phase: 4
sub_phase: "4.8"
version: "3.6.0"
inputs:
  - architecture.md (component tree, styling decisions)
outputs:
  - design-system-report.md
dependencies:
  upstream: [phase_4_7]
  downstream: [phase_4_10]
---

# Phase 4.8 — Design System & Shared Components

## FSM State Transition Table

| Current State      | Valid Transition    | Trigger / Condition                                   | Next State        |
|:-------------------|:--------------------|:------------------------------------------------------|:------------------|
| NOT_STARTED        | START               | Gate Card passes; phase execution begins              | IN_PROGRESS       |
| IN_PROGRESS        | COMPLETE_BUILD      | All base components built with all state variants     | COMPONENTS_BUILT  |
| COMPONENTS_BUILT   | DOCUMENT            | Storybook/docs generated for every component          | DOCUMENTED        |
| DOCUMENTED         | REVIEW              | Accessibility + visual review complete                | REVIEWED          |
| REVIEWED           | LOCK                | Design system report generated and approved           | LOCKED            |
| NOT_STARTED        | (none)              | —                                                     | —                 |
| IN_PROGRESS        | FAIL                | Fatal error during component build                    | NOT_STARTED       |
| COMPONENTS_BUILT   | REBUILD             | Component spec changed, rebuild needed                | IN_PROGRESS       |
| DOCUMENTED         | REDOCUMENT          | Documentation gaps found                              | COMPONENTS_BUILT  |
| REVIEWED           | UNLOCK              | Upstream architecture.md changed                      | DOCUMENTED        |

**Final State:** `LOCKED`
**State persistence:** `sprint-status.yaml` key `phase_4_8`

---

## Gate Card

```yaml
gate_card:
  phase: 4.8
  gates:
    - check: sprint_status.phase_4_7
      operator: equals
      expected: "LOCKED"
      fail_action: "HALT — Phase 4.7 (Frontend Scaffolding) must be LOCKED before building the design system"
  gate_pass_action: "Set phase_4_8 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step-by-Step Instructions

### Step 1 — Gate Card Check

Read `{sprint_tracking}/sprint-status.yaml`. Verify:

```yaml
phase_4_7: LOCKED
```

If the check fails, **HALT** and report: "Phase 4.7 is not yet LOCKED. Frontend scaffolding must be complete before building the design system."

If the gate passes, update `sprint-status.yaml`:

```yaml
phase_4_8: IN_PROGRESS
```

---

### Step 2 — Load Inputs

Read `{architecture_output}/architecture.md` and extract design decisions:

- **CSS framework**: Tailwind, CSS Modules, styled-components, vanilla CSS, etc.
- **Component patterns**: controlled vs uncontrolled, composition model
- **Design tokens**: if pre-defined in architecture, use them; otherwise derive from industry standards
- **Responsive breakpoint strategy**: mobile-first or desktop-first
- **Dark/light mode**: is theme switching required?

---

### Step 3 — Design Tokens

Define design tokens as CSS custom properties or a TypeScript theme object. Place them in `src/styles/tokens.css` or `src/styles/theme.ts`.

**Color palette:**

```css
:root {
  /* Primary */
  --color-primary-50: #eff6ff;
  --color-primary-500: #3b82f6;
  --color-primary-700: #1d4ed8;

  /* Neutral */
  --color-neutral-50: #fafafa;
  --color-neutral-200: #e5e5e5;
  --color-neutral-500: #737373;
  --color-neutral-900: #171717;

  /* Semantic */
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;
}
```

**Typography scale:**

```css
--font-family-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-family-mono: 'JetBrains Mono', 'Fira Code', monospace;

--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */
```

**Spacing scale (4px base):**

```css
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
```

**Shadows:**

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
```

**Breakpoints:**

```css
--bp-sm: 640px;
--bp-md: 768px;
--bp-lg: 1024px;
--bp-xl: 1280px;
--bp-2xl: 1536px;
```

**Border radius:**

```css
--radius-sm: 0.25rem;
--radius-md: 0.375rem;
--radius-lg: 0.5rem;
--radius-full: 9999px;
```

**Dark mode** (if required by architecture):

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-neutral-50: #171717;
    --color-neutral-900: #fafafa;
    /* ... invert all color tokens ... */
  }
}
```

Also provide a `data-theme="dark"` toggle class for manual switching.

---

### Step 4 — Build Base Components

Build each component **one at a time**, in the order below. For every component, implement ALL listed state variants before moving to the next component.

#### 4a. Button

File: `src/components/Button/Button.tsx` (or `.vue`, `.svelte`)

**Props:**

```typescript
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'danger' | 'ghost';
  size: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;          // leading icon
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (e: MouseEvent) => void;
  children: ReactNode;
}
```

**States to implement and test:**
- Default (each variant + size combination)
- `loading: true` — spinner replaces content, button is disabled
- `disabled: true` — muted styling, `pointer-events: none`
- With icon (left / right)
- Full width
- Keyboard focus ring visible
- `aria-busy="true"` when loading
- `aria-disabled="true"` when disabled

#### 4b. Input

File: `src/components/Input/Input.tsx`

**Props:**

```typescript
interface InputProps {
  type: 'text' | 'password' | 'email' | 'number';
  label?: string;
  placeholder?: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}
```

**States:**
- Default empty
- With value
- With label
- With error message (red border + error text)
- With helper text
- `disabled: true` — greyed out, not interactive
- `readOnly: true` — visible but not editable
- Required indicator (asterisk on label)
- Focus ring visible
- `aria-describedby` pointing to error/helper element
- `aria-invalid="true"` when error is present

#### 4c. Modal

File: `src/components/Modal/Modal.tsx`

**Props:**

```typescript
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'fullscreen';
  closeOnOverlay?: boolean;      // default: true
  closeOnEscape?: boolean;       // default: true
  children: ReactNode;
  footer?: ReactNode;
}
```

**Behaviors:**
- Overlay backdrop with semi-transparent dark background
- Focus trap: Tab cycles only within modal
- Escape key closes modal
- Click overlay to close (if `closeOnOverlay: true`)
- Body scroll locked when modal is open
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to title
- Animate in/out (fade + scale)

#### 4d. Table

File: `src/components/Table/Table.tsx`

**Props:**

```typescript
interface TableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  sortable?: boolean;
  pagination?: { page: number; pageSize: number; total: number };
  onPageChange?: (page: number) => void;
  loading?: boolean;
  emptyMessage?: string;
  error?: string;
  onRetry?: () => void;
  rowKey: keyof T | ((row: T) => string);
}
```

**States:**
- Populated: rows render with correct column mapping
- Loading: skeleton rows (same number as pageSize) with shimmer animation
- Empty: centered empty-state component with custom message and optional CTA
- Error: inline error display with retry button
- Sortable: clicking column header toggles sort direction, shows sort indicator
- Pagination: prev/next buttons, page number display, disabled states at boundaries
- Responsive: horizontal scroll on overflow, or card layout on mobile
- `role="table"`, `role="columnheader"`, `role="row"` semantics

#### 4e. Loading

File: `src/components/Loading/Loading.tsx`

**Variants:**

```typescript
type LoadingVariant = 'spinner' | 'skeleton' | 'fullpage';

interface LoadingProps {
  variant: LoadingVariant;
  size?: 'sm' | 'md' | 'lg';        // for spinner
  lines?: number;                    // for skeleton (number of skeleton rows)
  message?: string;                  // accessible loading message
}
```

**Implementations:**
- **Spinner**: CSS animation, accessible via `role="status"` and `aria-label`
- **Skeleton**: animated placeholder blocks, configurable rows
- **Full page**: centered spinner with optional message, covers viewport
- All variants respect `prefers-reduced-motion` (disable animation)

#### 4f. Error

File: `src/components/Error/ErrorBoundary.tsx` and `src/components/Error/InlineError.tsx`

**ErrorBoundary** (class component or equivalent):
- Catches render errors in children
- Displays fallback UI with error message
- "Try Again" button that resets error boundary state
- Logs error details to console in dev

**InlineError:**

```typescript
interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  variant?: 'inline' | 'card' | 'fullpage';
}
```

**States:**
- Inline: red-bordered alert with icon, message, optional retry
- Card: elevated card with illustration, message, retry button
- Full page: centered layout with illustration, message, CTA, link to home
- `role="alert"` for immediate announcement

#### 4g. Empty

File: `src/components/Empty/Empty.tsx`

```typescript
interface EmptyProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  variant?: 'inline' | 'page';
}
```

**States:**
- Inline: compact display within a container
- Page: full viewport height, centered
- With action button
- Without action button (passive message)
- Accessible: `role="status"` for the message

#### 4h. Toast / Notification

File: `src/components/Toast/Toast.tsx` and `src/components/Toast/ToastProvider.tsx`

```typescript
type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;       // ms, default 5000; 0 = persistent
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}
```

**Behaviors:**
- Stack in bottom-right corner (configurable position)
- Auto-dismiss after `duration` ms with exit animation
- Manual dismiss via close button
- Toast provider wraps app at root level
- `role="alert"` for error/warning, `role="status"` for info/success
- Pause auto-dismiss on hover
- Max visible toasts: 5 (older ones dismissed when exceeded)

---

### Step 5 — Component Documentation

For each component built in Step 4, create documentation. Can use Storybook, a markdown file, or an in-app component explorer.

Each component doc must include:

```markdown
## Button

### Props
| Prop       | Type                                          | Default     | Required |
|------------|-----------------------------------------------|-------------|----------|
| variant    | 'primary' \| 'secondary' \| 'danger' \| 'ghost' | 'primary'   | No       |
| size       | 'sm' \| 'md' \| 'lg'                           | 'md'        | No       |
| loading    | boolean                                       | false       | No       |
| ...        | ...                                           | ...         | ...      |

### Usage Examples

\`\`\`tsx
// Primary button
<Button variant="primary" size="md">Save</Button>

// Loading state
<Button loading>Processing...</Button>

// With icon
<Button icon={<PlusIcon />}>Add Item</Button>

// Disabled
<Button disabled>Cannot Click</Button>
\`\`\`

### States
- [ ] Default (all variant × size combinations)
- [ ] Loading
- [ ] Disabled
- [ ] With icon
- [ ] Focus visible
```

Store docs at `src/components/{ComponentName}/README.md` or in a Storybook `.stories.tsx` file.

---

### Step 6 — Accessibility Review

For EVERY component built, verify the following:

| Check                          | How to Verify                                          |
|:-------------------------------|:-------------------------------------------------------|
| Proper ARIA roles              | Inspect element for `role`, `aria-*` attributes        |
| Keyboard navigation            | Tab through component, Enter/Space to activate         |
| Focus management               | Focus ring visible, focus trapped in modals            |
| Screen reader announcements    | Use VoiceOver/NVDA, verify all states announced        |
| Color contrast >= 4.5:1        | Use axe DevTools or contrast checker on all states     |
| Semantic HTML                  | Use `<button>` not `<div onClick>`, `<nav>` for nav    |
| `prefers-reduced-motion`       | Enable OS setting, verify animations disabled          |

Fix any issues found. Re-run checks until all pass.

---

### Step 7 — Verification & Report

Run the following verification:

```bash
# Type check
npm run type-check
# → Must exit 0

# Lint
npm run lint
# → Must exit 0 (warnings allowed per quality_gates)

# Build
npm run build
# → Must produce successful build

# If Storybook is installed:
npm run storybook:build
# → Must build without errors
```

Manual checklist:
- [ ] Every component listed in architecture.md component tree is built
- [ ] Every component handles all documented states
- [ ] All components pass keyboard navigation test
- [ ] All components pass axe DevTools audit (no critical or serious issues)
- [ ] Design tokens are defined and used consistently across all components
- [ ] Dark mode tokens defined (if required)
- [ ] Component docs exist and are complete

Generate `{project-root}/design-system-report.md`:

```yaml
---
artifact_id: "design-system-report"
artifact_type: "report"
phase: "4.8"
status: "LOCKED"
created: "{iso-timestamp}"
components_built: ["Button", "Input", "Modal", "Table", "Loading", "Error", "Empty", "Toast"]
total_components: 8
design_tokens_defined: true
storybook_built: true|false
a11y_passed: true
---
```

Report body must include:
- Design token summary (colors, typography, spacing, breakpoints)
- Per-component build summary (props, states implemented, known limitations)
- Accessibility review results per component
- Screenshots of each component in each state (optional but recommended)
- Known issues / TODOs

---

## Phase Complete

When all components are built, documented, and verified, lock the phase:

```yaml
phase_4_8: LOCKED
phase_4_8_artifact: "design-system-report.md"
phase_4_8_locked_at: "{iso-timestamp}"
```

This satisfies the gate condition for Phase 4.10 (which requires both 4.8 AND 4.9 LOCKED).
