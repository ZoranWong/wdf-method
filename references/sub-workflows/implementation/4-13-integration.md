---
sub_workflow: "4-13-integration"
phase: 4
sub_phase: "4.13"
version: "3.6.0"
title: "Phase 4.13 — Integration, Merge Queue & Feature Acceptance"
description: "Process the dependency-ordered Merge Queue, verify frontend-backend contract compliance, run E2E integration tests, conduct code review, resolve accumulated Change Requests, and achieve FEATURE ACCEPTANCE. V3.1 adds Merge Queue as the mandatory pre-integration step."
dependencies:
  - All backend artifacts (Phases 4.2-4.6)
  - All frontend artifacts (Phases 4.7-4.12)
  - api-spec.yaml
  - Merge Queue (global_state.merge_queue)
methodology: "Merge Queue Processing + Contract Verification + E2E Testing + Code Review"
bmad_skill: "/bmad-contract-verify, /bmad-e2e-verify, /bmad-e2e-browser-test, /bmad-visual-regression, /bmad-cross-browser-verify"
---

# Phase 4.13 — Integration, Merge Queue & Feature Acceptance

**Sub-Phase Goal:** Process the Merge Queue in dependency order, merging accepted stories into the main branch with integration checks. Then verify the complete application — contract compliance between frontend and backend, end-to-end tests passing, code quality gates met. **This sub-phase achieves FEATURE ACCEPTANCE** — the formal sign-off that the full application works as specified.

**Why Merge Queue First (V3.1):** In V3.0, stories were merged immediately after CODE_ACCEPTED. V3.1 introduces a dependency-ordered Merge Queue: stories are enqueued as they pass acceptance, but merging happens HERE in Phase 4.13, respecting `depends_on` ordering. This prevents premature merging of stories whose dependencies haven't been verified together.

**Acceptance Gates Achieved:**
- Merge Queue Processing (all queued items merged in dependency order)
- Contract Verification (frontend calls backend correctly per API spec)
- E2E Verification (critical user journeys pass automated tests)
- Browser Verification (visual regression, cross-browser, responsive)
- Feature Acceptance (formal sign-off)

**Duration:** One session. Runs once when both BE and FE tracks are complete.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin integration |
| `IN_PROGRESS` | Contract verification passes | `CONTRACT_VERIFIED` | API spec compliance confirmed |
| `CONTRACT_VERIFIED` | E2E critical paths pass | `E2E_VERIFIED` | Critical user journeys working |
| `E2E_VERIFIED` | Browser testing passes | `BROWSER_VERIFIED` | Cross-browser + responsive verified |
| `BROWSER_VERIFIED` | Code review + CRs resolved | `REVIEWED` | Quality gates passed |
| `REVIEWED` | Feature acceptance achieved | `APPROVED` | FEATURE_ACCEPTED |
| `APPROVED` | User signs off | `LOCKED` | Integration complete |

---

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "4.13"
  enters_from: ["4.6", "4.12"]
  checks:
    - id: "G4.13-01"
      description: "Phase 4.6 (BE Code Acceptance) is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_4.substates.phase_4_6.status"
      operator: "eq"
      expected: "LOCKED"

    - id: "G4.13-02"
      description: "Phase 4.12 (FE UI Acceptance) is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_4.substates.phase_4_12.status"
      operator: "eq"
      expected: "LOCKED"

    - id: "G4.13-03"
      description: "All non-blocked BE stories are CODE_ACCEPTED"
      type: "code_acceptance"
      source: "{sprint_tracking}"
      field: "phases.phase_4.substates.phase_4_6"

    - id: "G4.13-04"
      description: "All non-blocked FE stories are UI_ACCEPTED"
      type: "ui_acceptance"
      source: "{sprint_tracking}"
      field: "phases.phase_4.substates.phase_4_12"

    - id: "G4.13-05"
      description: "API spec is available and LOCKED"
      type: "artifact_metadata"
      source: "{api_spec_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]

    - id: "G4.13-06"
      description: "Backend completion review exists"
      type: "artifact_exists"
      source: "{be_code_acceptance_report}"

    - id: "G4.13-07"
      description: "Frontend completion review exists"
      type: "artifact_exists"
      source: "{fe_ui_acceptance_report}"

    - id: "G4.13-08"
      description: "User confirms readiness for integration"
      type: "user_confirmation"
  all_pass: false
```

**If gate fails:**

> "Both Backend (4.6) and Frontend (4.12) tracks must be LOCKED with all non-blocked stories CODE_ACCEPTED / UI_ACCEPTED before integration."
>
> "Current status: BE Code Acceptance={P4.6_STATUS}, FE UI Acceptance={P4.12_STATUS}"
>
> "Please complete the missing acceptance phase(s) first."

---

## Step 1: Gate Card Check

Evaluate all G4.13 checks. Record results in `{sprint_tracking}`.

Set `global_state.overall_status` to `ready_for_integration` once gate passes.

```yaml
phases:
  phase_4:
    substates:
      phase_4_13:
        status: "IN_PROGRESS"
        gate_card:
          all_pass: true
```

---

## Step 2: Load and Display Merge Queue (V3.6 — File-Based)

**Objective:** Load the merge queue from `merge-queue/items/` directory and display the current state before processing.

Read files from `merge-queue/items/` directory. Each file is one queued story.

Display the merge queue status:

```
═══════════════════════════════════════════
Merge Queue Status (File-Based V3.6)
═══════════════════════════════════════════
Order  Story ID      Track     Status              Depends On
────── ────────────  ────────  ──────────────────  ──────────
10     S-3.1         backend   ✅ merged           None
20     S-3.2         backend   ✅ merged           S-3.1
30     S-4.1         backend   🔄 queued           S-3.2
40     S-1.1         frontend  ⏳ queued           None
50     S-2.1         frontend  🔒 waiting_dep      S-4.1 (BE)

Summary: 2 merged, 2 queued, 1 waiting_dependency, 0 failed
```

If the `merge-queue/items/` directory is empty, skip the merge queue step and proceed directly to contract verification.

---

## Step 3: Process Merge Queue (V3.6 — Per-Item Files)

**Objective:** Process merge queue items in dependency order. Read each item file, sort by merge_order, merge in sequence.

**Algorithm:**

```
FOR each item_file IN merge-queue/items/ (sorted by filename = merge_order ASC):

  Read item file → get merge_status, story_id, branch, depends_on, integration_checks

  IF merge_status == "merged" or "failed":
    Skip — already processed. Continue.

  IF merge_status == "waiting_dependency":
    Re-check dependencies:
    FOR each dep_story_id IN depends_on:
      Read dep item file → get dep.merge_status
      IF dep.merge_status != "merged":
        Keep as waiting_dependency. Skip this item.
    IF all deps are merged:
      Update item file: merge_status = "queued" (NO LOCK — single writer)
      Display: "⬆ {story_id} promoted to queued"

  IF merge_status == "queued":
    Display: "🔄 Merging {story_id} (order {merge_order})..."

    1. git merge --no-commit --no-ff {branch}

    2. Run integration_checks:
       FOR each check:
         Execute check command.
         IF check fails:
           git merge --abort
           Update item file: merge_status = "failed", merge_failed_reason = "{reason}"
           Display: "✗ {story_id} merge FAILED"
           CONTINUE to next item.

    3. All checks passed:
       git commit --no-edit
       Update item file: merge_status = "merged", merged_at = "{ISO}", merge_commit = "{hash}"
       Display: "✓ {story_id} merged successfully"

    4. Promote waiting items:
       FOR each other item_file IN merge-queue/items/:
         IF other.merge_status == "waiting_dependency"
            AND all deps now merged:
           Update other item file: merge_status = "queued"
           Display: "⬆ {other.story_id} promoted to queued"
```

  IF item.merge_status == "failed":
    Display: "✗ {story_id} — previously failed: {item.merge_failed_reason}"
    Offer: "[R]etry [S]kip [E]xit"
    If retry: re-run integration checks.
    If skip: leave as failed, continue to next item.
    If exit: halt. Remaining queue items stay in current state.

END FOR
```

**After all items processed**, display the final merge queue summary:

```
═══════════════════════════════════════════
Merge Queue — Processing Complete
═══════════════════════════════════════════
Merged: 4 (S-3.1, S-3.2, S-4.1, S-1.1)
Failed: 0
Waiting: 1 (S-2.1 — depends on S-4.1 which is now merged)
  → S-2.1 automatically promoted to queued. Re-run merge queue or proceed.
═══════════════════════════════════════════
```

Update `{sprint_tracking}` with all merge status changes.

**Failed merge handling:**
- Failed items remain in `merge_status: "failed"` with reason recorded
- Downstream dependents remain `waiting_dependency`
- User must resolve the failure and retry, or file a CR to address the root cause

**After all queued items are processed**, proceed to Step 4 (Contract Compliance Verification).

---

## Step 4: Resolve Non-Blocking Change Requests

Non-blocking CRs accumulated during previous phases are addressed here.

Read all open non-blocking CRs from `{sprint_tracking}`:

```
Open Non-Blocking Change Requests:

| CR ID | Title | Source Phase | Discovered In | Status | Severity |
|-------|-------|-------------|---------------|--------|----------|
| CR-001 | ... | 3.7 | 4.4 | open | non-blocking |
| CR-002 | ... | 3.8 | 4.5 | open | non-blocking |
```

For each open non-blocking CR:

1. Present the CR details to the user
2. Determine resolution:
   - **Fix now** — Make the change, verify, update CR status to `resolved`
   - **Accept as-is** — Document justification, update CR status to `rejected`
   - **Upgrade to blocking** — Unlock source phase, fix artifact, re-approve, re-lock

**If a non-blocking CR is upgraded to blocking:**
- Unlock the source sub-phase
- Fix the artifact
- Re-run any impacted acceptance checks
- Re-approve and re-lock the source sub-phase
- This may require re-running impacted tests

---

## Step 5: Contract Compliance Verification

Invoke: `/bmad-contract-verify`

### 3.1 API Spec Compliance Matrix

Read `{api_spec_output}` and verify every endpoint defined in the spec has a corresponding backend implementation and frontend consumption:

| Spec Endpoint | Method | Backend Exists? | Returns Correct Shape? | Frontend Calls? | Sends Correct Shape? | Status |
|---------------|--------|-----------------|----------------------|-----------------|---------------------|--------|
| /api/v1/health | GET | ✅/❌ | ✅/❌ | N/A | N/A | PASS/FAIL |
| /api/v1/auth/login | POST | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | PASS/FAIL |
| /api/v1/auth/refresh | POST | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | PASS/FAIL |
| /api/v1/users | GET | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | PASS/FAIL |
| /api/v1/users/:id | GET | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | PASS/FAIL |
| ... | ... | ... | ... | ... | ... | ... |

### 3.2 Request/Response Shape Verification

For each endpoint consumed by the frontend:
- [ ] Frontend sends correct request body shape (matches spec schema exactly)
- [ ] Frontend handles the response shape (matches spec schema exactly)
- [ ] Frontend handles error responses correctly (400, 401, 403, 404, 422, 500)
- [ ] Auth tokens are passed in the correct header
- [ ] Content-Type headers are correct (application/json, multipart/form-data)
- [ ] Pagination parameters are handled correctly (page, limit, total, totalPages)

### 3.3 Contract Gap Reporting

For any gaps found, classify severity:

| Gap Type | Example | Severity |
|----------|---------|----------|
| Backend missing endpoint | Spec has GET /users, backend doesn't implement | blocking |
| Wrong response shape | Backend returns `{users: [...]}` but spec says `{data: [...]}` | blocking |
| Frontend not consuming endpoint | Spec endpoint exists, backend has it, frontend doesn't call it | non-blocking if not required by stories |
| Auth mismatch | Spec says public, but endpoint requires auth | blocking |
| Error format mismatch | Spec defines error schema, backend returns different format | non-blocking |

File CRs for any gaps discovered.

Transition: `IN_PROGRESS` → `CONTRACT_VERIFIED` (only when all blocking gaps resolved).

---

## Step 6: E2E Integration Testing

Invoke: `/bmad-e2e-verify`

### 4.1 Identify Critical User Journeys

From the PRD, stories, and epics, identify 3-5 critical user journeys:

1. **Registration & Onboarding:** Sign up → verify email → complete profile → see dashboard
2. **Core Feature Flow:** Login → navigate to {feature} → create {resource} → view {resource} → edit {resource} → delete {resource}
3. **Error Recovery:** Attempt invalid action → see error message → correct and retry → succeed
4. **Auth Lifecycle:** Login → token refresh → access protected resource → token expiry handling → logout
5. **Edge Cases:** Empty states, concurrent edits, session timeout, network failures

### 4.2 Automated E2E Test Setup

Ensure E2E tests cover the critical journeys:

```
tests/e2e/
├── auth.spec.ts         # Login, register, logout, token refresh
├── users.spec.ts        # User CRUD operations
├── {resource}.spec.ts   # Resource-specific flows
└── navigation.spec.ts   # Page navigation, protected routes
```

### 4.3 Run E2E Tests

Execute the E2E test suite:

```
Running E2E Integration Tests:

  [1/5] auth.spec.ts
    ✓ User can register with valid data
    ✓ User can login with valid credentials
    ✓ User cannot login with invalid credentials
    ✓ Token refresh works correctly
    ✓ User can logout
    Result: 5 pass, 0 fail

  [2/5] users.spec.ts
    ✓ List users with pagination
    ✓ View user details
    ✓ Update user profile
    ✓ Delete user (admin only)
    ✓ Normal user cannot delete
    Result: 5 pass, 0 fail

  ...

  Overall: {N}/{total} pass, {F} fail, {S} skip
```

### 4.4 Critical Journey Walkthrough

For each critical journey identified in 4.1:
- [ ] Start from a clean state (fresh browser, no cached tokens)
- [ ] Walk through every step end-to-end
- [ ] Document any bugs, UX issues, or performance problems
- [ ] Verify all acceptance criteria from the relevant stories are met

Transition: `CONTRACT_VERIFIED` → `E2E_VERIFIED` (only when all critical journeys pass).

---

## Step 7: Browser Verification

Invoke: `/bmad-e2e-browser-test`, `/bmad-visual-regression`, `/bmad-cross-browser-verify`

### 5.1 Cross-Browser Testing

Verify the application works on all target browsers:

| Browser | Version | Critical Journey 1 | Critical Journey 2 | Critical Journey 3 | Status |
|---------|---------|-------------------|-------------------|-------------------|--------|
| Chrome | latest | ✅ PASS | ✅ PASS | ✅ PASS | PASS |
| Firefox | latest | ✅ PASS | ✅ PASS | ✅ PASS | PASS |
| Safari | latest | ✅ PASS | ✅ PASS | ✅ PASS | PASS |
| Edge | latest | ✅ PASS | ⚠️ MINOR | ✅ PASS | PASS (with notes) |

### 5.2 Responsive Design Verification

Verify layout at all target breakpoints:

| Breakpoint | Width | Pages Verified | Status |
|------------|-------|---------------|--------|
| Mobile | 375px | Home, Login, Dashboard, User List | PASS |
| Tablet | 768px | Home, Login, Dashboard, User List | PASS |
| Desktop | 1280px | Home, Login, Dashboard, User List | PASS |
| Wide | 1920px | Home, Login, Dashboard, User List | PASS |

### 5.3 Visual Regression Testing

Run visual regression tests:

```
Visual Regression Results:

  Page "Login": 0.03% difference — WITHIN THRESHOLD
  Page "Dashboard": 0.12% difference — WITHIN THRESHOLD
  Page "User List": 0.45% difference — WITHIN THRESHOLD
  Page "User Detail": 0.08% difference — WITHIN THRESHOLD

  Overall: 4/4 pages pass visual regression (< {threshold}% difference)
```

### 5.4 Network Condition Testing

Verify performance under realistic network conditions:

| Condition | Latency | Bandwidth | Critical Journey | Status |
|-----------|---------|-----------|-----------------|--------|
| Fast 4G | 20ms | 50 Mbps | Login → Dashboard | PASS |
| Slow 3G | 400ms | 1.6 Mbps | Login → Dashboard | PASS (with loading states) |
| Offline → Online | varies | varies | Login → Dashboard | PASS (error states work) |

Transition: `E2E_VERIFIED` → `BROWSER_VERIFIED`.

---

## Step 8: Code Review

### 6.1 Backend Code Review

Invoke: `/bmad-code-review`

**Review focus areas:**
- RESTful API conventions followed
- Input validation on all endpoints
- Error handling is consistent with API spec
- SQL injection prevention (parameterized queries)
- Auth middleware applied correctly
- No secrets or credentials in code
- Test coverage and quality
- N+1 query patterns eliminated
- Proper HTTP status codes used

### 6.2 Frontend Code Review

Invoke: `/bmad-code-review`

**Review focus areas:**
- Component structure and reusability
- All UI states handled (loading, empty, error, success)
- Accessibility compliance (ARIA labels, keyboard navigation, semantic HTML)
- No hardcoded API URLs (use environment variables or config)
- Token management (secure storage, refresh flow)
- No memory leaks (cleanup in useEffect/onUnmount)
- Bundle size and code splitting
- Responsive design implementation

### 6.3 Shared Concerns Review

- Type consistency between frontend and backend
- Environment variable documentation (`.env.example` files)
- README with setup, run, test, and deploy instructions
- Package.json scripts (dev, build, test, lint, type-check)
- CI/CD configuration (if applicable)
- No unused dependencies
- All npm audit critical/high vulnerabilities addressed

Transition: `BROWSER_VERIFIED` → `REVIEWED`.

---

## Step 9: Performance & Security Audit

### 7.1 Performance Checklist

**Backend:**
- [ ] Database queries are indexed based on query patterns
- [ ] N+1 queries eliminated
- [ ] Response times < 200ms for simple queries (p95)
- [ ] Rate limiting is configured and tested
- [ ] Response compression is enabled (gzip/brotli)
- [ ] Cache headers are set appropriately

**Frontend:**
- [ ] Lighthouse Performance >= `{quality_gates.phase_4_min_lighthouse_performance}`
- [ ] Lighthouse Accessibility >= `{quality_gates.phase_4_min_lighthouse_accessibility}`
- [ ] Lighthouse Best Practices >= `{quality_gates.phase_4_min_lighthouse_best_practices}`
- [ ] Lighthouse SEO >= `{quality_gates.phase_4_min_lighthouse_seo}` (if applicable)
- [ ] FCP (First Contentful Paint) < 1.5s
- [ ] LCP (Largest Contentful Paint) < 2.5s
- [ ] TBT (Total Blocking Time) < 200ms
- [ ] CLS (Cumulative Layout Shift) < 0.1
- [ ] Bundle size < `{quality_gates.phase_4_max_bundle_size_kb}`KB
- [ ] Code splitting reduces initial bundle
- [ ] No render-blocking resources

### 7.2 Security Checklist

- [ ] HTTPS enforced in production
- [ ] CORS configured for specific origins (not wildcard)
- [ ] Security headers present (CSP, X-Content-Type-Options, X-Frame-Options, etc.)
- [ ] JWT expiration is reasonable (access: 15-60min, refresh: 7-30d)
- [ ] Passwords hashed with bcrypt/argon2
- [ ] Input sanitization on all user inputs
- [ ] XSS prevention (framework default escaping, CSP headers)
- [ ] CSRF protection (if using cookie-based sessions)
- [ ] No sensitive data in client-side local/session storage
- [ ] No sensitive data in console logs or network responses
- [ ] `npm audit` / dependency scan shows no critical or high vulnerabilities
- [ ] Rate limiting on auth endpoints (login, register, refresh)
- [ ] Account lockout after N failed login attempts

---

## Step 10: Documentation Verification

Verify the following documentation exists and is accurate:

- [ ] **README.md** — Project overview, setup instructions, run scripts, test commands, deploy steps
- [ ] **API Documentation** — OpenAPI spec accessible (Swagger UI / Redoc), or rendered docs
- [ ] **Environment Variables** — `.env.example` with descriptions for all required variables
- [ ] **Database Setup** — Migration instructions, seed data commands
- [ ] **Architecture Overview** — Up-to-date architecture docs reflecting any deviations
- [ ] **Deployment Guide** — How to deploy to chosen platform (Docker, Vercel, AWS, etc.)
- [ ] **Contributing Guide** — If applicable, how to contribute

---

## Step 11: Feature Acceptance

This is the **FEATURE ACCEPTANCE** gate — verifying the full-stack feature works as specified.

Present the feature acceptance summary:

```
═══════════════════════════════════════════════
FEATURE ACCEPTANCE
═══════════════════════════════════════════════

Contract Compliance:  ✅ PASS  ({N}/{N} endpoints verified)
E2E Critical Paths:   ✅ PASS  ({M}/{M} journeys passed)
Cross-Browser:        ✅ PASS  ({B} browsers verified)
Responsive Design:    ✅ PASS  ({R} breakpoints verified)
Visual Regression:    ✅ PASS  ({P} pages within {threshold}% difference)
Code Review:          ✅ PASS  (BE + FE reviewed)
Performance:          ✅ PASS  (Lighthouse {perf}/{a11y}/{bp})
Security Audit:       ✅ PASS  ({S}/{S} checks passed)
CRs Resolved:         ✅ PASS  ({C} resolved, 0 remaining)
Documentation:        ✅ PASS  ({D} docs verified)

FEATURE ACCEPTANCE:   ✅ ACHIEVED
```

> "All feature acceptance checks have passed. The application is ready for formal sign-off."
>
> "Do you approve feature acceptance? [Y] Approve [N] Review Details"

When user approves:

Transition: `REVIEWED` → `APPROVED`.

---

## Step 12: Generate Integration Report

Generate `{integration_output}` with frontmatter:

```yaml
---
artifact_type: "integration_report"
artifact_id: "{project}-integration-report-v1"
phase: 4
sub_phase: "4.13"
status: "approved"
version: "3.6.0"
created_at: "{ISO_TIMESTAMP}"
approved_at: "{ISO_TIMESTAMP}"
---

## Integration Report
...

### Report Sections

1. **Contract Compliance Results** — Endpoint-by-endpoint verification matrix
2. **E2E Test Results** — Critical journey pass/fail with screenshots where relevant
3. **Browser Verification** — Cross-browser, responsive, visual regression results
4. **Code Review Summary** — Key findings, resolved issues, recommendations
5. **Performance Metrics** — Lighthouse scores, API response times, Core Web Vitals
6. **Security Audit Results** — Checklist with pass/fail per item
7. **Change Request Resolution** — All CRs resolved in this phase with resolution notes
8. **Issues Found & Resolved** — All issues discovered during integration
9. **Feature Acceptance** — APPROVED / APPROVED WITH CONDITIONS / REJECTED
```

---

## Step 13: Final Approval & Lock

Transition: `APPROVED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
global_state:
  feature_acceptance_achieved_at: "{ISO_TIMESTAMP}"
  overall_status: "feature_accepted"

phases:
  phase_4:
    substates:
      phase_4_13:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "CONTRACT_VERIFIED", at: "{ISO}" }
          - { state: "E2E_VERIFIED", at: "{ISO}" }
          - { state: "BROWSER_VERIFIED", at: "{ISO}" }
          - { state: "REVIEWED", at: "{ISO}" }
          - { state: "APPROVED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "integration_report", path: "{integration_output}", status: "locked" }
        metrics:
          contract_compliance: "PASS"
          e2e_critical_journeys_pass: {M}/{M}
          cross_browser_support: {B} browsers
          performance_score: {score}
          lighthouse_performance: {score}
          lighthouse_accessibility: {score}
          lighthouse_best_practices: {score}
          security_checks_pass: {S}/{S}
          issues_found: {count}
          issues_resolved: {count}
          crs_resolved: {count}
        acceptance_gate:
          feature_acceptance: "FEATURE_ACCEPTED"
          feature_accepted_at: "{ISO_TIMESTAMP}"
        gate_card:
          all_pass: true
        change_requests:
          - { id: "CR-XXX", status: "resolved", resolved_at: "{ISO}" }
```

---

## Step 14: Completion

Present final integration summary:

> "Phase 4.13 complete — Integration & FEATURE ACCEPTANCE LOCKED."
>
> "### Integration Results"
> "| Gate | Status |"
> "|------|--------|"
> "| Contract Compliance | {N}/{N} endpoints PASS |"
> "| E2E Critical Journeys | {M}/{M} journeys PASS |"
> "| Cross-Browser | {B} browsers PASS |"
> "| Responsive Design | {R} breakpoints PASS |"
> "| Code Review | PASS |"
> "| Performance | Lighthouse {perf}/{a11y}/{bp} |"
> "| Security Audit | {S}/{S} checks PASS |"
> "| Change Requests | {C} resolved |"
>
> "**Integration Report:** `{integration_output}`"
> "**Feature Acceptance:** ACHIEVED"
>
> "Next: Phase 4.14 — Retrospective."

Return to the Phase 4 sub-phase menu.
