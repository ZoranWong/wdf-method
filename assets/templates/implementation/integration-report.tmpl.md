---
template: integration-report-v1
artifact_type: integration_report
description: "Integration verification report"
version: "1.0"
---

# Integration Report: {PROJECT_NAME}

**Phase:** 4.13
**Date:** {DATE}
**Reviewer:** {REVIEWER}

---

## Merge Queue Summary

<!-- ACTION REQUIRED: All stories merged, their order, and any conflicts (min 100 chars) -->

| Order | Story ID | Track | Merge Status | Commit |
|-------|----------|-------|-------------|--------|
| 10 | {ID} | {track} | MERGED | {hash} |
| 20 | {ID} | {track} | MERGED | {hash} |

## Contract Verification

<!-- ACTION REQUIRED: API contract compliance check -->

| Endpoint | Spec Match | Field Compliance | Notes |
|----------|-----------|-----------------|-------|
| GET /api/{resource} | PASS | FAIL | PASS | FAIL | {notes} |

**Result:** PASSED | FAILED

## Integration Test Results

<!-- ACTION REQUIRED: E2E test suite output -->

```
{integration_test_output}
```

| Suite | Tests | Passed | Failed |
|-------|-------|--------|--------|
| Integration | {N} | {P} | {F} |

## Security Audit

<!-- ACTION REQUIRED: OWASP top 10 or dependency audit -->

| Check | Result | Notes |
|-------|--------|-------|
| Dependency Audit | PASS | FAIL | {notes} |
| OWASP Top 10 Review | PASS | FAIL | {notes} |

## Feature Acceptance

**Status:** PASSED | FAILED

- [ ] All stories CODE_ACCEPTED
- [ ] Contract compliance verified
- [ ] E2E critical paths pass
- [ ] Security audit complete

## E2E Browser Acceptance

<!-- ACTION REQUIRED: Cross-browser and responsive test results -->

| Browser | Status | Issues |
|---------|--------|--------|
| Chrome | PASS | FAIL | {issues} |
| Firefox | PASS | FAIL | {issues} |
| Safari | PASS | FAIL | {issues} |

| Viewport | Status |
|----------|--------|
| Mobile (375px) | PASS | FAIL |
| Tablet (768px) | PASS | FAIL |
| Desktop (1280px) | PASS | FAIL |

**Status:** PASSED | FAILED
