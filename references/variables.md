# Variable Resolution Specification

**Version:** 3.6.0
**Purpose:** Define all template variables used across web-dev-flow, their resolution rules, and the resolver chain. Includes V3.6 split-file status variables with write semantics.

## Variable Syntax

Template variables use `{variable_name}` syntax. The resolver replaces them at runtime.

## Resolution Chain

```
Template String → Customize Config → Default Path → Absolute Path
```

1. Check `{project-root}` → replaced with the project working directory
2. Check `{skill-root}` → replaced with the skill installation directory  
3. Check if the variable is a config key in `customize.toml` → use config value
4. Check if variable is in the Standard Variable table below
5. If unresolved → throw error: "Unresolved variable: {name}"

## Standard Variables

| Variable | Resolution | Example Value |
|----------|-----------|---------------|
| `{project-root}` | Project working directory | `/workspace/my-app` |
| `{skill-root}` | web-dev-flow installation directory | `/Users/wang/.claude/skills/web-dev-flow` |
| `{sprint_tracking}` | customize.toml → `sprint_tracking` | READ-ONLY derived index. For WRITES, use `{status_phase_0N_file}` or `{status_global_file}`. |
| `{status_dir}` | customize.toml → `status_dir` | `{project-root}/_bmad-output/web-dev-flow/status` |
| `{status_global_file}` | customize.toml → `status_global_file` | WRITE target for global_state changes |
| `{status_phase_01_file}` | customize.toml → `status_phase_01_file` | WRITE target for Phase 1 state |
| `{status_phase_02_file}` | customize.toml → `status_phase_02_file` | WRITE target for Phase 2 state |
| `{status_phase_03_file}` | customize.toml → `status_phase_03_file` | WRITE target for Phase 3 state |
| `{status_phase_04_be_file}` | customize.toml → `status_phase_04_be_file` | WRITE target for Phase 4 BE track |
| `{status_phase_04_fe_file}` | customize.toml → `status_phase_04_fe_file` | WRITE target for Phase 4 FE track |
| `{status_change_requests_file}` | customize.toml → `status_change_requests_file` | WRITE target for CR list |
| `{status_stories_dir}` | customize.toml → `status_stories_dir` | Per-story status file directory |
| `{status_merge_queue_dir}` | customize.toml → `status_merge_queue_dir` | Merge queue items directory |
| `{prd_output}` | customize.toml → `prd_output` | `{project-root}/_bmad-output/web-dev-flow/prd.md` |
| `{architecture_output}` | customize.toml → `architecture_output` | `{project-root}/_bmad-output/web-dev-flow/architecture.md` |
| `{api_spec_output}` | customize.toml → `api_spec_output` | `{project-root}/_bmad-output/web-dev-flow/api-spec.yaml` |
| `{db_schema_output}` | customize.toml → `db_schema_output` | `{project-root}/_bmad-output/web-dev-flow/db-schema.md` |
| `{epics_output}` | customize.toml → `epics_output` | `{project-root}/_bmad-output/web-dev-flow/epics.md` |
| `{stories_output}` | customize.toml → `stories_output` | `{project-root}/_bmad-output/web-dev-flow/stories` |
| `{integration_output}` | customize.toml → `integration_output` | `{project-root}/_bmad-output/web-dev-flow/integration-report.md` |
| `{research_output}` | customize.toml → `research_output` | `{project-root}/_bmad-output/web-dev-flow/research` |
| `{impact_map_output}` | customize.toml → `impact_map_output` | `{project-root}/_bmad-output/web-dev-flow/_output/planning/impact-map.md` |
| `{event_storming_output}` | customize.toml → `event_storming_output` | `{project-root}/_bmad-output/web-dev-flow/_output/planning/event-storm.md` |
| `{jtbd_cards_output}` | customize.toml → `jtbd_cards_output` | `{project-root}/_bmad-output/web-dev-flow/_output/planning/jtbd-cards.md` |
| `{story_map_output}` | customize.toml → `story_map_output` | `{project-root}/_bmad-output/web-dev-flow/_output/planning/story-map.md` |
| `{prioritization_output}` | customize.toml → `prioritization_output` | `{project-root}/_bmad-output/web-dev-flow/_output/planning/prioritization.md` |
| `{wireframes_output}` | customize.toml → `wireframes_output` | `{project-root}/_bmad-output/web-dev-flow/_output/planning/wireframes.md` |
| `{design_tokens_output}` | customize.toml → `design_tokens_output` | `{project-root}/_bmad-output/web-dev-flow/_output/planning/design-tokens.md` |
| `{design_acceptance_output}` | customize.toml → `design_acceptance_output` | `{project-root}/_bmad-output/web-dev-flow/_output/planning/design-acceptance.md` |
| `{step_audit_log_output}` | customize.toml → `step_audit_log_output` | `{project-root}/_bmad-output/web-dev-flow/step-audit-log.yaml` |
| `{scope_audit_log_output}` | customize.toml → `scope_audit_log_output` | `{project-root}/_bmad-output/web-dev-flow/scope-audit-log.yaml` |

## Runtime Variables (Not from config)

| Variable | Resolution |
|----------|-----------|
| `{story_id}` | Current story ID from development_order (e.g., "S-3.2") |
| `{story_title}` | Current story title from development_order |
| `{story_slug}` | Slugified story ID (e.g., "s-3-2") |
| `{track}` | Current track: "backend" | "frontend" | "full-stack" |
| `{ISO_TIMESTAMP}` | Current time in ISO 8601 format |
| `{current_branch}` | Current git branch name |
| `{scope_write}` | Story's scope_write array (space-joined for shell, array for YAML) |
| `{total_changed}` | Number of files changed (runtime) |
| `{N}` (tests) | Number of passing tests (runtime) |
| `{percent}` (coverage) | Test coverage percentage (runtime) |
| `{endpoint list}` | List of implemented API endpoints (runtime) |

## V3.6 Split-File Write Semantics

**Rule:** `{sprint_tracking}` (sprint-status.yaml) is DERIVED and READ-ONLY. Never write to it directly.

**Write targets by context:**

| Context | Write Variable | Writer |
|---------|---------------|--------|
| Global state change (triage, freeze) | `{status_global_file}` | Main Orchestrator |
| Phase 1 state + substates | `{status_phase_01_file}` | Main Orchestrator |
| Phase 2 state + substates | `{status_phase_02_file}` | Main Orchestrator |
| Phase 3 state + substates | `{status_phase_03_file}` | Main Orchestrator |
| Phase 4 BE track + story statuses | `{status_phase_04_be_file}` | BE Orchestrator |
| Phase 4 FE track + story statuses | `{status_phase_04_fe_file}` | FE Orchestrator |
| CR create/resolve | `{status_change_requests_file}` | Main Orchestrator |
| Per-story detailed status | `{status_stories_dir}/{story_id}-status.yaml` | Story Agent (in worktree) |
| Merge queue items | `{status_merge_queue_dir}/items/{order}-{story}-{track}.yaml` | Main Orchestrator |

**Sub-workflow files:** When a sub-workflow references `{sprint_tracking}` in a READ context (e.g., "检查 `{sprint_tracking}` 中的状态"), this resolves to the derived sprint-status.yaml — a valid convenience read. When a sub-workflow references `{sprint_tracking}` in a WRITE context (e.g., "更新 `{sprint_tracking}`"), the orchestrator MUST redirect the write to the appropriate `{status_phase_0N_file}` based on the current phase.

## Per-Story Status File Path

All story agents write status to:
```
{status_stories_dir}/{story_id}-status.yaml
```

The Main Orchestrator reads this file after agent completion and updates the appropriate `{status_phase_04_be_file}` or `{status_phase_04_fe_file}`.

## Merge Queue item ID format

```
QUEUE-{story_id_slug}-{track}
```

Example: `QUEUE-s-3-2-backend`
