# WDF Method — QA Acceptance Standards

**Version:** 3.8.0
**Status:** MANDATORY — ALL stories must pass QA before CODE_ACCEPTED or UI_ACCEPTED

---

## QA Acceptance Flow

```
Story Implementation Complete (all tests pass)
        ↓
┌──────────────────────────────────────┐
│ QA PHASE 1: Code Review               │
│ - Design flaws                        │
│ - Code style & conventions            │
│ - Code quality & maintainability       │
│ - Duplicate & dead code               │
│ - Security patterns                    │
│ - Error handling completeness          │
│                                       │
│ Verdict: PASS / FAIL with findings    │
├──────────────────────────────────────┤
│ QA PHASE 2: Design Review (FE only)   │
│ - Visual consistency                  │
│ - Typography & spacing                 │
│ - Color system adherence              │
│ - Component states completeness        │
│ - Interaction consistency              │
│ - Accessibility review                 │
│ - Responsive behavior                  │
│                                       │
│ Verdict: PASS / FAIL with findings    │
├──────────────────────────────────────┤
│ QA Acceptance Decision                │
│ All findings addressed → PASS         │
│ Blocking findings remain → FAIL       │
└──────────────────────────────────────┘
        ↓
   CODE_ACCEPTED / UI_ACCEPTED
```

---

## QA Phase 1: Code Review

### 1.1 Design Flaw Detection

Code review MUST identify these design flaws:

| Flaw Category | Detection Criteria | Severity |
|--------------|-------------------|----------|
| **God Object** | Single class/function > 300 lines or > 10 responsibilities | Critical |
| **Feature Envy** | Method calls more methods on another class than its own | High |
| **Data Clump** | Same 3+ parameters appear together in multiple methods → should be a type | High |
| **Shotgun Surgery** | One change requires modifying 5+ files (missing abstraction) | Critical |
| **Primitive Obsession** | Using string/int instead of domain types (e.g., `string` for Email, `int` for Money) | Medium |
| **Leaky Abstraction** | Implementation detail exposed through interface (e.g., SQL in service layer) | High |
| **Cyclic Dependency** | A → B → C → A (detect via import graph) | Critical |
| **Missing Abstraction** | Repeated logic across 3+ places without shared implementation | High |
| **Wrong Abstraction** | Abstraction that makes simple things complex (over-engineering) | Medium |
| **Inconsistent Abstraction Level** | Mixing high-level business logic with low-level I/O in same function | Medium |

### 1.2 Code Style & Conventions

| Check | Standard | Severity |
|-------|----------|----------|
| **Naming consistency** | Functions: verbNoun (createTask), Classes: PascalCase (TaskService), Constants: UPPER_SNAKE_CASE (MAX_RETRIES), Variables/params: camelCase, Files: kebab-case | Medium |
| **Function size** | Functions ≤ 50 lines, each does ONE thing | High |
| **File size** | Files ≤ 500 lines (backend), ≤ 300 lines (frontend components) | Medium |
| **Comment quality** | No comments explaining WHAT (code should be self-documenting). Comments only for WHY (non-obvious decisions, workarounds, constraints). No commented-out code. | Medium |
| **Import organization** | Third-party → internal modules → relative, no unused imports | Low |
| **Error messages** | User-facing: clear, actionable, no technical jargon. Developer-facing (logs): include context (what failed, inputs, timestamps) | High |
| **Type safety** | No `any` types (TypeScript), no implicit coercion, explicit null checks | Critical |
| **Magic numbers** | All numeric literals (except 0, 1, -1) must be named constants | Medium |

### 1.3 Code Quality & Maintainability

| Check | Detection | Severity |
|-------|-----------|----------|
| **Cyclomatic Complexity** | Any function with complexity > 10 | High |
| **Cognitive Complexity** | Any function with nesting depth > 4 | High |
| **Exception Handling** | No empty catch blocks, no `catch (e) {}` without logging or handling | Critical |
| **Race Conditions** | Shared mutable state without synchronization, non-atomic read-modify-write | Critical |
| **Memory Leaks** | Uncleaned event listeners, setInterval without clearInterval, unmounted component state updates | Critical |
| **SQL Injection** | String concatenation to build SQL — MUST use parameterized queries | Critical |
| **XSS** | innerHTML, dangerouslySetInnerHTML without sanitization | Critical |
| **Hardcoded Secrets** | API keys, passwords, tokens in code (even in comments) | Critical |
| **Missing Input Validation** | Any user input reaching business logic without validation | High |
| **Missing Rate Limiting** | Public endpoints without rate limiting | High |
| **Error Swallowing** | Try-catch that returns default value instead of propagating or handling error properly | High |

### 1.4 Duplicate Code Detection

| Type | Detection | Severity |
|------|-----------|----------|
| **Identical blocks** | Same > 10 lines of code in 2+ places → MUST extract | High |
| **Structural duplicates** | Same logic with different variable names → MUST parameterize | High |
| **Copy-paste config** | Same configuration values in 3+ places → MUST centralize | Medium |
| **Boilerplate** | Same setup/teardown pattern in 5+ test files → extract helper | Low |

### 1.5 Code Review Report Format

Every story MUST produce a code review section in the test report:

```
## Code Review

### Design Flaws
{List each flaw with: location (file:line), category, severity, description, suggested fix}

### Style Violations
{List each violation with: location, rule violated, fix}

### Quality Issues
{List each issue with: location, type, severity, impact, fix}

### Duplicate Code
{List each duplicate with: locations, block size, suggested extraction}

### Verdict
{CRITICAL: N, HIGH: N, MEDIUM: N, LOW: N}
PASS: 0 critical, 0 high issues remain
FAIL: {count} blocking issues must be fixed before acceptance
```

---

## QA Phase 2: Design Review (Frontend Only)

### 2.1 Visual Consistency Audit

| Check | Standard | Method |
|-------|----------|--------|
| **Color consistency** | All colors from design tokens. No hardcoded hex/rgb values in components. | grep for `#[0-9a-fA-F]` and `rgb(` in component files |
| **Typography hierarchy** | All font sizes, weights, line heights match design tokens. No inline font styles. | Check all `font-size`, `font-weight`, `line-height` against tokens |
| **Spacing consistency** | All margins, paddings from spacing scale. No arbitrary px values. | Check all `margin`, `padding`, `gap` values match spacing tokens |
| **Border radius** | Consistent values from radius scale. No mixed rounded/sharp corners in same component family. | Visual inspection + code check |
| **Shadow consistency** | All shadows from shadow scale. No ad-hoc box-shadows. | Check `box-shadow` values |
| **Icon consistency** | Single icon library. No mixing icon sets. Consistent sizing and stroke width. | Visual inspection |
| **Dark mode** | If enabled: all colors tested in both modes, no hardcoded light/dark values | Visual inspection + component check |

### 2.2 Typography & Spacing Review

| Check | Tolerance | Method |
|-------|-----------|--------|
| **Font family** | Single font-family per project. Web-safe fallback chain present. | Check `font-family` declarations |
| **Font size scale** | Only values from type scale used. No intermediate sizes. | Verify all font-size values ∈ type scale |
| **Line height** | Body text 1.5-1.75, headings 1.2-1.3. | Measure in browser |
| **Letter spacing** | Headings may have negative tracking. Body text at 0 or default. | Measure in browser |
| **Vertical rhythm** | Spacing between sections consistent. Baseline grid or 8px grid system followed. | Visual measurement |
| **Content width** | Body text max-width 65-75ch for readability. | Measure in browser |

### 2.3 Layout & Responsiveness

| Check | Standard |
|-------|----------|
| **Breakpoint consistency** | Only defined breakpoints used. No ad-hoc media queries at arbitrary widths. |
| **Fluid vs adaptive** | Fluid layouts should use relative units (%, vw, fr). Adaptive should snap at breakpoints. No mixing. |
| **Overflow handling** | No horizontal scroll at any viewport. Text wraps correctly. Tables/wide content scroll within container. |
| **Touch targets** | Interactive elements ≥ 44×44px on mobile (WCAG 2.5.5). Adequate spacing between tappable items. |
| **Content order** | Logical reading order preserved across breakpoints. No content reordering that breaks flow. |

### 2.4 Component States Completeness

Every interactive component MUST handle all 5 states:

| State | Requirement |
|-------|------------|
| **Default** | Normal resting state, all content visible, interactions enabled |
| **Hover** | Visual feedback on mouse-over. Smooth transition (150-300ms). Cursor changes to pointer for clickable. |
| **Active/Pressed** | Visual feedback on click/tap. Immediate response (no delay). |
| **Focus** | Visible focus ring (keyboard navigation). Never remove outline without replacement. High contrast. |
| **Disabled** | Grayed out, reduced opacity (0.4-0.6), cursor: not-allowed, no interaction. |
| **Loading** | Skeleton or spinner. Content area preserved (no layout shift). Minimum display time 300ms to avoid flash. |
| **Empty** | Friendly message + illustration or icon. Clear call-to-action to populate data. |
| **Error** | Error message + retry action. Distinguish between user error and system error. |

### 2.5 Interaction Consistency

| Check | Standard |
|-------|----------|
| **Animation duration** | 150-300ms for micro-interactions. 300-500ms for page transitions. Consistent across app. No animations > 500ms for functional elements. |
| **Easing consistency** | Use consistent easing functions. `ease-out` for enter, `ease-in` for exit. Standard CSS easings only. |
| **Hover/active feedback** | Same interaction pattern on all clickable elements. No "dead" areas that look clickable. |
| **Form behavior** | Submit on Enter. Validation on blur (not on every keystroke). Error messages appear near the field. Disabled submit while invalid or submitting. |
| **Modal/Drawer behavior** | ESC to close. Click outside to close (if not destructive). Focus trap inside. Return focus to trigger on close. No scroll behind. |
| **Navigation** | Active state on current page. Back button works correctly. Breadcrumbs if > 2 levels deep. |
| **Feedback messages** | Toast/snackbar for transient success. Modal for confirmation. Inline for validation errors. Consistent position (top-right or bottom-center). Auto-dismiss after 5s for success. |

### 2.6 Design Review Report Format

```
## Design Review

### Visual Consistency
{Color audit: N hardcoded values found — must replace with tokens}
{Typography audit: N deviations from type scale}
{Spacing audit: N deviations from spacing scale}

### Component State Audit
{Component list with state coverage per component}
| Component | Default | Hover | Active | Focus | Disabled | Loading | Empty | Error |
|-----------|---------|-------|--------|-------|----------|---------|-------|-------|
| {name} | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ |

### Interaction Audit
{Issues found per interaction category}

### Layout & Responsiveness
{Issues found per viewport}

### Verdict
ISSUES FOUND: {N}
  BLOCKING: {N} — must fix before UI_ACCEPTED
  COSMETIC: {N} — fix in next iteration
PASS: 0 blocking issues
FAIL: {count} blocking issues
```

---

## QA Acceptance Gate Integration

### CODE_ACCEPTANCE now includes QA Phase 1

```
CODE_ACCEPTANCE Gate (updated):
[ ] All unit tests pass + coverage ≥ threshold
[ ] All functional tests pass (100% AC coverage)
[ ] All integration tests pass (endpoints + migrations)
[ ] QA CODE REVIEW: 0 critical issues, 0 high issues ← NEW
[ ] Type check: zero errors
[ ] Lint: zero errors
```

### UI_ACCEPTANCE now includes QA Phase 2

```
UI_ACCEPTANCE Gate (updated):
[ ] All Playwright E2E tests pass (all browsers + viewports)
[ ] Visual regression < 0.5% diff
[ ] axe-core: 0 critical, 0 serious
[ ] Lighthouse ≥ 90 (all categories)
[ ] QA DESIGN REVIEW: 0 blocking issues ← NEW
[ ] Bundle < 500KB (gzipped)
```

---

## QA Severity Classification

| Severity | Definition | Action |
|----------|-----------|--------|
| **Critical** | Security vulnerability, data loss risk, system crash, wrong business logic | BLOCK — must fix before any acceptance |
| **High** | Design flaw that will cause significant rework later, performance degradation > 50%, accessibility violation (WCAG A) | BLOCK — must fix before CODE_ACCEPTED / UI_ACCEPTED |
| **Medium** | Code smell that degrades maintainability but doesn't affect correctness, WCAG AA violation, duplicate code > 10 lines | FIX — should fix before merge, can be deferred with CR |
| **Low** | Style inconsistency, missing comment, minor duplication, cosmetic UI issue | NOTE — fix in next iteration, do not block |

---

## QA Tooling Integration

### Automated Checks (CI)

```bash
# Code quality — runs in CI, failing = blocking
npm run lint              # ESLint with strict config
npm run type-check        # TypeScript strict mode
npx jscpd src/            # Copy-paste detection (>10 lines, >3 occurrences = blocking)
npx dependency-cruiser    # Cyclic dependency detection
npx eslint-plugin-complexity  # Cognitive complexity check
```

### Design Consistency Checks

```bash
# Design token audit — runs in CI
npx stylelint --config .stylelintrc.json  # CSS/SCSS conventions
node scripts/check-design-tokens.js       # Custom: hardcoded colors, fonts, spacing detection
```

### Manual Review (AI Agent)

The QA review is performed by a dedicated agent using this standards document. The agent MUST:
1. Read every changed file
2. Apply all criteria in this document
3. Produce a structured finding list with severity classification
4. Link each finding to the specific line and criterion violated
5. Provide suggested fixes for each finding
