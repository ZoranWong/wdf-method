---
sub_workflow: "fullstack-5"
phase: 4
sub_phase: "fs-5"
version: "3.6.0"
title: "Full-Stack Review & Delivery"
description: "Final adversarial code review, delivery checklist verification, and project retrospective for the full-stack application."
dependencies:
  - fs-4 QA report (all acceptance gates passed)
  - sprint-status.yaml
  - All story handoff documents
mode: "full_stack"
bmad_skill: "/bmad-code-review"

# V3.6 Parity Mapping
v36_parity:
  code_review: "CA-01 — adversarial review with fallback per customize.toml [bmad_skill_fallbacks.bmad_code_review]"
  security_audit: "10-point checklist per 4-6-be-completion-review.md"
  merge_queue: "specs/merge-queue.md — dependency-ordered, hidden overlap detection"
  atomic_merge: "specs/worktree-isolation.md — git merge --no-commit --no-ff → checks → commit|abort"
  delivery_checklist: "10 items: merged, tests pass, a11y clean, perf met, bundle ok, contracts verified, security audited, docs complete, CRs resolved, retrospective done"
  - All story handoff documents
mode: "full_stack"
bmad_skill: "/bmad-code-review"
skip: false
---

# Full-Stack 5 — Review & Delivery

**Sub-Phase Goal:** Conduct a final adversarial code review of the entire full-stack application, verify the delivery checklist, and generate the retrospective. This is the final quality gate before declaring the project complete.

**Gate:** Full-Stack 4 must be APPROVED (all acceptance gates passed).

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate passes | `IN_PROGRESS` | Review begins |
| `IN_PROGRESS` | Code review complete | `REVIEWED` | Review finished |
| `REVIEWED` | Retrospective complete | `COMPLETED` | Retro done |
| `COMPLETED` | User sign-off | `LOCKED` | Project delivered |

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "fs-5"
  enters_from: "fs-4"
  checks:
    - id: "GFS5-01"
      description: "Full-Stack 4 status is APPROVED"
      type: "dependency_status"
      field: "phases.phase_4.substates.phase_fs_4.status"
      operator: "eq"
      expected: "APPROVED"
    - id: "GFS5-02"
      description: "All acceptance gates passed in fs-4"
      type: "custom_check"
      rule: "feature_acceptance.status == FEATURE_ACCEPTED AND ui_acceptance.status == UI_ACCEPTED AND e2e_browser_acceptance.status == E2E_BROWSER_ACCEPTED"
  all_pass: false
```

---

## Step 0: Load Artifacts

Read:
- `{sprint_tracking}` — all phase states, story statuses, acceptance results
- `{qa_report}` — fs-4 QA report with acceptance gate results
- All story handoff documents from `_story-output/*/handoff.md`
- `{architecture_output}` — architecture.md for architectural compliance
- `{api_spec_output}` — for contract verification results

## Step 1: Gate Check

Evaluate GFS5 checks. Abort if any fail.

---

## Step 2: Final Code Review (Adversarial)

Execute a comprehensive adversarial code review of the entire full-stack codebase:

```bash
/bmad-code-review mode=adversarial scope=full-stack context=independent
```

### Review Focus Areas

1. **Security** (OWASP Top 10):
   - SQL/NoSQL injection prevention
   - XSS protection (input sanitization, CSP headers)
   - CSRF protection (tokens, SameSite cookies)
   - Authentication/authorization enforcement
   - Sensitive data exposure (env vars, logging, error messages)
   - Rate limiting effectiveness

2. **Architecture Compliance**:
   - Does implementation match architecture.md and component-design.md?
   - Are all API routes defined in api-spec.yaml implemented?
   - Is the database schema consistent with db-schema.md?
   - Are separation of concerns maintained?

3. **Code Quality**:
   - TypeScript strict mode violations
   - Dead code or commented-out blocks
   - Error handling completeness (no swallowed errors)
   - Consistent naming conventions
   - Appropriate use of design patterns

4. **Testing Coverage**:
   - Unit test coverage >= 80% (configurable)
   - Integration tests for critical paths
   - E2E tests for user journeys
   - Edge case coverage

5. **Performance**:
   - N+1 query detection
   - Missing database indexes
   - Unnecessary re-renders (FE)
   - Large bundle dependencies
   - Image optimization

### Review Output

Generate `_bmad-output/web-dev-flow/_output/acceptance/code-review-report.md`:

```markdown
# Final Code Review Report

## Security
- Issues: {N} (critical: {C}, high: {H}, medium: {M}, low: {L})
- OWASP Top 10 compliance: ✓

## Architecture Compliance
- API spec coverage: {N}/{total} endpoints ✓
- DB schema consistency: ✓
- Component design compliance: ✓

## Code Quality
- TypeScript: 0 strict mode errors
- Dead code: 0 blocks
- Error handling: complete ✓
- Conventions: consistent ✓

## Test Coverage
- Overall: {pct}%
- Unit: {pct}%
- Integration: {pct}%
- E2E: {pass}/{total} pass

## Recommendations
{Any non-blocking improvements or technical debt to track}
```

---

## Step 3: Delivery Checklist

Verify each item:

```yaml
delivery_checklist:
  - id: "DL-01"
    description: "All stories APPROVED (or BLOCKED_BY_DEPENDENCY with documentation)"
    check: "count(stories where status != 'APPROVED' AND status != 'BLOCKED_BY_DEPENDENCY') == 0"
    result: null

  - id: "DL-02"
    description: "CODE ACCEPTANCE passed for all stories"
    check: "count(stories where code_acceptance.review_passed != true) == 0"
    result: null

  - id: "DL-03"
    description: "FEATURE ACCEPTANCE passed (full-stack)"
    check: "feature_acceptance.status == 'FEATURE_ACCEPTED'"
    result: null

  - id: "DL-04"
    description: "UI ACCEPTANCE passed"
    check: "ui_acceptance.status == 'UI_ACCEPTED'"
    result: null

  - id: "DL-05"
    description: "E2E BROWSER ACCEPTANCE passed"
    check: "e2e_browser_acceptance.status == 'E2E_BROWSER_ACCEPTED'"
    result: null

  - id: "DL-06"
    description: "No blocking Change Requests open"
    check: "count(CRs where severity == 'blocking' AND status == 'open') == 0"
    result: null

  - id: "DL-07"
    description: "Environment variables documented (.env.example)"
    check: "artifact_exists('.env.example')"
    result: null

  - id: "DL-08"
    description: "README with setup instructions exists"
    check: "artifact_exists('README.md')"
    result: null

  - id: "DL-09"
    description: "Build succeeds (npm run build)"
    check: "shell: npm run build (exit 0)"
    result: null

  - id: "DL-10"
    description: "All tests pass (npm test)"
    check: "shell: npm test (exit 0)"
    result: null
```

---

## Step 4: Retrospective

Execute a BMAD retrospective:

```bash
/bmad-retrospective project={project_name} phases=1-4
```

**Retrospective Topics:**

1. **What Went Well:**
   - Phases that completed smoothly
   - Stories that were well-defined and easy to implement
   - Acceptance gates that caught real issues
   - BMAD skills that added the most value

2. **What Could Be Improved:**
   - Phases that required rework or CRs
   - Stories with scope creep or unclear acceptance criteria
   - Bottlenecks in the development process
   - Areas where handoff documents were insufficient

3. **Technical Debt Identified:**
   - Deferred refactoring items
   - Performance optimizations for later
   - Security hardening recommendations
   - Library upgrades to consider

4. **Process Improvements:**
   - Gate Card threshold adjustments
   - Acceptance check additions/removals
   - Sub-phase sequencing optimizations
   - BMAD skill invocation timing refinements

Generate: `_bmad-output/web-dev-flow/_output/retrospective.md`

---

## Step 5: Final State Update

```yaml
phases:
  phase_4:
    status: "LOCKED"
    substates:
      phase_fs_5:
        status: "LOCKED"
        state_history:
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "REVIEWED", at: "{ISO}" }
          - { state: "COMPLETED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "code_review_report", path: "{output}/code-review-report.md", status: "complete" }
          - { type: "delivery_checklist", status: "all_checks_pass" }
          - { type: "retrospective", path: "{output}/retrospective.md", status: "complete" }
        delivery_ready: true

  global_state:
    overall_status: "complete"
```

## Phase Complete

```
═══════════════════════════════════════════
Full-Stack 5 — Review & Delivery Complete
═══════════════════════════════════════════

Code Review: ✓  ({N} issues, 0 critical)
Delivery Checklist: 10/10 ✓
Retrospective: ✓  (_bmad-output/.../retrospective.md)

All 4 Acceptance Gates:
  CODE ACCEPTANCE         ✓  (all stories)
  FEATURE ACCEPTANCE      ✓  (full-stack)
  UI ACCEPTANCE           ✓  (visual, a11y, perf)
  E2E BROWSER ACCEPTANCE  ✓  (browser, visual regression, cross-browser)

═══════════════════════════════════════════
PROJECT COMPLETE — {project_name}
═══════════════════════════════════════════

All phases locked. No blocking CRs open. Ready for deployment.

Run `web-dev-flow status` any time to review the full project dashboard.
```
