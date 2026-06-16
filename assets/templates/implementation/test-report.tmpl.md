---
template: test-report-v1
artifact_type: test_report
description: "Test suite report — unit and integration test results"
version: "1.0"
---

# Test Report: {PROJECT_NAME}

**Phase:** {PHASE_NUMBER}
**Track:** backend | frontend
**Date:** {DATE}

---

## Summary

<!-- ACTION REQUIRED: Overall test results (min 100 chars) -->

| Suite | Tests | Passed | Failed | Skipped | Coverage | Time |
|-------|-------|--------|--------|---------|----------|------|
| Unit | {N} | {P} | {F} | {S} | {COV}% | {T}s |
| Integration | {N} | {P} | {F} | {S} | {COV}% | {T}s |
| E2E | {N} | {P} | {F} | {S} | - | {T}s |
| **Total** | {N} | {P} | {F} | {S} | {COV}% | {T}s |

## Coverage Details

<!-- ACTION REQUIRED: Coverage by module/component -->

| Module | Statements | Branches | Functions | Lines |
|--------|-----------|----------|-----------|-------|
| {module} | {S}% | {B}% | {F}% | {L}% |

## Failed Tests

<!-- Only if failures exist -->

| Test | Suite | Error |
|------|-------|-------|
| {test_name} | {suite} | {error_message} |

## Test Output

```
{full_test_output}
```
