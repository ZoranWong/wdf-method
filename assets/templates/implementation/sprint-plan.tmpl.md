---
template: sprint-plan-v1
artifact_type: sprint_plan
description: "Sprint plan with capacity, assignment, and parallel groups"
version: "1.0"
---

# Sprint Plan: {SPRINT_NAME}

**Sprint:** {SPRINT_NUMBER}
**Duration:** {START_DATE} → {END_DATE}
**Scope Freeze Tag:** `scope-freeze/{TAG_NAME}`

---

## Capacity

<!-- ACTION REQUIRED: Available developer capacity per track -->

| Track | Developers | Hours/Day | Sprint Days | Total Hours |
|-------|-----------|-----------|-------------|-------------|
| Backend | {N} | {H} | {D} | {TOTAL} |
| Frontend | {N} | {H} | {D} | {TOTAL} |

## Story Assignment

<!-- ACTION REQUIRED: Every story assigned to a track with order and dependencies -->

| # | Story ID | Title | Track | Est. Hours | Depends On | Parallel Safe |
|---|----------|-------|-------|------------|------------|---------------|
| 1 | {ID} | {title} | {track} | {H} | - | yes |
| 2 | {ID} | {title} | {track} | {H} | {ID} | yes |
| 3 | {ID} | {title} | {track} | {H} | - | no (protected path) |

## Parallel Groups

<!-- ACTION REQUIRED: Groups of stories that can execute concurrently -->

### Group A (Parallel Safe — Max {N} concurrent)
- {STORY_ID} — {track} — scope: `{path_pattern}`
- {STORY_ID} — {track} — scope: `{path_pattern}`

### Group B (Serial Only — 1 at a time)
- {STORY_ID} — {track} — scope: `{path_pattern}` (overlaps protected path)

## Risk Assessment

<!-- ACTION REQUIRED: Known risks and mitigations -->

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| {risk_description} | Low | Medium | High | {mitigation} |

## Timeline

<!-- ACTION REQUIRED: Sprint calendar with milestones -->

| Milestone | Date | Deliverable |
|-----------|------|-------------|
| Sprint Start | {date} | Sprint plan locked |
| BE Track Complete | {date} | All BE stories CODE_ACCEPTED |
| FE Track Complete | {date} | All FE stories CODE_ACCEPTED |
| Integration Complete | {date} | E2E acceptance passed |
| Retrospective | {date} | Lessons learned documented |
