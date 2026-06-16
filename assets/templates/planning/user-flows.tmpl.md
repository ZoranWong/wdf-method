---
template: user-flows-v1
artifact_type: user_flows
description: "User flows — primary, secondary, and error paths"
version: "1.0"
---

# User Flows: {PROJECT_NAME}

**Phase:** 2.6
**Created:** {DATE}

---

## Flow Inventory

<!-- ACTION REQUIRED: List all user flows with entry/exit conditions -->

| # | Flow Name | User Type | Starts When | Ends When | Priority |
|---|-----------|-----------|-------------|-----------|----------|
| 1 | {name} | {persona} | {trigger} | {outcome} | P1 |
| 2 | {name} | {persona} | {trigger} | {outcome} | P2 |

## Primary Flows

<!-- ACTION REQUIRED: Happy-path flows with step-by-step detail -->

### Flow 1: {FLOW_NAME}

**Steps:**

1. User {action} → System {response}
2. User {action} → System {response}
3. User {action} → System {response}

**Wireframe Reference:** {link_to_wireframe}

## Error Paths

<!-- For each primary flow, define error handling -->

| Flow | Error Condition | System Response |
|------|----------------|-----------------|
| {flow} | {error} | {response} |
