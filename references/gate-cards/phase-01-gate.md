# Phase 1 Gate Card
# Orchestrator reads ONLY this file for Phase 1 entry checks
# Do NOT load phase reference file content

phase: 1
enters_from: null
version: "3.6.0"

checks:
  - id: "G1-01"
    description: "User confirms readiness to begin analysis (or explicitly skip)"
    type: "user_confirmation"
    auto_mode:
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "global_state.task_triage_mode"
      operator: "in"
      expected: ["serial", "parallel"]
      description: "Auto-run mode: auto-enter Phase 1 when triage mode is serial or parallel"

all_pass: false

# Phase 1 is always available but always optional.
# AUTO-RUN: user_confirmation is replaced by auto_mode check above.
