---
template: story-map-v1
artifact_type: story_map
description: "Story map — user activities → tasks → stories → releases"
version: "1.0"
---

# Story Map: {PROJECT_NAME}

**Phase:** 2.4
**Created:** {DATE}

---

## User Activity Backbone

<!-- ACTION REQUIRED: Top-level user activities (the backbone) -->

1. {Activity 1}
2. {Activity 2}
3. {Activity 3}

## Task Decomposition

<!-- ACTION REQUIRED: Break each activity into user tasks -->

### Activity: {ACTIVITY_NAME}

| Task | Description | Story Seeds |
|------|-------------|-------------|
| {task_name} | {description} | {potential_stories} |

## Story Inventory

<!-- ACTION REQUIRED: All identified stories with mapping to activities -->

| # | Story Seed | Activity | Priority |
|---|------------|----------|----------|
| 1 | {seed} | {activity} | P1 |
| 2 | {seed} | {activity} | P2 |

## Release Slices

<!-- ACTION REQUIRED: How stories are grouped into releases -->

| Release | Stories | Scope | Success Criteria |
|---------|---------|-------|-----------------|
| Walking Skeleton | {story_list} | {minimal_viable_scope} | {criteria} |
| MVP | {story_list} | {mvp_scope} | {criteria} |
| v1.1 | {story_list} | {incremental_scope} | {criteria} |
