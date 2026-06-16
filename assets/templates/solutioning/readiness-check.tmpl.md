---
template: readiness-check-v1
artifact_type: readiness_check
description: "Pre-implementation readiness validation"
version: "1.0"
---

# Readiness Check: {PROJECT_NAME}

**Phase:** 3.9
**Date:** {DATE}
**Auditor:** {AUDITOR}

---

## Artifact Completeness

<!-- ACTION REQUIRED: All Phase 1-3 artifacts present and locked -->

| Artifact | Status | Missing/Issues |
|----------|--------|----------------|
| PRD | PRESENT | MISSING | {issues} |
| Architecture | PRESENT | MISSING | {issues} |
| Epics | PRESENT | MISSING | {issues} |
| Stories ({N}) | PRESENT | MISSING | {issues} |
| API Spec | PRESENT | MISSING | {issues} |
| DB Schema | PRESENT | MISSING | {issues} |

## Story Contract Check

<!-- ACTION REQUIRED: Each story has required contract fields -->

| Story ID | scope_write | acceptance_checks | code_standards | parallel_safe | Status |
|----------|-------------|-------------------|----------------|---------------|--------|
| {ID} | ✓ | ✓ | ✓ | ✓ | PASS |
| {ID} | ✓ | ✗ (placeholder) | ✓ | ✓ | FAIL |

## Gate Results

<!-- ACTION REQUIRED: Phase 3 gate evaluation -->

| Check | Result | Detail |
|-------|--------|--------|
| PRD approved | PASS | FAIL | {detail} |
| Architecture locked | PASS | FAIL | {detail} |
| Stories frozen | PASS | FAIL | {detail} |
| API spec approved | PASS | FAIL | {detail} |

## Verdict

**{READY | NOT_READY}** for Phase 4 implementation.

### Blockers
- {blocker_description}
