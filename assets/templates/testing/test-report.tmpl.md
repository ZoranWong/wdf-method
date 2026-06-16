---
template: test-report-v1
artifact_type: test_report
description: "Mandatory test report for every story — unit, functional, integration, and E2E results"
version: "1.0"
---

# Test Report: Story {STORY_ID} — {TITLE}

**Story**: stories/{STORY_ID}.md
**Track**: backend | frontend | fullstack
**Date**: {DATE}
**Test Runner**: {JEST | VITEST | PYTEST | OTHER}

---

## Test Summary

| Level | Tests | Passed | Failed | Skipped | Coverage % | Duration |
|-------|-------|--------|--------|---------|------------|----------|
| Unit | {N} | {P} | {F} | {S} | {line}% line / {branch}% branch | {T}s |
| Functional | {N} | {P} | {F} | {S} | — | {T}s |
| Integration | {N} | {P} | {F} | {S} | — | {T}s |
| Playwright E2E | {N} | {P} | {F} | {S} | — | {T}s |
| **Total** | {N} | {P} | {F} | {S} | {COV}% | {TOTAL}s |

## Unit Test Results

### Coverage by Module

| Module | Line % | Branch % | Function % | Uncovered Lines |
|--------|--------|----------|------------|-----------------|
| {module_1} | {L}% | {B}% | {F}% | {lines} |
| {module_2} | {L}% | {B}% | {F}% | {lines} |

### Failed Tests

<!-- If zero failures: "All {N} unit tests passing. Coverage: {L}% line, {B}% branch." -->

| Test | Status | Duration | Error |
|------|--------|----------|-------|
| {test_name} | FAILED | {ms}ms | {error_summary} |

## Functional Test Results

### Acceptance Criteria Coverage

| AC Reference | Test | Status |
|-------------|------|--------|
| AC-1: {description} | {test_file}:{test_name} | PASS | FAIL |
| AC-2: {description} | {test_file}:{test_name} | PASS | FAIL |
| AC-3: {description} | {test_file}:{test_name} | PASS | FAIL |

### UI State Coverage

| State | Page/Component | Test | Status |
|-------|---------------|------|--------|
| Loading | {component} | {test} | PASS | FAIL |
| Empty | {component} | {test} | PASS | FAIL |
| Error | {component} | {test} | PASS | FAIL |
| Success | {component} | {test} | PASS | FAIL |
| Edge case: {case} | {component} | {test} | PASS | FAIL |

## Integration Test Results

### API Contract Verification

| Endpoint | Method | Expected Status | Actual Status | Schema Match | Status |
|----------|--------|----------------|---------------|--------------|--------|
| /api/{resource} | GET | 200 | {code} | PASS | FAIL | PASS | FAIL |
| /api/{resource} | POST | 201 | {code} | PASS | FAIL | PASS | FAIL |
| /api/{resource}/:id | GET | 200 | {code} | PASS | FAIL | PASS | FAIL |
| /api/{resource}/:id | PUT | 200 | {code} | PASS | FAIL | PASS | FAIL |
| /api/{resource}/:id | DELETE | 204 | {code} | PASS | FAIL | PASS | FAIL |

### Error Response Verification

| Endpoint | Scenario | Expected Status | Actual | Response Body Valid | Status |
|----------|----------|----------------|--------|---------------------|--------|
| /api/{resource} | Missing required field | 400 | {code} | PASS | FAIL | PASS | FAIL |
| /api/{resource} | No auth token | 401 | {code} | PASS | FAIL | PASS | FAIL |
| /api/{resource} | Wrong permissions | 403 | {code} | PASS | FAIL | PASS | FAIL |
| /api/{resource}/999 | Not found | 404 | {code} | PASS | FAIL | PASS | FAIL |

### Database Migration Test

| Migration | Direction | Tables Affected | Data Preserved | Status |
|-----------|-----------|----------------|---------------|--------|
| {timestamp}_{name}.sql | UP | {tables} | N/A | PASS | FAIL |
| {timestamp}_{name}.sql | DOWN | {tables} | YES | NO | PASS | FAIL |

## Playwright E2E Test Results

### Browser Matrix

| Browser | Tests | Passed | Failed | Duration | Status |
|---------|-------|--------|--------|----------|--------|
| Chromium (Desktop) | {N} | {P} | {F} | {T}s | PASS | FAIL |
| Firefox (Desktop) | {N} | {P} | {F} | {T}s | PASS | FAIL |
| WebKit / Safari | {N} | {P} | {F} | {T}s | PASS | FAIL |

### Viewport Matrix

| Viewport | Width | Tests | Passed | Failed | Status |
|----------|-------|-------|--------|--------|--------|
| Mobile | 375px | {N} | {P} | {F} | PASS | FAIL |
| Tablet | 768px | {N} | {P} | {F} | PASS | FAIL |
| Desktop | 1280px | {N} | {P} | {F} | PASS | FAIL |

### Visual Regression

| Page | Baseline | Diff % | Threshold | Status |
|------|----------|--------|-----------|--------|
| {page_url} | {baseline_screenshot} | {diff}% | 0.5% | PASS | FAIL |
| {page_url} | {baseline_screenshot} | {diff}% | 0.5% | PASS | FAIL |

### Accessibility Scan (axe-core)

| Page | Critical | Serious | Moderate | Minor | Status |
|------|----------|---------|----------|-------|--------|
| {page_url} | {C} | {S} | {M} | {N} | PASS | FAIL |
| {page_url} | {C} | {S} | {M} | {N} | PASS | FAIL |

### Failed E2E Tests

| Test | Browser | Viewport | Error | Screenshot |
|------|---------|----------|-------|------------|
| {test_name} | {browser} | {viewport} | {error} | {screenshot_path} |

### E2E Test Run Log

```
{playwright_output}
```

## Acceptance Gate Decision

| Gate | Requirements | Status |
|------|-------------|--------|
| Unit Coverage | ≥{threshold}% line, ≥{threshold}% branch | PASS | FAIL |
| Functional Tests | 100% acceptance criteria covered | PASS | FAIL |
| Integration Tests | All endpoints + migrations tested | PASS | FAIL |
| Playwright E2E | All browsers + viewports pass | PASS | FAIL |
| Visual Regression | < 0.5% diff | PASS | FAIL |
| a11y Audit | 0 critical, 0 serious | PASS | FAIL |
| Type Check | Zero errors | PASS | FAIL |
| Lint | Zero errors | PASS | FAIL |

**VERDICT**: {PASSED | FAILED} — {summary}

{If FAILED: specific gaps and required fixes}
