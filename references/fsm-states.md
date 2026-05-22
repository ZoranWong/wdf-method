# FSM State Definitions — Single Source of Truth (V3.6)

**Version:** 3.6.0
**Principle:** All FSM states are defined here. SKILL.md and customize.toml reference this file.
Never duplicate FSM states in multiple files.

---

## Global Status States

```yaml
global_status_enum:
  - "not_started"
  - "analysis"              # Phase 1 in progress
  - "planning"              # Phase 2 in progress
  - "planning_complete"     # Phase 2 all locked
  - "requirements_frozen"   # Requirements frozen at 2.5
  - "solutioning"           # Phase 3 in progress
  - "solutioning_complete"  # Phase 3 all locked
  - "development_order_frozen" # Dev sequence locked at 3.7
  - "implementation"        # Phase 4 in progress
  - "blocked"               # Blocking CR open
  - "ready_for_integration" # BE CODE_ACCEPTED + FE UI_ACCEPTED
  - "acceptance"            # Integration + acceptance gates
  - "complete"              # All phases done, E2E accepted
  - "paused"                # Workflow paused (V3.6)
```

## Phase-Level FSM States

### Phase 1 (Analysis)

```yaml
phase_1_states:
  - "NOT_STARTED"
  - "IN_PROGRESS"
  - "ALL_SUB_PHASES_APPROVED"
  - "ANALYSIS_COMPLETE"
  - "APPROVED"
  - "LOCKED"
  - "SKIPPED"
  - "UNLOCK_RESOLVE"
```

### Phase 2 (Planning)

```yaml
phase_2_states:
  - "NOT_STARTED"
  - "IN_PROGRESS"
  - "ALL_SUB_PHASES_APPROVED"
  - "PLANNING_COMPLETE"
  - "APPROVED"
  - "LOCKED"
  - "SKIPPED"
  - "UNLOCK_RESOLVE"
```

### Phase 3 (Solutioning)

```yaml
phase_3_states:
  - "NOT_STARTED"
  - "IN_PROGRESS"
  - "ALL_SUB_PHASES_APPROVED"
  - "SOLUTIONING_COMPLETE"
  - "APPROVED"
  - "LOCKED"
  - "SKIPPED"
  - "UNLOCK_RESOLVE"
```

### Phase 4 (Implementation)

```yaml
phase_4_states:
  - "NOT_STARTED"
  - "IN_PROGRESS"
  - "BE_TRACK_COMPLETE"
  - "FE_TRACK_COMPLETE"
  - "MERGE_QUEUED"
  - "FULL_STACK_INTEGRATED"
  - "APPROVED"
  - "LOCKED"
  - "CODE_ACCEPTANCE"
  - "CODE_ACCEPTED"
  - "FEATURE_ACCEPTANCE"
  - "FEATURE_ACCEPTED"
  - "UI_ACCEPTANCE"
  - "UI_ACCEPTED"
  - "E2E_BROWSER_ACCEPTANCE"
  - "E2E_BROWSER_ACCEPTED"
```

## Acceptance Tier States

```yaml
acceptance_tier_states:
  CODE_ACCEPTANCE:      "CODE_ACCEPTED"
  FEATURE_ACCEPTANCE:   "FEATURE_ACCEPTED"
  UI_ACCEPTANCE:        "UI_ACCEPTED"
  E2E_BROWSER_ACCEPTANCE: "E2E_BROWSER_ACCEPTED"
```

## Sub-Phase FSM States

### Phase 1 Sub-Phases

| Sub-Phase | States |
|-----------|--------|
| 1.1 Brainstorming | NOT_STARTED, IN_PROGRESS, IDEAS_EXPLORED, SYNTHESIZED, VERIFIED, LOCKED, SKIPPED |
| 1.2 Domain Research | NOT_STARTED, IN_PROGRESS, SOURCES_ANALYZED, DOCUMENTED, VERIFIED, LOCKED, SKIPPED |
| 1.3 Product Brief | NOT_STARTED, IN_PROGRESS, VISION_DEFINED, USERS_IDENTIFIED, PROBLEMS_DEFINED, VERIFIED, LOCKED, SKIPPED |

### Phase 2 Sub-Phases

| Sub-Phase | States |
|-----------|--------|
| 2.1 Impact Mapping | NOT_STARTED, IN_PROGRESS, MAP_DRAFTED, VERIFIED, LOCKED |
| 2.2 Event Storming | NOT_STARTED, IN_PROGRESS, EVENTS_IDENTIFIED, CONTEXTS_MAPPED, VERIFIED, LOCKED, SKIPPED |
| 2.3 JTBD Cards | NOT_STARTED, IN_PROGRESS, JOBS_IDENTIFIED, DIMENSIONS_MAPPED, VERIFIED, LOCKED, SKIPPED |
| 2.4 Story Mapping | NOT_STARTED, IN_PROGRESS, BACKBONE_BUILT, STORIES_MAPPED, RELEASES_SLICED, VERIFIED, LOCKED |
| 2.5 Kano+RICE+PRD | NOT_STARTED, IN_PROGRESS, FEATURES_CLASSIFIED, PRIORITIZED, PRD_DRAFTED, VERIFIED, LOCKED |
| 2.6 User Flows & IA | NOT_STARTED, IN_PROGRESS, FLOWS_MAPPED, IA_DEFINED, VERIFIED, LOCKED |
| 2.7 Wireframes | NOT_STARTED, IN_PROGRESS, WIREFRAMES_CREATED, VERIFIED, LOCKED |
| 2.8 Design System | NOT_STARTED, IN_PROGRESS, TOKENS_DEFINED, COMPONENTS_SPECIFIED, VERIFIED, LOCKED, SKIPPED |
| 2.9 Interaction Design | NOT_STARTED, IN_PROGRESS, INTERACTIONS_DEFINED, STATE_MATRIX, VERIFIED, LOCKED, SKIPPED |
| 2.10 Design Acceptance | NOT_STARTED, IN_PROGRESS, DESIGN_REVIEWED, APPROVED, LOCKED |

### Phase 3 Sub-Phases

| Sub-Phase | States |
|-----------|--------|
| 3.1 System Context | NOT_STARTED, IN_PROGRESS, CONTEXT_MAPPED, VERIFIED, LOCKED |
| 3.2 Architecture Style | NOT_STARTED, IN_PROGRESS, STYLE_SELECTED, VERIFIED, LOCKED |
| 3.3 Container Design | NOT_STARTED, IN_PROGRESS, CONTAINERS_DESIGNED, VERIFIED, LOCKED |
| 3.4 Quality Attributes | NOT_STARTED, IN_PROGRESS, ATTRIBUTES_IDENTIFIED, VERIFIED, LOCKED, SKIPPED |
| 3.5 Component Design | NOT_STARTED, IN_PROGRESS, COMPONENTS_MAPPED, VERIFIED, LOCKED |
| 3.6 Epics | NOT_STARTED, IN_PROGRESS, EPICS_DEFINED, FEATURES_PLANNED, VERIFIED, LOCKED |
| 3.7 Story Design | NOT_STARTED, IN_PROGRESS, STORIES_DRAFTED, ACCEPTANCE_CHECKS_REVIEWED, DEVELOPMENT_ORDER_FROZEN, LOCKED |
| 3.8 API & Data Design | NOT_STARTED, IN_PROGRESS, API_SPEC_DEFINED, DB_SCHEMA_DEFINED, VERIFIED, LOCKED |
| 3.9 Readiness Check | NOT_STARTED, IN_PROGRESS, READINESS_EVALUATED, ALL_GATES_PASSED, LOCKED |

### Phase 4 Sub-Phases

| Sub-Phase | States |
|-----------|--------|
| 4.1 Sprint Planning | NOT_STARTED, IN_PROGRESS, SPRINT_PLANNED, LOCKED |
| 4.2 BE Scaffolding | NOT_STARTED, IN_PROGRESS, SCAFFOLDED, VERIFIED, LOCKED |
| 4.3 BE Database | NOT_STARTED, IN_PROGRESS, MIGRATIONS_WRITTEN, MIGRATIONS_RUN, CLIENT_GENERATED, VERIFIED, LOCKED |
| 4.4 BE Endpoints | NOT_STARTED, IN_PROGRESS, IMPLEMENTED, TESTED, SPEC_COMPLIANT, SUBMITTED, APPROVED, CODE_ACCEPTED, BLOCKED_BY_DEPENDENCY |
| 4.5 BE Testing Suite | NOT_STARTED, IN_PROGRESS, TESTS_WRITTEN, ALL_PASSING, COVERAGE_MET, LOCKED |
| 4.6 BE Completion Review | NOT_STARTED, CODE_ACCEPTANCE, CODE_ACCEPTED, LOCKED |
| 4.7 FE Scaffolding | NOT_STARTED, IN_PROGRESS, SCAFFOLDED, VERIFIED, LOCKED |
| 4.8 FE Design System | NOT_STARTED, IN_PROGRESS, COMPONENTS_BUILT, DOCUMENTED, REVIEWED, LOCKED |
| 4.9 FE API Client | NOT_STARTED, IN_PROGRESS, CLIENT_GENERATED, MOCKS_READY, VERIFIED, LOCKED |
| 4.10 FE Pages | NOT_STARTED, IN_PROGRESS, IMPLEMENTED, TESTED, A11Y_CHECKED, SUBMITTED, APPROVED, CODE_ACCEPTED, BLOCKED_BY_DEPENDENCY |
| 4.11 FE A11y & Perf Audit | NOT_STARTED, IN_PROGRESS, A11Y_PASSED, PERF_PASSED, LOCKED |
| 4.12 FE Completion Review | NOT_STARTED, UI_ACCEPTANCE, UI_ACCEPTED, LOCKED |
| 4.13 Integration | NOT_STARTED, IN_PROGRESS, MERGE_QUEUE_PROCESSED, CONTRACT_VERIFIED, INTEGRATED, FEATURE_ACCEPTANCE, FEATURE_ACCEPTED, E2E_BROWSER_ACCEPTANCE, E2E_BROWSER_ACCEPTED, APPROVED, LOCKED |
| 4.14 Retrospective | NOT_STARTED, IN_PROGRESS, RETRO_COMPLETED, APPROVED, LOCKED |

### Full-Stack Sub-Phases

| Sub-Phase | States |
|-----------|--------|
| fs-1 Scaffolding | NOT_STARTED, IN_PROGRESS, SCAFFOLDED, VERIFIED, LOCKED |
| fs-2 Foundation | NOT_STARTED, IN_PROGRESS, ORG_SETUP, DB_READY, AUTH_READY, MIDDLEWARE_READY, VERIFIED, LOCKED |
| fs-3 Stories | NOT_STARTED, IN_PROGRESS, IMPLEMENTED, TESTED, SPEC_COMPLIANT, SUBMITTED, APPROVED, CODE_ACCEPTED, BLOCKED_BY_DEPENDENCY |
| fs-4 QA | NOT_STARTED, IN_PROGRESS, TESTS_PASSED, A11Y_PASSED, PERF_PASSED, LOCKED |
| fs-5 Review | NOT_STARTED, IN_PROGRESS, REVIEWED, APPROVED, LOCKED |

## State Transitions (Phase Level)

```
Phase 1:  NOT_STARTED → IN_PROGRESS → ALL_SUB_PHASES_APPROVED → ANALYSIS_COMPLETE → APPROVED → LOCKED
            ↳ SKIPPED                          ↳ UNLOCK_RESOLVE → APPROVED → LOCKED

Phase 2:  NOT_STARTED → IN_PROGRESS → ALL_SUB_PHASES_APPROVED → PLANNING_COMPLETE → APPROVED → LOCKED
            ↳ SKIPPED                          ↳ UNLOCK_RESOLVE → APPROVED → LOCKED

Phase 3:  NOT_STARTED → IN_PROGRESS → ALL_SUB_PHASES_APPROVED → SOLUTIONING_COMPLETE → APPROVED → LOCKED
            ↳ SKIPPED                          ↳ UNLOCK_RESOLVE → APPROVED → LOCKED

Phase 4:  NOT_STARTED → IN_PROGRESS → BE_TRACK_COMPLETE → FE_TRACK_COMPLETE → MERGE_QUEUED → FULL_STACK_INTEGRATED → APPROVED → LOCKED
            ↳ BLOCKED (by CR)                    ↳ UNLOCK_RESOLVE → APPROVED → LOCKED
```

## State Transitions (Story Level)

```
NOT_STARTED → IN_PROGRESS → IMPLEMENTED → TESTED → SPEC_COMPLIANT → SUBMITTED
  → CODE_ACCEPTANCE → CODE_ACCEPTED
    → FEATURE_ACCEPTANCE → FEATURE_ACCEPTED
      → UI_ACCEPTANCE → UI_ACCEPTED (FE only)
        → E2E_BROWSER_ACCEPTANCE → E2E_BROWSER_ACCEPTED (FE only)
          → MERGE_QUEUED → MERGED
```

## Mode Enumeration

```yaml
dev_mode:
  - "separated"    # Separate BE + FE projects
  - "full_stack"   # Unified codebase

task_triage_mode:
  - "light"        # Skip Phase 1-3, direct implementation
  - "serial"       # Full phases, serial Phase 4
  - "parallel"     # Full phases, parallel Phase 4

complexity_tier:
  - "simple"       # No step_history, no slicing
  - "standard"     # step_history enabled
  - "complex"      # step_history + slicing enabled
```
