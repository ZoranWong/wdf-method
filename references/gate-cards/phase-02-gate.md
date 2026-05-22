# Phase 2 Gate Card
# Orchestrator reads ONLY this file for Phase 2 entry checks

phase: 2
enters_from: 1
version: "3.6.0"

checks:
  - id: "G2-01"
    description: "Phase 1 is LOCKED or SKIPPED"
    type: "dependency_status"
    source: "{sprint_tracking}"
    field: "phases.phase_1.status"
    operator: "in"
    expected: ["LOCKED", "SKIPPED"]

  - id: "G2-02"
    description: "User confirms readiness to begin planning"
    type: "user_confirmation"
    auto_mode:
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "global_state.task_triage_mode"
      operator: "in"
      expected: ["serial", "parallel", "light"]
      description: "Auto-run mode: verify triage mode is set (project initialized), auto-enter Phase 2"

all_pass: false

# AUTO-RUN: All user_confirmation checks are replaced by their auto_mode alternatives.
# Skip prompts for 2.2/2.3/2.8/2.9 are resolved by customize.toml auto_skip_presets.
