# Phase 3 Gate Card
# Orchestrator reads ONLY this file for Phase 3 entry checks

phase: 3
enters_from: 2
version: "3.6.0"

checks:
  - id: "G3-01"
    description: "Phase 2 (Planning) is LOCKED"
    type: "dependency_status"
    source: "{sprint_tracking}"
    field: "phases.phase_2.status"
    operator: "eq"
    expected: "LOCKED"

  - id: "G3-02"
    description: "PRD exists and is approved"
    type: "artifact_metadata"
    source: "{prd_output}"
    field: "frontmatter.status"
    operator: "in"
    expected: ["approved", "locked"]

  - id: "G3-03"
    description: "Requirements are frozen (requirements_frozen_at timestamp is set)"
    type: "dependency_status"
    source: "{sprint_tracking}"
    field: "global_state.requirements_frozen_at"
    operator: "not_null"

  - id: "G3-04"
    description: "Wireframes and design acceptance are locked"
    type: "dependency_status"
    source: "{sprint_tracking}"
    field: "phases.phase_2.substates.phase_2_10.status"
    operator: "eq"
    expected: "LOCKED"

  - id: "G3-05"
    description: "User confirms readiness for technical solutioning"
    type: "user_confirmation"
    auto_mode:
      type: "artifact_metadata"
      source: "{prd_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]
      description: "Auto-run: verify PRD is approved/locked, auto-enter Phase 3"

  - id: "G3-06"
    description: "Code standards source is declared"
    type: "dependency_status"
    source: "{sprint_tracking}"
    field: "global_state.code_standards_source"
    operator: "not_empty"
    severity: "blocking"

all_pass: false

# AUTO-RUN: All user_confirmation checks replaced by auto_mode alternatives.
# Sub-Phase Gate Conditions:
# 3.2 requires 3.1 LOCKED
# 3.3 requires 3.2 LOCKED
# 3.4 (skip) requires 3.3 LOCKED
# 3.5 requires 3.3 LOCKED (can start regardless of 3.4)
# 3.6 requires 3.5 LOCKED
# 3.7 requires 3.6 LOCKED ★ DEV ORDER FREEZE
# 3.8 requires 3.7 LOCKED
# 3.9 requires 3.8 LOCKED
# Development Order Freeze at 3.7
