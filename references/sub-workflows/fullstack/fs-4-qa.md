---
sub_workflow: "fullstack-4"
phase: 4
sub_phase: "fs-4"
version: "3.6.0"
title: "Full-Stack QA & Acceptance Gates"
description: "Execute all 3 acceptance gates for the full-stack application: FEATURE ACCEPTANCE, UI ACCEPTANCE, and E2E BROWSER ACCEPTANCE. This is the quality gate before final review."
dependencies:
  - sprint-status.yaml
  - All fs-3 stories APPROVED
  - design-acceptance.md
  - user-flows.md
mode: "full_stack"
bmad_skill: "/bmad-feature-verify"
skip: false

# V3.6 Parity Mapping — mirrors separated-mode 4.13 integration gates
v36_parity:
  feature_acceptance: "All stories CODE_ACCEPTED → /bmad-feature-verify → FEATURE_ACCEPTED"
  ui_acceptance: "FEATURE_ACCEPTED → /bmad-ui-verify + /bmad-a11y-verify + /bmad-perf-verify → UI_ACCEPTED"
  e2e_browser: "UI_ACCEPTED → /bmad-e2e-browser-test + /bmad-visual-regression + /bmad-cross-browser-verify → E2E_BROWSER_ACCEPTED"
  acceptance_thresholds: "customize.toml [acceptance_gates] — Lighthouse >= 90, bundle < 500KB, axe clean, visual diff < 0.5%"
  contract_compliance: "feature_acceptance_require_contract_compliance — API endpoints must match api-spec.yaml exactly"
  security_audit: "feature_acceptance_require_security_audit — OWASP top 10 or dependency audit required"
  fallback_skills: "Each BMAD verify skill has fallback per customize.toml [bmad_skill_fallbacks]"
---

# Full-Stack 4 — QA & Acceptance Gates

**Sub-Phase Goal:** Execute all acceptance gates on the full-stack application in sequence: FEATURE ACCEPTANCE (full integration) → UI ACCEPTANCE (visual + a11y + performance) → E2E BROWSER ACCEPTANCE (real browser journeys).

**Gate:** Full-Stack 3 must be APPROVED. All non-blocked stories must be CODE_ACCEPTED.

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate passes | `IN_PROGRESS` | QA begins |
| `IN_PROGRESS` | Feature acceptance passes | `FEATURE_ACCEPTED` | Full-stack integration OK |
| `FEATURE_ACCEPTED` | UI acceptance passes | `UI_ACCEPTED` | Visual + a11y + perf OK |
| `UI_ACCEPTED` | E2E browser acceptance passes | `E2E_BROWSER_ACCEPTED` | Browser flows OK |
| `E2E_BROWSER_ACCEPTED` | Report generated | `APPROVED` | QA complete |
| `APPROVED` | User confirmation | `LOCKED` | Ready for review |

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "fs-4"
  enters_from: "fs-3"
  checks:
    - id: "GFS4-01"
      description: "Full-Stack 3 status is APPROVED"
      type: "dependency_status"
      field: "phases.phase_4.substates.phase_fs_3.status"
      operator: "eq"
      expected: "APPROVED"
    - id: "GFS4-02"
      description: "All non-blocked fs-3 stories are CODE_ACCEPTED"
      type: "all_stories_complete"
      field: "phases.phase_4.substates.phase_fs_3.stories"
      condition: "status == APPROVED OR status == BLOCKED_BY_DEPENDENCY"
  all_pass: false
```

---

## Step 0: Load Artifacts

Read:
- `{design_acceptance_output}` — visual/UX acceptance criteria
- `{user_flows_output}` — critical user journeys
- `{wireframes_output}` — design baselines for visual regression
- `{sprint_tracking}` — all story statuses and acceptance results

## Step 1: Gate Check

Evaluate GFS4 checks. Abort if any fail.

---

## Step 2: FEATURE ACCEPTANCE (Full-Stack Feature Verification)

Executed when ALL stories in the full-stack track are CODE_ACCEPTED.

### 2a. BMAD Feature Verification

```bash
/bmad-feature-verify full-stack
```

**Checks:**
- All story acceptance criteria satisfied
- Cross-story integration points validated (BE API → FE consumption)
- Requirements traceability verified (story → epic → PRD)
- No orphaned endpoints or unused components

### 2b. API Contract Compliance

```bash
/bmad-contract-verify spec={api-spec.yaml}
```

**Checks:**
- All API routes match OpenAPI spec exactly
- Request/response schemas match
- Error response formats compliant
- Auth middleware applied correctly to protected routes

### 2c. End-to-End Critical Paths

```bash
/bmad-e2e-verify paths={critical_user_journeys}
```

Run Playwright/Cypress tests for critical user journeys.

**Checks:**
- Login → navigate → interact → logout full lifecycle
- Form submission with validation
- Data persistence across page navigations
- Error state handling and recovery

### 2d. Record FEATURE ACCEPTANCE

```yaml
feature_acceptance:
  all_stories_code_accepted: true
  contract_verified: true
  e2e_critical_paths_pass: true
  verified_at: "{ISO}"
  status: "FEATURE_ACCEPTED"
```

---

## Step 3: UI ACCEPTANCE

Executed after FEATURE ACCEPTANCE passes.

### 3a. BMAD UI Verification

```bash
/bmad-ui-verify design_spec={design-acceptance.md}
```

**Checks:**
- Design-to-code visual parity (matches wireframes from Phase 2)
- All UI states: loading, empty, error, success, edge cases
- Interaction patterns match design specs
- Responsive breakpoints verified

### 3b. BMAD Accessibility Audit

```bash
/bmad-a11y-verify pages={all_pages}
```

**Checks:**
- axe audit: 0 critical issues, 0 serious issues
- Keyboard navigation: all interactive elements reachable
- Color contrast: WCAG AA minimum
- Screen reader: landmarks and ARIA labels correct
- Focus management: visible focus indicators

### 3c. BMAD Performance Audit

```bash
/bmad-perf-verify pages={all_pages}
```

**Checks:**
- Lighthouse Performance >= 90 (configurable)
- Lighthouse Accessibility >= 90
- Lighthouse Best Practices >= 90
- Bundle size < 500KB (configurable)
- FCP < 1.5s, LCP < 2.5s, TBT < 200ms

### 3d. Record UI ACCEPTANCE

```yaml
ui_acceptance:
  visual_parity: pass
  a11y_audit: { critical: 0, serious: 0 }
  lighthouse: { performance: {score}, accessibility: {score}, best_practices: {score} }
  bundle_size_kb: {size}
  verified_at: "{ISO}"
  status: "UI_ACCEPTED"
```

---

## Step 4: E2E BROWSER ACCEPTANCE

Executed after UI ACCEPTANCE passes.

### 4a. BMAD E2E Browser Flow Test

```bash
/bmad-e2e-browser-test journey_spec={user-flows.md} driver=playwright mode=real-code-logic
```

**Checks:**
- All critical user journeys pass in real browser
- Code logic paths verified (not mocked)
- Session lifecycle: login → navigate → interact → logout
- Form flows: validation errors, success, network-failure recovery
- Auth flows: token refresh, session expiry, unauthorized redirect
- Route guards: protected routes redirect unauthenticated users
- Navigation: all routes accessible, 404 page shown for unknown routes

### 4b. BMAD Visual Regression Test

```bash
/bmad-visual-regression pages={all_pages} baseline={wireframes.md} threshold=0.5%
```

**Checks:**
- Screenshot diff vs design baseline < 0.5% pixel difference
- No unexpected layout shifts
- Text content matches expected copy

### 4c. BMAD Cross-Browser Verification

```bash
/bmad-cross-browser-verify pages={all_pages} browsers=[chrome,firefox,safari]
```

**Checks:**
- Chrome: all E2E flows pass
- Firefox: all E2E flows pass
- Safari: all E2E flows pass
- Responsive: mobile, tablet, desktop breakpoints verified in real viewports
- Network: slow 3G, offline state handling verified

### 4d. Record E2E BROWSER ACCEPTANCE

```yaml
e2e_browser_acceptance:
  browser_tests_pass: true
  visual_regression_pct_diff: {pct}
  cross_browser: { chrome: pass, firefox: pass, safari: pass }
  responsive: { mobile: pass, tablet: pass, desktop: pass }
  network_conditions: { slow_3g: pass, offline: pass }
  verified_at: "{ISO}"
  status: "E2E_BROWSER_ACCEPTED"
```

---

## Step 5: Generate QA Report

Create `_wdf_output/_output/acceptance/qa-report.md`:

```markdown
# Full-Stack QA Report

## Feature Acceptance
- All stories CODE_ACCEPTED: {N}/{N} ✓
- Contract compliance: ✓
- E2E critical paths: {pass}/{total} pass

## UI Acceptance
- Visual parity: ✓
- Accessibility: 0 critical, 0 serious
- Lighthouse: P={p} A={a} BP={bp}
- Bundle: {kb}KB

## E2E Browser Acceptance
- Browser tests: ✓ (Chrome, Firefox, Safari)
- Visual regression: {pct}% diff
- Responsive: ✓ (mobile, tablet, desktop)
- Network: slow 3G ✓, offline ✓

## Acceptance Gates Status
| Gate | Status |
|------|--------|
| CODE_ACCEPTANCE (per story) | ✓ |
| FEATURE_ACCEPTANCE (full-stack) | ✓ |
| UI_ACCEPTANCE | ✓ |
| E2E_BROWSER_ACCEPTANCE | ✓ |
```

## Step 6: Record State

```yaml
phases:
  phase_4:
    substates:
      phase_fs_4:
        status: "APPROVED"
        acceptance_gates:
          feature_acceptance:
            status: "FEATURE_ACCEPTED"
            all_stories_code_accepted: true
            contract_verified: true
            e2e_critical_paths_pass: true
          ui_acceptance:
            status: "UI_ACCEPTED"
            visual_parity: pass
            a11y_audit: { critical: 0, serious: 0 }
            lighthouse: { performance: {score}, accessibility: {score}, best_practices: {score} }
            bundle_size_kb: {size}
          e2e_browser_acceptance:
            status: "E2E_BROWSER_ACCEPTED"
            browser_tests_pass: true
            visual_regression_pct_diff: {pct}
            cross_browser: { chrome: pass, firefox: pass, safari: pass }
```

## Phase Complete

```
═══════════════════════════════════════════
Full-Stack 4 — QA & Acceptance Complete
═══════════════════════════════════════════
FEATURE ACCEPTANCE  ✓  (all stories, contract, critical paths)
UI ACCEPTANCE       ✓  (visual, a11y, performance)
E2E BROWSER ACCT.   ✓  (browser flows, visual regression, cross-browser)

Next: Full-Stack 5 — Final Review & Delivery
```
