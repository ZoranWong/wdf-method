# Phase 4 Gate Card
# Orchestrator reads ONLY this file for Phase 4 entry checks

phase: 4
enters_from: 3
version: "3.6.0"

checks:
  - id: "G4-01"
    description: "Phase 3 (Solutioning) is LOCKED"
    type: "dependency_status"
    source: "{sprint_tracking}"
    field: "phases.phase_3.status"
    operator: "eq"
    expected: "LOCKED"

  - id: "G4-02"
    description: "PRD is approved and requirements are frozen"
    type: "artifact_metadata"
    source: "{prd_output}"
    field: "frontmatter.status"
    operator: "in"
    expected: ["approved", "locked"]

  - id: "G4-03"
    description: "API spec is approved or locked"
    type: "artifact_metadata"
    source: "{api_spec_output}"
    field: "frontmatter.status"
    operator: "in"
    expected: ["approved", "locked"]

  - id: "G4-04"
    description: "DB schema is approved or locked"
    type: "artifact_metadata"
    source: "{db_schema_output}"
    field: "frontmatter.status"
    operator: "in"
    expected: ["approved", "locked"]

  - id: "G4-05"
    description: "Development order is frozen"
    type: "dependency_status"
    source: "{sprint_tracking}"
    field: "global_state.development_order_frozen_at"
    operator: "neq"
    expected: null

  - id: "G4-06"
    description: "Architecture is locked"
    type: "artifact_metadata"
    source: "{architecture_output}"
    field: "frontmatter.status"
    operator: "eq"
    expected: "locked"

  - id: "G4-07"
    description: "Readiness check all gates passed"
    type: "artifact_metadata"
    source: "{readiness_check_output}"
    field: "frontmatter.all_gates_passed"
    operator: "eq"
    expected: true

  - id: "G4-08"
    description: "User confirms readiness to begin implementation"
    type: "user_confirmation"
    auto_mode:
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_3.status"
      operator: "eq"
      expected: "LOCKED"
      description: "Auto-run: verify Phase 3 is LOCKED, auto-enter Phase 4"

all_pass: false

# AUTO-RUN: All user_confirmation checks replaced by auto_mode alternatives.

# Sub-Phase Gate Conditions:
# 4.1: Phase 3 LOCKED + requirements frozen + development order frozen
# 4.2: 4.1 LOCKED
# 4.3: 4.2 LOCKED (merged DB + API Client)
# 4.4: 4.3 LOCKED + api-spec approved (AUTO-CONTINUE, per-story dispatch)
# 4.5: All 4.4 stories CODE_ACCEPTED
# 4.6: 4.5 LOCKED (CODE_ACCEPTANCE)
# 4.7: 4.1 LOCKED (parallel with BE track)
# 4.8: 4.7 LOCKED
# 4.9: 4.8 LOCKED
# 4.10: 4.8 LOCKED + 4.9 LOCKED (AUTO-CONTINUE, per-story dispatch)
# 4.11: All 4.10 stories CODE_ACCEPTED
# 4.12: 4.11 LOCKED (UI_ACCEPTANCE)
# 4.13: 4.6 CODE_ACCEPTED + 4.12 UI_ACCEPTED (FEATURE + E2E acceptance)
# 4.14: 4.13 LOCKED
