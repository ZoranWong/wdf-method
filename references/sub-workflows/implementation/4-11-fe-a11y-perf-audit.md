---
title: "Phase 4.11 — Accessibility & Performance Audit"
description: >
  Run comprehensive accessibility and performance audits on all implemented pages
  using Lighthouse, axe-core, and bundle analysis. Fix every failing metric until
  all scores meet or exceed the quality gates defined in customize.toml. This phase
  formalizes UI Acceptance results from Phase 4.10 and must LOCK before the frontend completion review.
sub_workflow: "4-11-fe-a11y-perf-audit"
phase: 4
sub_phase: "4.11"
version: "3.6.0"
inputs:
  - all implemented pages (from Phase 4.10)
outputs:
  - frontend-audit-report.md
dependencies:
  upstream: [phase_4_10]
  downstream: [phase_4_12]
---

# Phase 4.11 — Accessibility & Performance Audit

**Note:** This phase formalizes the UI Acceptance results from Phase 4.10. While Phase 4.10 runs `/bmad-ui-verify`, `/bmad-a11y-verify`, and `/bmad-perf-verify` per story, this phase audits the complete application as a whole.

## FSM State Transition Table

| Current State    | Valid Transition    | Trigger / Condition                                           | Next State      |
|:-----------------|:--------------------|:--------------------------------------------------------------|:----------------|
| NOT_STARTED      | START               | Gate Card passes; phase execution begins                      | IN_PROGRESS     |
| IN_PROGRESS      | A11Y_DONE           | All pages pass a11y audit (0 critical, 0 serious issues)      | A11Y_PASSED     |
| A11Y_PASSED      | PERF_DONE           | All pages meet Lighthouse perf thresholds + bundle size OK    | PERF_PASSED     |
| PERF_PASSED      | LOCK                | Audit report generated, all scores documented                 | LOCKED          |
| NOT_STARTED      | (none)              | —                                                             | —               |
| IN_PROGRESS      | FAIL                | Irrecoverable issue discovered                                | NOT_STARTED     |
| A11Y_PASSED      | FIX_PERF            | Performance regression detected                               | A11Y_PASSED     |
| PERF_PASSED      | UNLOCK              | Pages changed (Phase 4.10 reopened)                           | A11Y_PASSED     |

**Final State:** `LOCKED`
**State persistence:** `sprint-status.yaml` key `phase_4_11`

---

## Gate Card

```yaml
gate_card:
  phase: 4.11
  gates:
    - check: sprint_status.phase_4_10
      operator: equals
      expected: "ACCEPTED"
      fail_action: "HALT — Phase 4.10 (Page Implementation) must be ACCEPTED before running audits"
  gate_pass_action: "Set phase_4_11 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step-by-Step Instructions

### Step 1 — Gate Card Check

Read `{sprint_tracking}/sprint-status.yaml`. Verify:

```yaml
phase_4_10: ACCEPTED
```

Additionally, verify every story under `phase_4_10_stories` is `CODE_ACCEPTED`:

```yaml
phase_4_10_stories:
  STORY-004: CODE_ACCEPTED
  STORY-005: CODE_ACCEPTED
  STORY-007: CODE_ACCEPTED
  STORY-008: CODE_ACCEPTED
  # ... all must be CODE_ACCEPTED, none NOT_STARTED or IN_PROGRESS
```

If either check fails, **HALT** and report which stories are not yet code accepted.

If gates pass, update `sprint-status.yaml`:

```yaml
phase_4_11: IN_PROGRESS
```

---

### Step 2 — Accessibility Audit

#### 2a. Load Quality Gates

Read quality gate thresholds from `{project-root}/_bmad/custom/customize.toml` (or the project-level quality_gates configuration):

```toml
[acceptance_gates.ui_acceptance]
min_performance = 90
min_accessibility = 90
min_best_practices = 90
min_seo = 90
max_bundle_size_kb = 250
max_fcp_ms = 1500
max_tti_ms = 3500
max_lcp_ms = 2500
max_tbt_ms = 200
max_cls = 0.1
```

If no custom thresholds are defined, use the defaults above.

#### 2b. Run axe-core Audit

Audit every page using axe-core. Install if not already available:

```bash
npm install -D @axe-core/cli
```

For each page route, run:

```bash
npx axe http://localhost:5173/login --chrome-options="--headless=new" --save login-a11y.json
npx axe http://localhost:5173/dashboard --chrome-options="--headless=new" --save dashboard-a11y.json
npx axe http://localhost:5173/users --chrome-options="--headless=new" --save users-a11y.json
# ... all page routes
```

Alternatively, use `@axe-core/react` for runtime checks or the axe DevTools browser extension for manual inspection.

**Pass criteria (must meet ALL):**
- [ ] Zero **critical** issues across all pages
- [ ] Zero **serious** issues across all pages
- [ ] Moderate issues documented with justification and timeline for fix

#### 2c. Manual Accessibility Checks

Complement automated axe-core audits with manual checks on every page:

| Check                                       | How to Verify                                              |
|:--------------------------------------------|:-----------------------------------------------------------|
| Keyboard-only navigation                    | Tab through entire page; verify all interactive elements reachable and operable |
| Focus indicator visible                     | Check focus ring is visible on every focused element       |
| Screen reader flow                          | Use VoiceOver (Mac) or NVDA (Windows); verify content announced in logical order |
| Color contrast >= 4.5:1                     | Use axe DevTools or WebAIM contrast checker on every text element |
| Semantic HTML structure                     | Inspect for proper use of `<header>`, `<nav>`, `<main>`, `<footer>`, `<section>`, `<article>` |
| Alt text on all images                      | Inspect every `<img>` for `alt` attribute; decorative images use `alt=""` |
| Form labels                                 | Every `<input>`, `<select>`, `<textarea>` has an associated `<label>` (explicit or implicit) |
| Heading hierarchy                           | Verify one `<h1>`, no skipped levels (h1 → h3 without h2)  |
| Skip-to-content link                        | Verify skip link is the first focusable element            |
| Zoom to 200%                                | Verify layout does not break, no content clipped           |
| `prefers-reduced-motion`                    | Enable OS setting; verify all animations are disabled or reduced |
| Media (video/audio)                         | Captions/transcripts present if applicable                 |

#### 2d. Accessibility Fix Loop

For each failing check:
1. Identify the specific element(s) causing the issue
2. Implement the fix (add aria attributes, fix contrast, restructure HTML)
3. Re-run axe-core on that page
4. Confirm the issue is resolved
5. Log the fix in the audit report

Repeat until all pages pass both axe-core (0 critical, 0 serious) and the manual checklist.

When complete, update `sprint-status.yaml`:

```yaml
phase_4_11: A11Y_PASSED
```

---

### Step 3 — Performance Audit

#### 3a. Run Lighthouse Performance Audit

For each page route, run Lighthouse:

```bash
# Install Lighthouse CLI if not already available
npm install -D lighthouse

# Run on each page
npx lighthouse http://localhost:5173/login --output json --output-path reports/login-lighthouse.json --chrome-flags="--headless=new"
npx lighthouse http://localhost:5173/dashboard --output json --output-path reports/dashboard-lighthouse.json --chrome-flags="--headless=new"
npx lighthouse http://localhost:5173/users --output json --output-path reports/users-lighthouse.json --chrome-flags="--headless=new"
# ... all page routes
```

Extract key metrics for each page:

| Metric | Description                          | Target (from customize.toml) |
|:-------|:-------------------------------------|:-----------------------------|
| Performance | Overall perf score              | >= `min_performance` (default 90) |
| FCP     | First Contentful Paint              | < `max_fcp_ms` (default 1500ms) |
| LCP     | Largest Contentful Paint            | < `max_lcp_ms` (default 2500ms) |
| TTI     | Time to Interactive                 | < `max_tti_ms` (default 3500ms) |
| TBT     | Total Blocking Time                 | < `max_tbt_ms` (default 200ms) |
| CLS     | Cumulative Layout Shift             | < `max_cls` (default 0.1) |
| Accessibility | a11y score                    | >= `min_accessibility` (default 90) |
| Best Practices | Best practices score          | >= `min_best_practices` (default 90) |
| SEO     | SEO score                          | >= `min_seo` (default 90) |

#### 3b. Identify Performance Issues

Analyze Lighthouse reports for common issues:

- **Large render-blocking resources**: CSS/JS that blocks first paint
- **Unused JavaScript**: code splitting opportunities
- **Unoptimized images**: format (no WebP), size (not responsive), lazy loading missing
- **Excessive DOM size**: too many nodes causing slow rendering
- **Long main-thread tasks**: heavy computations blocking interactivity
- **Font loading strategy**: fonts not using `font-display: swap`
- **Third-party scripts**: render-blocking external resources
- **Cache policy**: missing cache headers for static assets

#### 3c. Performance Fix Loop

For each metric below threshold:

1. Identify root cause from Lighthouse recommendations
2. Implement fix:
   - **Code splitting**: lazy-load routes with `React.lazy()` / `defineAsyncComponent()`
   - **Image optimization**: convert to WebP, add `srcset` for responsive sizes, add `loading="lazy"`
   - **Font optimization**: preload critical fonts, use `font-display: swap`, subset fonts
   - **CSS optimization**: remove unused CSS, inline critical CSS
   - **JS optimization**: defer non-critical scripts, tree-shake imports
   - **Caching**: configure build tool for content-hashed filenames
3. Re-run Lighthouse on affected page
4. Confirm metric is now above threshold
5. Log the fix in the audit report

Repeat until ALL pages meet ALL performance thresholds.

---

### Step 4 — Bundle Analysis

#### 4a. Analyze Bundle Size

```bash
# Vite: use rollup-plugin-visualizer
npm install -D rollup-plugin-visualizer

# Or use vite-bundle-visualizer
npm install -D vite-bundle-visualizer
```

Configure in `vite.config.ts`:

```typescript
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    // ... other plugins
    visualizer({
      open: false,
      filename: 'reports/bundle-analysis.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
});
```

Build and analyze:

```bash
npm run build
# → Open reports/bundle-analysis.html to inspect module sizes
```

#### 4b. Bundle Size Verification

Check against thresholds from customize.toml:

- [ ] Total bundle size < `max_bundle_size_kb` (default 250KB gzipped)
- [ ] Largest individual chunk < 150KB gzipped
- [ ] Vendor chunk (node_modules) < 200KB gzipped

#### 4c. Code Splitting Verification

Verify every route uses lazy loading. Each page route should use dynamic import with Suspense boundary.

#### 4d. Tree Shaking Effectiveness

- [ ] No unused npm dependencies in `package.json` (run `npx depcheck`)
- [ ] Barrel exports use named exports (not `export *` from large modules)
- [ ] Production build does not include dev-only code

#### 4e. Image Optimization

- [ ] All images are in WebP format
- [ ] All images have explicit width/height attributes to prevent CLS
- [ ] All below-fold images use `loading="lazy"`
- [ ] SVG icons are inlined or sprited

#### 4f. Font Optimization

- [ ] Self-host fonts or use `preconnect` for Google Fonts
- [ ] Use `font-display: swap` on all `@font-face` declarations
- [ ] Subset fonts to required character sets
- [ ] Preload critical fonts in `<head>`

---

### Step 5 — Best Practices Audit

- [ ] Best Practices score >= `min_best_practices` (default 90)
- [ ] No console errors in production build
- [ ] No deprecated APIs used
- [ ] HTTPS used for all resources
- [ ] No vulnerable JavaScript libraries (run `npm audit`)
- [ ] CSP configured
- [ ] Security headers present (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)

---

### Step 6 — Fix Loop (Consolidated)

For ALL failing metrics collected across Steps 2–5, execute fix iterations until ALL metrics pass.

Update `sprint-status.yaml`:

```yaml
phase_4_11: PERF_PASSED
```

---

### Step 7 — Audit Report

Generate `{project-root}/frontend-audit-report.md`:

```yaml
---
artifact_id: "frontend-audit-report"
artifact_type: "report"
phase: "4.11"
status: "LOCKED"
created: "{iso-timestamp}"
pages_audited: 0
a11y_score_min: 0
a11y_score_max: 0
a11y_score_avg: 0
perf_score_min: 0
perf_score_max: 0
perf_score_avg: 0
best_practices_score_avg: 0
seo_score_avg: 0
fcp_avg_ms: 0
lcp_avg_ms: 0
tti_avg_ms: 0
tbt_avg_ms: 0
cls_avg: 0
bundle_size_kb: 0
critical_issues_resolved: 0
serious_issues_resolved: 0
quality_gates_passed: true
ui_acceptance_formalized: true
overrides:
  quality_gates_source: "customize.toml"
---
```

Report body must include:

**1. Overall Scores Summary Table**

| Page        | Perf | A11y | Best Prac. | SEO | FCP   | LCP   | TTI   | TBT  | CLS   |
|:------------|:-----|:-----|:-----------|:----|:------|:------|:------|:-----|:------|
| /login      | 95   | 98   | 95         | 92  | 1.0s  | 1.2s  | 1.8s  | 80ms | 0.01  |
| /dashboard  | 91   | 96   | 93         | 90  | 1.2s  | 1.9s  | 2.5s  | 150ms| 0.03  |
| /users      | 93   | 97   | 94         | 91  | 1.1s  | 1.8s  | 2.2s  | 120ms| 0.02  |
| **Avg**     | 93   | 97   | 94         | 91  | 1.1s  | 1.6s  | 2.2s  | 117ms| 0.02  |

**2. Page-by-Page Breakdown:** For each page, list the original scores, issues found, fixes applied, and final scores.

**3. Accessibility Issues Resolved:** List each issue with severity, page, fix applied, and before/after.

**4. Performance Issues Resolved:** List each issue with page, metric before, fix applied, metric after.

**5. Bundle Analysis:** Final bundle size, chunk breakdown, largest dependencies, code-splitting status.

**6. Recommendations for Future:** Any moderate a11y issues intentionally deferred, performance improvements for future iterations.

---

## Phase Complete

Lock the phase in `sprint-status.yaml`:

```yaml
phase_4_11: LOCKED
phase_4_11_artifact: "frontend-audit-report.md"
phase_4_11_locked_at: "{iso-timestamp}"
phase_4_11_scores:
  a11y_avg: 97
  perf_avg: 93
  best_practices_avg: 94
  bundle_size_kb: 198
```

This unlocks the gate for Phase 4.12 (Frontend Completion Review).
