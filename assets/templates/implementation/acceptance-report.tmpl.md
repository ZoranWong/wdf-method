---
template: acceptance-report-v1
artifact_type: acceptance_report
description: "Acceptance gate report (code, UI, feature, or E2E)"
version: "1.0"
---

# {TYPE} Acceptance Report: {PROJECT_NAME}

**Acceptance Type:** CODE | UI | FEATURE | E2E_BROWSER
**Date:** {DATE}
**Reviewer:** {REVIEWER}

---

## Acceptance Checklist

<!-- ACTION REQUIRED: Fill based on acceptance type -->

### Code Acceptance
- [ ] Code review passed with approval
- [ ] Test coverage >= {threshold}%
- [ ] Type check passed (zero errors)
- [ ] Lint passed (zero errors)
- [ ] All acceptance_check commands exit 0
- [ ] Scope audit clean

### UI Acceptance
- [ ] Visual parity against design specs
- [ ] A11y critical issues: 0
- [ ] A11y serious issues: 0
- [ ] Lighthouse Performance >= {threshold}
- [ ] Lighthouse Accessibility >= {threshold}
- [ ] Lighthouse Best Practices >= {threshold}
- [ ] Bundle size < {threshold}KB
- [ ] axe-core audit passed

### Feature Acceptance
- [ ] All stories CODE_ACCEPTED
- [ ] Contract compliance verified
- [ ] E2E critical paths pass
- [ ] Security audit pass

### E2E Browser Acceptance
- [ ] Browser tests pass (Chrome, Firefox, Safari)
- [ ] Responsive (Mobile, Tablet, Desktop)
- [ ] Network (Slow 3G, Offline)
- [ ] Visual regression < {threshold}%

## Results

<!-- ACTION REQUIRED: Actual metrics from the run -->

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| {metric_name} | {target} | {actual} | PASS | FAIL |

## Verdict

**{PASSED | FAILED}** — {summary_sentence}
