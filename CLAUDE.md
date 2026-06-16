# CLAUDE.md — web-dev-flow V3

## Project Overview

`web-dev-flow` is a Claude Code workflow skill that automates the full lifecycle of web project development — from Analysis through Implementation. It is a standalone skill (not a BMAD module) that orchestrates BMAD's analysis/planning skills and adds web-specific phases for API design, parallel development, and acceptance gates.

**Version:** 3.6.0

## V3.6 Key Improvements

1. **Split-File Status Design** — `sprint-status.yaml` is DERIVED from `status/` directory files. Each file has exactly one writer (Write Permission Matrix). Zero write conflicts across parallel agents.
2. **File-Based Merge Queue** — One file per queued story in `merge-queue/items/`. Lock only during file creation (~100ms). No lock for content writes or status updates.
3. **Consolidated Scope Lock V2.0** — Reduced from 9 to 5 operation types. JSONL audit log format for atomicity. Complexity-tiered step audit (minimal/full).
4. **Story Slicing V2.0** — Optional P0/P1 slicing for L/XL stories. Derived story status from slice aggregation. Complexity-tiered defaults.
5. **Complexity Tiers** — `simple` / `standard` / `complex` tiers control audit depth, step_history detail, and slicing defaults. Avoids over-engineering small projects.

## V3.1 Key Improvements (StoryRail Absorption)

V3.1 absorbs 10 key advantages from StoryRail and creedis-custody-manager:

1. **Task Triage (Three-Mode Routing)** — Light/serial/parallel triage at activation. Light tasks skip Phases 1-3.
2. **Code Standards Gate** — Every story MUST declare `code_standards_source`. Blocked if missing.
3. **Story Contract Freeze Gate** — Hard gate at Phase 3.7 verifying 7 contract fields. Non-compliant stories blocked from Phase 4.
4. **Acceptance Checks Executable Validation** — Rejects placeholder checks ("todo", "通过测试"). Commands must reference real scripts.
5. **Protected Paths Enforcement** — 12 protected path categories in customize.toml. Intersection → serial_only.
6. **Handoff Minimum Gate** — self-check.md MUST have Commands run + Results. handoff.md MUST have Summary + Files changed. Missing → no SUBMITTED.
7. **Execution Units** — Per-role (backend/frontend) execution units with independent scope_write + acceptance_checks.
8. **Merge Queue with Dependency Ordering** — CODE_ACCEPTED stories enter dependency-ordered merge queue. Phase 4.13 processes by merge_order.
9. **Contract Gate** — API/Data Model stories verify field-level contract compliance before coding.
10. **Page Parity Gate** — Frontend page stories read UX specs, output gap list before coding. Browser Runtime Verification with screenshots required.

## V3 Key Improvements (from V2)

V3 represents a major restructuring aligning to BMAD's 4-phase model:

1. **BMAD 4-Phase Restructuring**: Workflow reorganized into Analysis (optional) → Planning → Solutioning → Implementation (down from 9 phases)
2. **Dual-Layer FSM**: Phase-level + story-level state machines with explicit acceptance states (CODE_ACCEPTANCE, FEATURE_ACCEPTANCE, UI_ACCEPTANCE, E2E_BROWSER_ACCEPTANCE)
3. **Acceptance Command Patterns**: 4 executable acceptance gate types replace verbal approval for implementation quality
4. **Expanded Gate Card System**: 11 check types (7 original + 4 acceptance) for comprehensive quality verification
5. **Sub-Workflows**: All 4 phases have detailed sub-phase breakdowns (36 total sub-phases)
6. **Change Request Mechanism**: Formal CR process when downstream phases discover upstream defects. Blocking CRs halt progress; non-blocking CRs are deferred.
7. **Standardized Artifact Schema**: All output files follow a unified YAML frontmatter schema with BMAD state tracking (bmad_state, bmad_review_passed)
8. **System of Record**: sprint-status.yaml is the read/write center for all state, not just a write-only log.
9. **Acceptance Quality Gates**: Configurable thresholds per acceptance type in customize.toml

## Architecture

### Design Pattern: Complex Workflow with Sub-Workflows

- **SKILL.md** — Main entry point: FSM engine, routing, commands, conventions, activation
- **references/** — 4 main phase files + sub-workflows/ directory
- **sub-workflows/analysis/** — 3 phase-1 sub-workflow files (all skippable)
- **sub-workflows/planning/** — 10 phase-2 sub-workflow files
- **sub-workflows/solutioning/** — 9 phase-3 sub-workflow files
- **sub-workflows/implementation/** — 14 phase-4 sub-workflow files
- **sub-workflows/fullstack/** — 5 full-stack mode sub-workflow files
- **schemas/** — 4 schema definition files
- **assets/** — Templates: OpenAPI spec, DB schema doc, ADR template
- **customize.toml** — Configurable defaults, acceptance gates, sub-phase settings

### Workflow Phases

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 (BE ┐
                                        ├→ Integration → Acceptance)
                                  Phase 4 (FE ┘
```

1. **Analysis** (Phase 1, Optional/Skippable) — 3 sub-phases: Impact Mapping (1.1) → Event Storming (1.2, skippable) → JTBD (1.3, skippable). Output: impact-map.md, event-storm.md, jtbd-cards.md.
2. **Planning** (Phase 2) — 10 sub-phases: Product Brief → Domain Research → Impact Mapping → Event Storming → JTBD Cards → Story Mapping → Prioritization & PRD → User Flows & Sitemap → Wireframes & Design Tokens → Design Acceptance. Output: PRD + UX design artifacts.
3. **Solutioning** (Phase 3) — 9 sub-phases: C4 System Context (L1) → Architecture Style → Container Design (L2) → Quality Attributes → Component Design (L3) → Epics & Feature Plan → Story Design → API & Data Design → Readiness Check. Output: Architecture docs, epics, stories, API spec, DB schema.
4. **Implementation** (Phase 4) — 14 sub-phases with parallel BE + FE tracks: BE Scaffolding → BE Database → BE API Client → BE Endpoints (AUTO-CONTINUE) → BE Testing → BE Code Acceptance → FE Scaffolding → FE Design System → FE API Client → FE Component Specs → FE Pages (AUTO-CONTINUE) → FE UI Acceptance → Integration → E2E Browser Acceptance. Output: Working application + acceptance reports.

### Phase 1 Sub-Phases (Analysis — Skippable)

| Sub-Phase | Name | FSM | Output |
|-----------|------|-----|--------|
| 1.1 | Impact Mapping | NOT_STARTED → ... → LOCKED | impact-map.md |
| 1.2 | Event Storming | NOT_STARTED → ... → LOCKED or SKIPPED | event-storm.md |
| 1.3 | Jobs to Be Done | NOT_STARTED → ... → LOCKED or SKIPPED | jtbd-cards.md |

### Phase 2 Sub-Phases (Planning — 10 sub-phases)

| Sub-Phase | Name | FSM | Output |
|-----------|------|-----|--------|
| 2.1 | Product Brief | NOT_STARTED → BRIEF_DRAFTED → VERIFIED → LOCKED | product-brief.md |
| 2.2 | Domain Research | NOT_STARTED → RESEARCHED → DOCUMENTED → VERIFIED → LOCKED (skippable) | domain-research.md |
| 2.3 | Impact Mapping | NOT_STARTED → MAP_DRAFTED → VERIFIED → LOCKED (skippable) | impact-map.md |
| 2.4 | Event Storming | NOT_STARTED → EVENTS_IDENTIFIED → CONTEXTS_MAPPED → VERIFIED → LOCKED (skippable) | event-storm.md |
| 2.5 | JTBD Cards | NOT_STARTED → JOBS_IDENTIFIED → DIMENSIONS_MAPPED → VERIFIED → LOCKED (skippable) | jtbd-cards.md |
| 2.6 | Story Mapping | NOT_STARTED → BACKBONE_BUILT → STORIES_MAPPED → RELEASES_SLICED → VERIFIED → LOCKED | story-map.md |
| 2.7 | Prioritization & PRD | NOT_STARTED → FEATURES_CLASSIFIED → PRIORITIZED → PRD_DRAFTED → VERIFIED → LOCKED | prioritization.md + prd.md |
| 2.8 | User Flows & Sitemap | NOT_STARTED → FLOWS_MAPPED → IA_DEFINED → VERIFIED → LOCKED | user-flows.md + sitemap.md |
| 2.9 | Wireframes & Design Tokens | NOT_STARTED → WIREFRAMES_CREATED → TOKENS_DEFINED → VERIFIED → LOCKED | wireframes.md + design-tokens.md |
| 2.10 | Design Acceptance | NOT_STARTED → CRITERIA_COMPILED → ACCEPTANCE_DEFINED → VERIFIED → LOCKED | design-acceptance.md |

### Phase 3 Sub-Phases (Solutioning — 9 sub-phases)

| Sub-Phase | Name | FSM | Output |
|-----------|------|-----|--------|
| 3.1 | System Context (C4 L1) | NOT_STARTED → CONTEXT_MAPPED → VERIFIED → LOCKED | system-context.md |
| 3.2 | Architecture Style | NOT_STARTED → STYLE_SELECTED → VERIFIED → LOCKED | architecture-style.md |
| 3.3 | Container Design (C4 L2) | NOT_STARTED → CONTAINERS_DESIGNED → VERIFIED → LOCKED | container-design.md |
| 3.4 | Quality Attributes | NOT_STARTED → ATTRIBUTES_IDENTIFIED → VERIFIED → LOCKED (skippable) | quality-attributes.md |
| 3.5 | Component Design (C4 L3) | NOT_STARTED → COMPONENTS_MAPPED → VERIFIED → LOCKED | component-design.md |
| 3.6 | Epics & Feature Plan | NOT_STARTED → EPICS_DRAFTED → VERIFIED → LOCKED | epics.md |
| 3.7 | Story Design | NOT_STARTED → STORIES_DRAFTED → VERIFIED → LOCKED | stories/*.md |
| 3.8 | API & Data Design | NOT_STARTED → API_SPEC_DRAFTED → DB_SCHEMA_DRAFTED → VERIFIED → LOCKED | api-spec.yaml + db-schema.md |
| 3.9 | Readiness Check | NOT_STARTED → CHECKS_VERIFIED → APPROVED → LOCKED | readiness-check.md |

### Phase 4 Sub-Phases (Implementation — 14 sub-phases)

| Sub-Phase | Name | FSM | Output |
|-----------|------|-----|--------|
| 4.1 | Sprint Planning | NOT_STARTED → SPRINT_PLANNED → LOCKED | sprint-plan.md |
| 4.2 | BE Scaffolding | NOT_STARTED → SCAFFOLDED → VERIFIED → LOCKED | be-scaffold-report.md |
| 4.3 | BE Database | NOT_STARTED → MIGRATIONS_WRITTEN → MIGRATIONS_RUN → VERIFIED → LOCKED | be-migration-report.md |
| 4.4 | BE Endpoints | NOT_STARTED → ... → APPROVED (AUTO-CONTINUE iterative) | be-dev-log.md |
| 4.5 | BE Testing Suite | NOT_STARTED → TESTS_WRITTEN → ALL_PASSING → COVERAGE_MET → LOCKED | be-test-report.md |
| 4.6 | BE Completion Review | NOT_STARTED → CODE_ACCEPTANCE → CODE_ACCEPTED → LOCKED | be-code-acceptance-report.md |
| 4.7 | FE Scaffolding | NOT_STARTED → SCAFFOLDED → VERIFIED → LOCKED | fe-scaffold-report.md |
| 4.8 | FE Design System | NOT_STARTED → COMPONENTS_BUILT → DOCUMENTED → REVIEWED → LOCKED | fe-design-system-report.md |
| 4.9 | FE API Client | NOT_STARTED → CLIENT_GENERATED → MOCKS_READY → VERIFIED → LOCKED | fe-api-client-report.md |
| 4.10 | FE Pages | NOT_STARTED → ... → APPROVED (AUTO-CONTINUE iterative) | fe-dev-log.md |
| 4.11 | FE A11y & Perf Audit | NOT_STARTED → A11Y_PASSED → PERF_PASSED → LOCKED | fe-audit-report.md |
| 4.12 | FE Completion Review | NOT_STARTED → UI_ACCEPTANCE → UI_ACCEPTED → LOCKED | fe-completion-review-report.md |
| 4.13 | Integration | NOT_STARTED → INTEGRATED → FEATURE_ACCEPTANCE → FEATURE_ACCEPTED → APPROVED → LOCKED | integration-report.md |
| 4.14 | Retrospective | NOT_STARTED → RETRO_COMPLETED → APPROVED → LOCKED | retrospective.md |

### FSM State Machine

All phases follow:
NOT_STARTED → IN_PROGRESS → DRAFT_COMPLETE → IN_REVIEW → APPROVED → LOCKED → UNLOCK_RESOLVE

Acceptance states:
CODE_ACCEPTANCE → CODE_ACCEPTED
FEATURE_ACCEPTANCE → FEATURE_ACCEPTED
UI_ACCEPTANCE → UI_ACCEPTED
E2E_BROWSER_ACCEPTANCE → E2E_BROWSER_ACCEPTED

Sub-phases have domain-specific FSMs (see individual sub-workflow files).

### Gate Card System

Gate Cards are structured YAML definitions that all phases use to validate entry conditions. They support 11 check types:
- artifact_exists, artifact_metadata, artifact_checksum
- user_confirmation, dependency_status
- quality_threshold, all_stories_complete
- code_acceptance, feature_acceptance, ui_acceptance, e2e_browser_acceptance

Gate evaluation is recorded in sprint-status.yaml. A phase can only be entered when all_pass: true.

### Change Request System

Change Requests (CRs) are filed when a downstream phase discovers an issue in an upstream artifact.

- **blocking**: Current phase is set to BLOCKED. Source phase is unlocked (LOCKED → UNLOCK_RESOLVE), artifact is fixed, re-reviewed, and re-locked.
- **non_blocking**: Recorded but does not block progress. Resolved during Phase 4 (configurable via `change_request.non_blocking_deferred_to`).

### Requirements Freeze & Development Order Freeze

- **Requirements Freeze** (Phase 2.5): When user confirms JTBD cards complete, `global_state.requirements_frozen_at` is set. No new features without a CR.
- **Development Order Freeze** (Phase 3.7): When stories are sequenced, `global_state.development_order` is locked. Developers follow this order globally.

### Acceptance Command Patterns

4 executable acceptance gates replace verbal approval:

| Acceptance Type | Sub-Phase | Key Fields |
|-----------------|-----------|------------|
| `code_acceptance` | 4.6, 4.12 | review_passed, test_coverage, type_check_passed, lint_passed, acceptance_checks_all_pass |
| `feature_acceptance` | 4.13 | all_stories_code_accepted, contract_verified, e2e_critical_paths_pass, security_audit_pass |
| `ui_acceptance` | 4.12 | visual_parity, a11y issues, lighthouse scores, bundle_size_kb, axe_audit_pass |
| `e2e_browser_acceptance` | 4.13 | browser_tests_pass, visual_regression, cross_browser, responsive, network |

### Commands

- `web-dev-flow status` — Display full progress dashboard
- `phase N status` — Display specific phase/sub-phase detail
- `freeze requirements` — Freeze requirements (at 2.5)
- `freeze development order` — Freeze dev sequence (at 3.7)
- `run code acceptance` — Trigger CODE_ACCEPTANCE checks
- `run ui acceptance` — Trigger UI_ACCEPTANCE checks
- `run feature acceptance` — Trigger FEATURE_ACCEPTANCE checks
- `run e2e browser acceptance` — Trigger E2E_BROWSER_ACCEPTANCE checks

## File Structure

```
wdf-method/
├── CLAUDE.md                           # This file
├── SKILL.md                            # Main entry point, routing, FSM engine
├── customize.toml                      # Configuration + acceptance gates
├── assets/                             # Templates
├── schemas/                            # Schema definitions
│   ├── artifact-frontmatter-schema.yaml
│   ├── gate-card-schema.yaml
│   ├── change-request-schema.yaml
│   └── sprint-status-schema.yaml
├── specs/                              # Protocols & designs (global standards)
│   ├── agent-isolation.md
│   ├── worktree-isolation.md
│   ├── git-commit-checkpoints.md
│   ├── scope-lock.md
│   ├── step-audit.md
│   ├── story-slicing.md
│   ├── status-directory.md
│   └── merge-queue.md
└── references/                         # Phase reference files
    ├── phase-01-analysis.md
    ├── phase-02-planning.md
    ├── phase-03-solutioning.md
    ├── phase-04-implementation.md
    └── sub-workflows/
        ├── analysis/
        │   ├── 1-1-brainstorming.md
        │   ├── 1-2-domain-research.md
        │   └── 1-3-product-brief.md
        ├── planning/
        │   ├── 2-1-impact-mapping.md
        │   ├── 2-2-event-storming.md
        │   ├── 2-3-jobs-to-be-done.md
        │   ├── 2-4-story-mapping.md
        │   ├── 2-5-prioritization-spec.md
        │   ├── 2-6-user-flows.md
        │   ├── 2-7-wireframes.md
        │   ├── 2-8-design-system.md
        │   ├── 2-9-interaction-design.md
        │   └── 2-10-design-acceptance.md
        ├── solutioning/
        │   ├── 3-1-system-context.md
        │   ├── 3-2-architecture-style.md
        │   ├── 3-3-container-design.md
        │   ├── 3-4-quality-attributes.md
        │   ├── 3-5-component-synthesis.md
        │   ├── 3-6-epics.md
        │   ├── 3-7-stories.md
        │   ├── 3-8-api-design.md
        │   └── 3-9-readiness-check.md
        ├── implementation/
        │   ├── 4-1-sprint-planning.md
        │   ├── 4-2-be-scaffolding.md
        │   ├── 4-3-be-database.md
        │   ├── 4-4-be-api-endpoints.md
        │   ├── 4-5-be-testing-suite.md
        │   ├── 4-6-be-completion-review.md
        │   ├── 4-7-fe-scaffolding.md
        │   ├── 4-8-fe-design-system.md
        │   ├── 4-9-fe-api-client.md
        │   ├── 4-10-fe-page-implementation.md
        │   ├── 4-11-fe-a11y-perf-audit.md
        │   ├── 4-12-fe-completion-review.md
        │   ├── 4-13-integration.md
        │   ├── 4-14-retrospective.md
        └── fullstack/
            ├── fs-1-scaffolding.md
            ├── fs-2-foundation.md
            ├── fs-3-stories.md
            ├── fs-4-qa.md
            └── fs-5-review.md
```

## Output Structure

```
_wdf_output/
├── prd.md
├── research/
├── _output/analysis/
│   ├── impact-map.md
│   ├── event-storm.md
│   └── jtbd-cards.md
├── _output/planning/
│   ├── product-brief.md
│   ├── domain-research.md
│   ├── impact-map.md
│   ├── event-storm.md
│   ├── jtbd-cards.md
│   ├── story-map.md
│   ├── prioritization.md
│   ├── user-flows.md
│   ├── sitemap.md
│   ├── wireframes.md
│   ├── design-tokens.md
│   └── design-acceptance.md
├── architecture.md
├── _output/solutioning/
│   ├── system-context.md
│   ├── architecture-style.md
│   ├── container-design.md
│   ├── quality-attributes.md
│   ├── component-design.md
│   ├── readiness-check.md
├── epics.md
├── stories/
├── api-spec.yaml
├── db-schema.md
├── sprint-status.yaml                # System of Record
├── sprint-plan.md                    # Phase 4.1 output
├── be-scaffold-report.md             # Phase 4.2 output
├── be-migration-report.md            # Phase 4.3 output
├── be-api-client-report.md           # Phase 4.3 output
├── be-dev-log.md                     # Phase 4.4 output
├── be-test-report.md                 # Phase 4.5 output
├── be-code-acceptance-report.md      # Phase 4.6 output
├── fe-scaffold-report.md             # Phase 4.7 output
├── fe-design-system-report.md        # Phase 4.8 output
├── fe-api-client-report.md           # Phase 4.9 output
├── fe-dev-log.md                     # Phase 4.10 output
├── fe-audit-report.md                # Phase 4.11 output
├── fe-completion-review-report.md    # Phase 4.12 output
├── integration-report.md             # Phase 4.13 output
├── retrospective.md                  # Phase 4.14 output
├── _output/acceptance/
│   ├── feature-acceptance-report.md
│   └── e2e-browser-report.md
└── integration-report.md
```

## Tech Stack (Configurable)

- Frontend: React (default), Vue, Svelte, Next.js
- Backend: Express (default), Nest, Fastify, Django, Flask
- Database: PostgreSQL (default), MongoDB, MySQL, SQLite
- API Style: REST (default), GraphQL
- Auth: JWT (default), Session, OAuth2
- Deployment: Docker (default), Vercel, AWS

## Dependencies

- BMAD v6.6.0+ (for skill invocation)
- 14 BMAD skills: bmad-product-brief, bmad-domain-research, bmad-create-prd, bmad-create-architecture, bmad-create-epics-and-stories, bmad-create-story, bmad-dev-story, bmad-code-review, bmad-brainstorming, bmad-ux-design, bmad-api-design, bmad-sprint-planning, bmad-retrospective, bmad-architecture-review
- 4 acceptance commands: code_acceptance, feature_acceptance, ui_acceptance, e2e_browser_acceptance

## Quality Gates

Configured in customize.toml under [acceptance_gates]:

- Code Acceptance (4.6): test coverage >= 80%, lint + type check required, acceptance checks all pass
- UI Acceptance (4.12): Lighthouse >= 90 all categories, bundle < 500KB, axe audit required, visual parity check
- Feature Acceptance (4.13): contract compliance, E2E critical paths, security audit
- E2E Browser Acceptance (4.14): cross-browser (chrome/firefox/safari), responsive (mobile/tablet/desktop), network (3g/offline), visual regression < 0.5%

## Usage

1. Navigate to the target project
2. Invoke: `/web-dev-flow` or say "start a web project"
3. The workflow auto-detects state from sprint-status.yaml
4. Follow phase prompts with FSM-gated progression
5. Phases 1-4 expose sub-phase menus for granular control
6. Phase 4 runs BE+FE in parallel tracks, ending with 4 acceptance gates
7. Use acceptance commands to trigger quality verification

## Conventions

- Standalone skill — does not depend on BMAD module infrastructure
- Follows BMAD skill formatting conventions
- Phase files are self-contained, never cross-reference
- State is exclusively tracked in sprint-status.yaml (System of Record)
- All artifacts follow the artifact-frontmatter-schema with BMAD state tracking
