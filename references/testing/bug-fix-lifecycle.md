# WDF Method — Bug & Fix Lifecycle

**Version:** 3.8.0
**Status:** MANDATORY — spiral iteration required for all test/QA failures

---

## Spiral Iteration Model

```
                    ┌─────────────┐
                    │  Implement  │
                    └──────┬──────┘
                           ↓
              ┌────────────────────────┐
              │   Test (4-Layer)        │
              └────────────┬───────────┘
                           ↓
                    ┌──────────┐
              ┌─────│  PASS?   │─────┐
              │     └──────────┘     │
              ↓ NO              YES  ↓
    ┌─────────────────┐     ┌──────────────┐
    │ Generate BUG     │     │ QA Review     │
    │ Report           │     └──────┬───────┘
    └────────┬────────┘            ↓
             ↓               ┌──────────┐
    ┌─────────────────┐ ┌───│  PASS?   │───┐
    │ Assign +         │ │   └──────────┘   │
    │ Prioritize       │ │            YES   │ NO
    └────────┬────────┘ │              ↓     ↓
             ↓           │    ┌─────────────┐ │
    ┌─────────────────┐ │    │ ACCEPTED    │ │
    │ Generate FIX     │ │    └─────────────┘ │
    │ Document         │ │                    │
    └────────┬────────┘ │                    │
             ↓           │                    │
    ┌─────────────────┐ │    ┌──────────────────────┐
    │ Implement FIX    │ │    │ Generate BUG Report   │
    └────────┬────────┘ │    │ (QA Findings)          │
             ↓           │    └──────────┬───────────┘
    ┌─────────────────┐ │               ↓
    │ Verify FIX       │ │    ┌──────────────────────┐
    └────────┬────────┘ │    │ Generate FIX Document  │
             ↓           │    └──────────┬───────────┘
    ┌─────────────────┐ │               ↓
    │ Update BUG       │ │    ┌──────────────────────┐
    │ Report Status    │ │    │ Implement FIX         │
    └────────┬────────┘ │    └──────────┬───────────┘
             ↓           │               ↓
         BACK TO TEST ←──┘         BACK TO QA REVIEW
             ↑                           ↑
             └──────── SPIRAL ───────────┘
```

Each cycle is ONE spiral iteration. A story may require 1-N iterations to converge.

---

## Bug Report Template

Every test/QA failure MUST generate a bug report at `{output_dir}/bugs/{story_id}/{bug_id}.md`.

```markdown
---
bug_id: BUG-{STORY_ID}-{NNN}
story_id: {STORY_ID}
status: open | in_progress | fixed | verified | closed | wont_fix
severity: critical | high | medium | low
found_in: unit | functional | integration | e2e | code_review | design_review | qa_review
found_at: {ISO_TIMESTAMP}
found_by: {TEST_RUNNER | QA_AGENT | REVIEWER}
assigned_to: {DEVELOPER_AGENT}
iteration: {N}
---

# BUG-{STORY_ID}-{NNN}: {TITLE}

## Discovery

**Source:** {test_file}:{line} | {qa_review_section}:{criterion}
**Spiral Iteration:** {N} (attempt {N} of acceptance)

### Failure Description

{What failed — actual vs expected}

### Reproduction

```
{Steps to reproduce the failure}
```

### Evidence

**Test Output:**
```
{failing_test_output}
```

**Screenshot (if UI):**
{screenshot_path}

**Code Location:**
- File: `{filepath}:{line_range}`
- Function: `{function_name}`
- Suspected root cause: {brief_analysis}

### Environment

```
{node_version, browser, OS, etc.}
```

## Root Cause Analysis

{After investigation — filled by fixer}

### Why did this happen?

1. **Why 1:** {direct cause}
2. **Why 2:** {underlying cause}
3. **Why 3:** {systemic cause}

### Root Cause Classification

- [ ] Logic error — wrong implementation of correct design
- [ ] Design gap — design didn't anticipate this case
- [ ] Missing validation — input not validated before use
- [ ] Race condition — timing-dependent behavior
- [ ] Integration mismatch — component A and B have different contracts
- [ ] Configuration error — wrong config value or missing config
- [ ] Test error — test was wrong, not the code
- [ ] Visual/style issue — CSS/component rendering problem
- [ ] Accessibility issue — WCAG violation
- [ ] Performance issue — exceeds time/budget thresholds
- [ ] Security vulnerability — exploitable weakness

## Severity Assessment

| Criteria | Assessment |
|----------|-----------|
| User impact | {none | cosmetic | functional_block | data_loss | security} |
| Data integrity risk | {none | potential | confirmed} |
| Affected scope | {single_component | module | cross_module | system_wide} |
| Workaround exists | {yes_and_easy | yes_but_painful | no} |
| Regression risk | {none | low — new code | high — existing feature} |

**FINAL SEVERITY:** {critical | high | medium | low}

## Fix Documentation

{Generated as separate fix document — see `bugs/{story_id}/FIX-{bug_id}.md`}
```

---

## Fix Document Template

Every bug MUST have a corresponding fix document at `{output_dir}/bugs/{story_id}/FIX-{bug_id}.md`.

```markdown
---
fix_id: FIX-{BUG_ID}
bug_id: {BUG_ID}
story_id: {STORY_ID}
status: proposed | approved | implemented | verified | applied
iteration: {N}
created_at: {ISO_TIMESTAMP}
implemented_by: {DEVELOPER_AGENT}
verified_by: {QA_AGENT | TEST_RUNNER}
---

# FIX-{BUG_ID}: Fix for {BUG_TITLE}

## Bug Reference

**Bug:** BUG-{STORY_ID}-{NNN} — {BUG_TITLE}
**Root Cause:** {from bug report analysis}
**Severity:** {critical | high | medium | low}

## Fix Strategy

### Approach

{Which approach and why — reference first principles}

**Alternatives Considered:**
| Approach | Pros | Cons | Why Rejected |
|----------|------|------|-------------|
| {approach_1} | {pros} | {cons} | {reason} |
| {approach_2} | {pros} | {cons} | {reason} |
| **Chosen: approach_N** | {pros} | {cons} | {justification} |

### Scope of Change

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `{filepath}` | CREATE | MODIFY | DELETE | {N} | {what_changes} |

### Code Changes

```diff
{git diff of changes}
```

### Impact Analysis

- [ ] Affects API contract? → {yes/no, details}
- [ ] Affects database schema? → {yes/no, migration needed?}
- [ ] Affects other stories? → {yes/no, which?}
- [ ] Requires documentation update? → {yes/no}
- [ ] Requires new tests? → {yes/no, count}

## Verification

### Tests Added/Modified

| Test | Type | Purpose |
|------|------|---------|
| {test_name} | unit | functional | integration | e2e | {what_it_verifies} |

### Verification Results

```
{test_output_after_fix}
```

| Check | Before Fix | After Fix |
|-------|-----------|-----------|
| Failing test | FAIL | PASS |
| Related tests | {N} passing | {M} passing |
| Coverage change | {before}% | {after}% |

### Regression Check

```
{regression_test_output — all previously passing tests still pass}
```

## Fix Status

| Stage | Status | Timestamp |
|-------|--------|-----------|
| Proposed | complete | {ISO} |
| Reviewed | {pending | approved} | {ISO} |
| Implemented | {pending | complete} | {ISO} |
| Verified | {pending | complete} | {ISO} |
| Applied | {pending | complete} | {ISO} |

## Spiral Iteration

**Iteration {N} of fix for BUG-{ID}.**

Previous fix attempts: {list of prior FIX IDs if this is a re-fix}
Next step: {return to test → if pass → QA review → if pass → accept | if fail → new bug + new fix}
```

---

## Bug Registry

All bugs tracked in `{output_dir}/bugs/{story_id}/registry.json`:

```json
{
  "story_id": "{STORY_ID}",
  "total_bugs": 5,
  "open": 0,
  "in_progress": 0,
  "fixed": 1,
  "verified": 3,
  "closed": 1,
  "wont_fix": 0,
  "spiral_iterations": 3,
  "bugs": [
    {
      "bug_id": "BUG-{STORY_ID}-001",
      "title": "{TITLE}",
      "severity": "high",
      "status": "closed",
      "fix_id": "FIX-BUG-{STORY_ID}-001",
      "found_in": "integration",
      "iterations": 1,
      "created_at": "{ISO}",
      "closed_at": "{ISO}"
    }
  ],
  "spiral_history": [
    {
      "iteration": 1,
      "bugs_found": 3,
      "bugs_fixed": 3,
      "tests_rerun": true,
      "qa_rerun": true,
      "result": "3 more bugs found — entering iteration 2"
    },
    {
      "iteration": 2,
      "bugs_found": 2,
      "bugs_fixed": 2,
      "tests_rerun": true,
      "qa_rerun": true,
      "result": "1 more bug found — entering iteration 3"
    },
    {
      "iteration": 3,
      "bugs_found": 0,
      "bugs_fixed": 0,
      "tests_rerun": true,
      "qa_rerun": true,
      "result": "ALL PASS — acceptance achieved"
    }
  ]
}
```

---

## Spiral Iteration Rules

### Rule 1: Zero Tolerance on Regression

When a fix is applied, ALL previously passing tests MUST still pass. Any regression → new bug report + fix required. No "quick fix that breaks something else" allowed.

### Rule 2: Fix Must Be Verified by Independent Agent

The agent that implemented the fix CANNOT verify it. Verification must be by:
- Test runner (for test failures)
- QA agent (for code/design review findings)

### Rule 3: Each Fix Must Have a Test

Every bug fix MUST include at least one new test that:
1. Reproduces the exact bug condition
2. Fails before the fix
3. Passes after the fix
4. This test prevents regression

### Rule 4: Root Cause Over Symptom Fix

A fix that addresses only the symptom without the root cause = REJECTED. The fix document must include the 3-Why analysis and address the systemic cause. If the same bug reappears in a different form because the root cause was not fixed → new bug with severity raised one level.

### Rule 5: Spiral Convergence Required

A story CANNOT be accepted until:
- All test suites pass (zero failures)
- QA code review: 0 critical, 0 high
- QA design review: 0 blocking
- Bug registry: all bugs in `closed` or `wont_fix` state
- Spiral iteration counter ≤ 5 (if >5 → escalate to blocking CR — something is fundamentally wrong)

### Rule 6: Bug Severity Escalation

If the same component/function generates bugs across 2+ spiral iterations:
- Original severity `low` → escalate to `medium`
- Original severity `medium` → escalate to `high`
- Original severity `high` → escalate to `critical` → triggers architecture review

This prevents the "death by a thousand paper cuts" where many low-severity bugs mask a systemic quality problem.

---

## Integration with Acceptance Flow

### After Test Run (any failure)

```
Test Run → {N} failures found
  ↓
Generate BUG report for each failure (assign bug ID, severity)
  ↓
Bug status: open → assigned to developer
  ↓
Developer: generate FIX document → implement → verify locally
  ↓
Bug status: fixed
  ↓
Re-run tests (ALL tests, not just failing ones — regression check)
  ↓
If all pass → Bug status: verified → enter QA review
If any fail → new bug(s) + return to fix phase (spiral continues)
```

### After QA Review (any finding)

```
QA Review → {N} findings
  ↓
Classify severity: critical/high → BLOCK | medium → FIX | low → NOTE
  ↓
Generate BUG report for each blocking finding
  ↓
Same fix → verify → re-review cycle
  ↓
When 0 blocking findings → QA passed → ACCEPTANCE
```

---

## Bug Directory Structure

```
{output_dir}/bugs/
├── {story_id}/
│   ├── registry.json              # Bug registry for this story
│   ├── BUG-{story_id}-001.md      # Bug 1
│   ├── FIX-BUG-{story_id}-001.md  # Fix for bug 1
│   ├── BUG-{story_id}-002.md      # Bug 2
│   └── FIX-BUG-{story_id}-002.md  # Fix for bug 2
└── summary.json                   # Cross-story bug metrics
```

### Project-Level Bug Summary

`{output_dir}/bugs/summary.json`:

```json
{
  "project": "{PROJECT_NAME}",
  "total_bugs": 42,
  "by_severity": { "critical": 0, "high": 5, "medium": 25, "low": 12 },
  "by_type": { "unit": 15, "functional": 10, "integration": 8, "e2e": 4, "code_review": 3, "design_review": 2 },
  "by_story": { "{STORY_ID}": 8, "{STORY_ID}": 5 },
  "avg_spiral_iterations": 2.1,
  "bug_closure_rate": "95%",
  "mean_time_to_fix_hours": 4.2,
  "generated_at": "{ISO}"
}
```
