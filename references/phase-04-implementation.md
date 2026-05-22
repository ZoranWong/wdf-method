---
phase: 4
title: "Phase 4 — Implementation (Dual-Track Development + Integration + Retrospective)"
version: "3.6.0"
description: "Full implementation phase with 14 sub-phases across two parallel tracks (Backend and Frontend) for separated mode, or a merged full-stack track for unified frameworks. Includes sprint planning, four-tier acceptance gates, auto-continue story development, cross-track dependency detection, protected paths enforcement, merge queue with dependency ordering, integration, and retrospective. V3.1 adds StoryRail-inspired hard gates."
dependencies:
  - sprint-status.yaml
  - architecture.md
  - api-spec.yaml
  - db-schema.md
  - story files
  - development order (frozen at Phase 3.7)
---

# Phase 4 — Implementation

**Phase Goal:** Implement all stories from the frozen development order using structured, quality-gated development. In separated mode, Backend (4.2─4.6) and Frontend (4.7─4.12) tracks run in parallel, synchronized via sprint-status.yaml, with four tiers of structured acceptance verification. In full-stack mode, a merged development track runs after sprint planning. The phase concludes with integration verification and a project retrospective.

**Why Dual-Track + Multi-Tier Acceptance:** V2 had separate Phases 7 (Backend) and 8 (Frontend) with basic code review acceptance. V3 introduces four tiers of structured acceptance — CODE, FEATURE, UI, and E2E BROWSER — each with specific BMAD skill invocations. This ensures quality is verified at every level, not just at the end.

**Core Execution Principle — One Story = One Agent = One Worktree = One Context:**

Every story in Phase 4 runs as a **fully independent agent** with its own isolated worktree and clean context. This is the single most critical design decision in the workflow — it is NOT optional:

- **One Story = One Agent**: Each story gets its own Claude Code agent session. The main orchestrator does NOT write code — it only manages state, gates, and merge.
- **One Agent = One Worktree**: Each agent works in a git worktree created exclusively for that story (`story/{story_id}-{track}` branch). No file is ever written by two agents simultaneously.
- **One Worktree = One Context**: Each agent loads only the files needed for its story (~38KB: story definition + api-spec + architecture + db-schema/design-tokens + code standards). Other stories' implementations, sprint-status, and analysis documents are NEVER loaded into the agent's context.

**Why this matters:**
| Problem | Without isolation | With One-Story-One-Agent |
|---------|------------------|--------------------------|
| Context pollution | Agent A's patterns leak to Agent B | Each agent sees only its own scope |
| True parallelism | Same session = not parallel | Independent agents = real parallel execution |
| Fault isolation | One story crash affects entire session | Only current story's worktree affected |

See `specs/agent-isolation.md` for the full specification.

**Duration:** Sub-phases 4.1 and 4.13─4.14 are sequential. Sub-phases 4.2─4.6 (Backend) and 4.7─4.12 (Frontend) are parallel in separated mode. In full-stack mode, 4.2─4.12 are replaced by a single merged development path.

**Prerequisites:**
- `global_state.dev_mode` is set in Phase 3.2. `global_state.development_order` is frozen at Phase 3.7.
- Claude Code Agent tool must be available (for dispatching per-story agents)
- Git worktree support must be enabled (for file isolation)

---

## Mode-Aware Routing

This orchestrator supports two execution modes determined by `global_state.dev_mode` (set in Phase 3.2):

### Separated Mode (dev_mode: "separated")

Routes **all 14 sub-phases** with parallel Backend (4.2─4.6) and Frontend (4.7─4.12) tracks:

```
4.1 Sprint Planning
  ├── Backend Track (4.2─4.6)  ── parallel ──┐
  └── Frontend Track (4.7─4.12) ── parallel ──┘
  └── 4.13 Integration & E2E (both tracks complete)
  └── 4.14 Retrospective
```

### Full-Stack Mode (dev_mode: "full_stack")

Routes **3 sub-phases** with merged development:

```
4.1 Sprint Planning
  → Merged Full-Stack Development (skip 4.2─4.12)
  → 4.13 Integration & E2E
  → 4.14 Retrospective
```

---

## Scope Lock Protocol

Phase 4 enforces a **three-level scope lock** to prevent agents from modifying files outside their assigned scope. This is defined in `specs/scope-lock.md`.

### Level 1: Phase Boundary

`global_state.implementation_boundary` is generated during Phase 3.9 (Readiness Check) as the union of all story `scope_write` paths. It defines the maximum set of files/directories that may be modified during Phase 4.

At Phase 4.1 (Sprint Planning), a git tag `scope-freeze/pre-implementation` is created as the diff baseline for scope verification.

### Level 1.5: Protected Paths Enforcement (V3.1)

`customize.toml` `scope_lock.protected_paths` defines 12 categories of shared/high-risk paths that MUST NOT be modified by parallel agents:

| Protected Path | Description |
|---------------|-------------|
| `shared/contract` | Shared API contracts, data schemas |
| `shared/types` | Shared TypeScript/type definition files |
| `schema/migration` | Database schema and migration files |
| `root/config` | Root-level configuration (tsconfig, package.json, etc.) |
| `api/contract` | API contract definitions (OpenAPI specs) |
| `route/entry` | Application route entry points |
| `permission/model` | Permission/authorization models |
| `build/ci` | Build scripts and CI configuration |
| `env/template` | Environment variable templates |
| `shared/ui/shell` | Shared UI shell/layout components |
| `route/registry` | Route registration files |
| `global/design/tokens` | Global design token definitions |

**Enforcement rules:**
- **SRG-08**: If a story's `scope_write` intersects with any `protected_path`, the story is automatically marked `serial_only` (cannot run in parallel with any other story).
- Protected paths may still be modified, but only in serial mode (one story at a time).
- The protected path check runs at both Story Ready Gate (Phase 4.4/4.10) and merge time (Phase 4.13).
- Stories that intentionally need to modify protected paths must be explicitly approved by the user.

### Level 2: Story Scope Lock

Each story has its own `scope_write` declaration. The Story Ready Gate enforces:
- **SRG-05** (upgraded to blocking): No overlapping scope_write with other IN_PROGRESS stories
- **SRG-06** (new): scope_write paths must be within implementation_boundary
- **SRG-07** (new): scope_write path parent directories must exist

Before transitioning to SUBMITTED, a **Scope Exit Verification** runs `git diff --name-only HEAD` and checks each changed file against `scope_write`. Violations trigger a remediation menu.

### Level 3: Acceptance Scope Audit

CODE ACCEPTANCE includes **CA-05** (scope boundary audit) that verifies all changes are within scope. Track-level scope audits run at Phase 4.6 (BE Completion Review) and Phase 4.12 (FE Completion Review).

### Scope Expansion CR

When an agent needs to modify files outside `scope_write`, it submits a Scope Expansion CR:
```yaml
cr:
  type: "scope_expansion"
  story_id: "{story_id}"
  current_scope: [...]
  requested_scope: [...]
  reason: "..."
  files_to_modify: [...]
```

### Standard Output Format

Every Scope Lock operation produces two outputs:

1. **Console Output** — Fixed-format terminal display:
```
═══════════════════════════════════════════════════════
SCOPE LOCK — {operation_name}
═══════════════════════════════════════════════════════
  Phase:    {phase}.{sub_phase}
  Story:    {story_id}
  Step:     {step_id}
  Skill:    {skill_invoked}
  Command:  {command_executed}
  Status:   {PASS | FAIL | WARNING}
───────────────────────────────────────────────────────
  {details}
───────────────────────────────────────────────────────
  Summary:  {one_line_summary}
  Next:     {what_happens_next}
═══════════════════════════════════════════════════════
```

2. **Scope Audit Record** — Appended to `{scope_audit_log_output}`:
```yaml
- operation: "{operation_name}"
  timestamp: "{ISO_TIMESTAMP}"
  phase: "{phase}.{sub_phase}"
  story_id: "{story_id or null}"
  step_id: "{step_id}"
  skill_used: "{skill or null}"
  command_run: "{command or null}"
  status: "{PASS | FAIL | WARNING}"
  details: { ... }
  summary: "{one_line_summary}"
  next_action: "{what_happens_next}"
```

Full templates for all 9 operations are defined in `specs/scope-lock.md → Standard Output Format Specification`.

### Step Audit Protocol

Beyond scope lock operations, **every sub-step** in Phase 4 (4a, 4b, 4c, etc.) writes a Step Completion Record to `{step_audit_log_output}`. This provides:

1. **Task tracking** — know exactly which sub-step each story has reached
2. **Session recovery** — after interruption, read last record's `next_action` to resume
3. **Quality audit trail** — each step records skill_used, command_run, quality checks

Each record updates the story's `last_completed_substep` in sprint-status.yaml (e.g., `last_completed_substep: "4c"`), enabling precise resume without replaying completed work.

See `specs/step-audit.md` for the full template, Step ID mapping, and recovery logic.

Configuration in `customize.toml → [scope_lock]`:

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable/disable scope lock |
| `enforcement_mode` | `"strict"` | `"strict"` / `"permissive"` / `"warning_only"` |
| `srg_05_severity` | `"blocking"` | Parallel story scope overlap severity |
| `scope_expansion_requires` | `"user_approval"` | `"user_approval"` / `"auto_approve"` |
| `forbidden_paths` | `[]` | Paths that can NEVER be modified |

---

## Dual-Layer FSM Model

Phase 4 uses two FSM layers that operate simultaneously:

### Layer 1 — web-dev-flow Master FSM

Tracks story progression through four acceptance tiers plus merge queue:

```
For sub-phases 4.4 (BE) and 4.10 (FE), per story:
  IN_PROGRESS
    → CODE_ACCEPTANCE    → CODE_ACCEPTED
    → FEATURE_ACCEPTANCE → FEATURE_ACCEPTED
    → UI_ACCEPTANCE      → UI_ACCEPTED       (FE only)
    → E2E_BROWSER_ACCEPTANCE → E2E_BROWSER_ACCEPTED  (FE only)
    → MERGE_QUEUED       → MERGED             ← 故事完成，唯一终点
```

A story is **complete only when MERGED**. CODE_ACCEPTED means all quality gates passed and the story enters the Merge Queue. The merge to main happens in Phase 4.13 via the dependency-ordered Merge Queue.

**Merge Queue Lifecycle (V3.1):**
```
CODE_ACCEPTED → merge_queue entry created
  → queued (dependencies met) OR waiting_dependency (dependencies unmet)
  → merging (Phase 4.13 processes this item)
  → merged (success) OR failed (integration check failure)
```

### Layer 2 — BMAD Story FSM (per-SubPhase)

Tracks the BMAD tool's internal story workflow:

```
backlog → ready-for-dev → in-progress → review → done (CODE_ACCEPTED)
```

The BMAD FSM is the granular micro-state. The web-dev-flow FSM is the macro-quality-state. A story transitions `CODE_ACCEPTED` when the BMAD FSM reaches `done`.

---

## Four Acceptance Command Patterns

Phase 4 introduces four formal acceptance tiers. Each tier has specific BMAD skill invocations and exit criteria.

### 1. CODE ACCEPTANCE (Per-Story)

Applied to every story during 4.4 (BE API Endpoints) and 4.10 (FE Page Implementation).

```yaml
acceptance_tier: CODE
applies_to: all stories (BE + FE)
trigger: after TDD cycle completes
skills:
  - /bmad-code-review adversarial  # adversarial code review
  - acceptance_check               # story-defined executable checks
exit_criteria:
  - all acceptance_check commands exit 0
  - /bmad-code-review adversarial passes (no blocking issues)
  - handoff docs (self-check.md + handoff.md) generated
target_state: CODE_ACCEPTED
```

**Per-Story Acceptance Flow:**
```
1. TDD: Write failing test → implement → pass test → refactor
2. Self-check: run story-defined scope_write verification
3. Generate handoff docs: self-check.md + handoff.md
4. /bmad-code-review adversarial → fix blocking issues → re-review
5. Run acceptance_check commands → all must exit 0
6. Transition story: IMPLEMENTED → CODE_ACCEPTED
```

### 2. FEATURE ACCEPTANCE (Per-Track)

Applied when all stories in a track reach CODE_ACCEPTED.

```yaml
acceptance_tier: FEATURE
applies_to: per track (BE and FE independently)
trigger: all stories in track CODE_ACCEPTED
skills:
  - /bmad-feature-verify {backend|frontend}  # feature-level verification
  - /bmad-contract-verify backend             # BE only: API contract compliance
exit_criteria:
  - /bmad-feature-verify passes (all features verified end-to-end)
  - /bmad-contract-verify passes (BE: all endpoints match api-spec.yaml)
target_state: FEATURE_ACCEPTED
```

**BE Feature Acceptance:**
```
1. All 4.4 stories CODE_ACCEPTED →
2. /bmad-feature-verify backend → fix issues
3. /bmad-contract-verify → verify all endpoints match api-spec.yaml
4. Transition all BE stories: CODE_ACCEPTED → FEATURE_ACCEPTED
5. Transition BE Track: BE_TRACK_COMPLETE
```

**FE Feature Acceptance:**
```
1. All 4.10 stories CODE_ACCEPTED →
2. /bmad-feature-verify frontend → fix issues
3. Transition all FE stories: CODE_ACCEPTED → FEATURE_ACCEPTED
```

### 3. UI ACCEPTANCE (Frontend Only)

Applied after FEATURE_ACCEPTED on the Frontend track.

```yaml
acceptance_tier: UI
applies_to: frontend track only
trigger: all FE stories FEATURE_ACCEPTED
skills:
  - /bmad-ui-verify        # visual design verification against wireframes
  - /bmad-a11y-verify      # accessibility audit (axe-core, WCAG 2.1 AA)
  - /bmad-perf-verify      # performance audit (Lighthouse, bundle size)
exit_criteria:
  - /bmad-ui-verify passes (UI matches design acceptance criteria from 2.10)
  - /bmad-a11y-verify passes (no critical/serious axe issues)
  - /bmad-perf-verify passes (Lighthouse perf >= 90, a11y >= 90, best practices >= 90, bundle < threshold)
target_state: UI_ACCEPTED
```

**UI Acceptance Flow:**
```
1. All FE stories FEATURE_ACCEPTED →
2. /bmad-ui-verify → compare against wireframes + design acceptance criteria
3. /bmad-a11y-verify → axe-core audit → fix critical/serious issues
4. /bmad-perf-verify → Lighthouse + bundle size → fix below-threshold issues
5. Transition all FE stories: FEATURE_ACCEPTED → UI_ACCEPTED
```

### 4. E2E BROWSER ACCEPTANCE (Frontend + Full-Stack)

Applied after UI_ACCEPTED on the Frontend track (separated mode) or after merged development (full-stack mode).

```yaml
acceptance_tier: E2E_BROWSER
applies_to: frontend track + full-stack
trigger: all FE stories UI_ACCEPTED (separated) or merged dev complete (full-stack)
skills:
  - /bmad-e2e-browser-test       # end-to-end browser automation tests
  - /bmad-visual-regression       # visual regression testing
  - /bmad-cross-browser-verify    # cross-browser compatibility
exit_criteria:
  - /bmad-e2e-browser-test passes (all critical paths)
  - /bmad-visual-regression passes (no unexpected visual diffs)
  - /bmad-cross-browser-verify passes (Chrome, Firefox, Safari)
target_state: E2E_BROWSER_ACCEPTED
```

**E2E Browser Acceptance Flow:**
```
1. All FE stories UI_ACCEPTED (separated) OR merged dev complete (full-stack) →
2. /bmad-e2e-browser-test → critical-path E2E scenarios → fix failures
3. /bmad-visual-regression → compare screenshots → fix regressions
4. /bmad-cross-browser-verify → test on Chrome, Firefox, Safari → fix issues
5. Transition: FE_TRACK_COMPLETE + E2E_BROWSER_ACCEPTED (separated)
   OR FULL_STACK_INTEGRATED (full-stack)
```

---

## Merge Queue with Dependency Ordering (V3.1)

After stories reach CODE_ACCEPTED (BE) or UI_ACCEPTED (FE), they are NOT immediately merged. Instead, they enter a dependency-ordered Merge Queue processed in Phase 4.13.

### Queue States

```
CODE_ACCEPTED/UI_ACCEPTED
  → enqueued in merge_queue
  → queued (all depends_on satisfied)
  OR waiting_dependency (some depends_on not yet merged)
  → merging (Phase 4.13 picks this item)
  → merged (integration checks passed)
  OR failed (integration checks failed, requires manual resolution)
```

### Queue Entry (Auto-Generated)

When a story reaches CODE_ACCEPTED (Phase 4.4) or UI_ACCEPTED (Phase 4.12), the auto-continue loop writes a merge queue entry:

```yaml
merge_queue:
  items:
    - queue_item_id: "QUEUE-{story_id_slug}"
      story_id: "{story_id}"
      unit_id: "{unit_id or null}"
      branch: "{feature_branch}"
      depends_on: ["{dep_story_ids}"]
      merge_order: {auto_incremented_by_10}
      integration_checks: ["{from customize.toml or story acceptance_checks}"]
      merge_status: "queued" | "waiting_dependency"
```

### Dependency-Aware Ordering

- `merge_order` is assigned automatically in increments of 10 (10, 20, 30...).
- Items with `depends_on` that are unmet are set to `waiting_dependency`.
- When a dependency is merged, all `waiting_dependency` items that depend on it are re-evaluated.
- Items with `merge_status: "queued"` are ready for merge in Phase 4.13.

### Integration Checks

Each queue item carries `integration_checks` — commands executed during merge:
- Default: from `customize.toml` `merge_queue.default_integration_checks` (`["npm run test", "npm run build"]`)
- Can be overridden per-story via story-level `acceptance_check`
- If ALL checks pass → `merge_status: "merged"`
- If ANY check fails → `merge_status: "failed"`, merge is aborted, downstream items remain blocked

### Viewing the Queue

Use the "View Merge Queue status" menu option or `show-queue` command:
```
═══════════════════════════════════════════
Merge Queue Status
═══════════════════════════════════════════
Order  Story ID      Status              Depends On
────── ────────────  ──────────────────  ──────────
10     S-3.1         ✅ merged           None
20     S-3.2         ✅ merged           S-3.1
30     S-4.1 (BE)    🔄 merging          S-3.2
30     S-4.1 (FE)    ⏳ queued           S-4.1 (BE)
40     S-2.1 (FE)    🔒 waiting_dep      S-4.1 (BE)
```

### Failed Merge Recovery

If a merge fails (integration check failure):
1. The item is marked `merge_status: "failed"` with `merge_failed_reason`
2. All items that depend on the failed item remain `waiting_dependency`
3. The user can retry: "retry merge {story_id}"
4. After fixing the issue, re-run integration checks and re-attempt merge

---

## Phase-Level FSM

### Separated Mode FSM

```
NOT_STARTED → IN_PROGRESS
  → BE_TRACK_COMPLETE
  → FE_TRACK_COMPLETE
  → MERGE_QUEUED (V3.1)
  → FULL_STACK_INTEGRATED
  → APPROVED
  → LOCKED
```

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Enter Phase 4 |
| `IN_PROGRESS` | 4.1 sprint planning complete | (track execution) | BE + FE parallel tracks |
| `IN_PROGRESS` | All 4.4 stories FEATURE_ACCEPTED | `BE_TRACK_COMPLETE` | BE track done |
| `IN_PROGRESS` | All 4.10 stories E2E_BROWSER_ACCEPTED | `FE_TRACK_COMPLETE` | FE track done |
| `BE_TRACK_COMPLETE` + `FE_TRACK_COMPLETE` | Both tracks complete | `FULL_STACK_INTEGRATED` | 4.13 integration passes |
| `FULL_STACK_INTEGRATED` | User approves | `APPROVED` | Implementation approved |
| `APPROVED` | Workflow completes | `LOCKED` | Read-only baseline |

### Full-Stack Mode FSM

```
NOT_STARTED → IN_PROGRESS → FULL_STACK_INTEGRATED → APPROVED → LOCKED
```

---

## Gate Card

```yaml
gate_card:
  phase: 4
  enters_from: 3
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
      source: "{architecture_output}/readiness-check.md"
      field: "frontmatter.all_gates_passed"
      operator: "eq"
      expected: true

    - id: "G4-08"
      description: "User confirms readiness to begin implementation"
      type: "user_confirmation"
  all_pass: false
```

**Gate Logic:** All Phase 3 artifacts must be locked, the development order must be frozen, and the readiness check must have passed. This ensures implementation starts from a stable, validated baseline.

If gate fails, display the specific failing checks and their resolution guidance. Abort and return to main menu.

**On gate pass:** Phase 3 auto-locks (if not already). Transition `NOT_STARTED` → `IN_PROGRESS`.

---

## Sub-Phase Routing Table

### Separated Mode — Full Route Table

| Sub-Phase | Reference File | Required | BMAD Skill / Acceptance | Description |
|-----------|---------------|----------|----------------------|-------------|
| 4.1 | `./references/sub-workflows/implementation/4-1-sprint-planning.md` | **Required** | `/bmad-sprint-planning` | Sprint setup, capacity planning, story assignment |
| ── | ── BACKEND TRACK ── | ── | ── | ── |
| 4.2 | `./references/sub-workflows/implementation/4-2-be-scaffolding.md` | **Required** | — | Backend project scaffolding, config, CI |
| 4.3 | `./references/sub-workflows/implementation/4-3-be-database.md` | **Required** | — | Database setup, migrations, seed data |
| 4.4 | `./references/sub-workflows/implementation/4-4-be-api-endpoints.md` | **Required (AUTO-CONTINUE)** | TDD + CODE ACCEPTANCE | Per-story API endpoint implementation |
| 4.5 | `./references/sub-workflows/implementation/4-5-be-testing-suite.md` | **Required** | — | Full backend test suite verification |
| 4.6 | `./references/sub-workflows/implementation/4-6-be-completion-review.md` | **Required** | `/bmad-code-review` | Backend completion review + handoff |
| ── | ── FRONTEND TRACK ── | ── | ── | ── |
| 4.7 | `./references/sub-workflows/implementation/4-7-fe-scaffolding.md` | **Required** | — | Frontend project scaffolding, routing, config |
| 4.8 | `./references/sub-workflows/implementation/4-8-fe-design-system.md` | **Required** | — | Base components, design tokens, layout |
| 4.9 | `./references/sub-workflows/implementation/4-9-fe-api-client.md` | **Required** | — | API client, state management, auth hooks |
| 4.10 | `./references/sub-workflows/implementation/4-10-fe-page-implementation.md` | **Required (AUTO-CONTINUE)** | TDD + CODE/FEATURE/UI/E2E ACCEPTANCE | Per-story page implementation with all four acceptance tiers |
| 4.11 | `./references/sub-workflows/implementation/4-11-fe-a11y-perf-audit.md` | **Required** | — | Accessibility + performance final audit |
| 4.12 | `./references/sub-workflows/implementation/4-12-fe-completion-review.md` | **Required** | `/bmad-code-review` | Frontend completion review + handoff |
| ── | ── INTEGRATION ── | ── | ── | ── |
| 4.13 | `./references/sub-workflows/implementation/4-13-integration.md` | **Required** | `/bmad-contract-verify` + `/bmad-e2e-verify` | Full-stack integration + E2E verification |
| 4.14 | `./references/sub-workflows/implementation/4-14-retrospective.md` | **Required** | `/bmad-retrospective` | Project retrospective + lessons learned |

### Full-Stack Mode — Route Table

| Sub-Phase | Reference File | Required | Description |
|-----------|---------------|----------|-------------|
| 4.1 | `./references/sub-workflows/implementation/4-1-sprint-planning.md` | **Required** | Sprint setup, capacity planning |
| Merged Dev | Skip 4.2─4.12 — run merged full-stack development | — | Per-story BE+FE tasks in single codebase |
| 4.13 | `./references/sub-workflows/implementation/4-13-integration.md` | **Required** | Full-stack integration + E2E |
| 4.14 | `./references/sub-workflows/implementation/4-14-retrospective.md` | **Required** | Project retrospective |

---

## Full Acceptance Flow Diagram

```
Phase 4.1 Sprint Planning
  │
  ├── Backend Track (4.2─4.6)
  │   ├── 4.2 BE Scaffolding
  │   ├── 4.3 BE Database
  │   ├── 4.4 BE API Endpoints (AUTO-CONTINUE)
  │   │     Per story loop:
  │   │       TDD → /bmad-code-review adversarial → CODE_ACCEPTED
  │   │     All stories CODE_ACCEPTED:
  │   │       /bmad-feature-verify backend → /bmad-contract-verify backend → FEATURE_ACCEPTED
  │   │       ┌─ BE_TRACK_COMPLETE (no UI/E2E tiers for BE)
  │   ├── 4.5 BE Testing Suite
  │   └── 4.6 BE Completion Review
  │
  └── Frontend Track (4.7─4.12) — parallel with BE
      ├── 4.7 FE Scaffolding
      ├── 4.8 FE Design System
      ├── 4.9 FE API Client
      ├── 4.10 FE Page Implementation (AUTO-CONTINUE)
      │     Per story loop:
      │       TDD → /bmad-code-review adversarial → CODE_ACCEPTED
      │     All stories CODE_ACCEPTED:
      │       /bmad-feature-verify frontend → FEATURE_ACCEPTED
      │     All FEATURE_ACCEPTED:
      │       /bmad-ui-verify + /bmad-a11y-verify + /bmad-perf-verify → UI_ACCEPTED
      │     All UI_ACCEPTED:
      │       /bmad-e2e-browser-test + /bmad-visual-regression + /bmad-cross-browser-verify → E2E_BROWSER_ACCEPTED
      │       ┌─ FE_TRACK_COMPLETE
      ├── 4.11 FE A11y & Perf Audit
      └── 4.12 FE Completion Review
  │
  └── 4.13 Integration & E2E (both tracks complete)
       └── /bmad-contract-verify + /bmad-e2e-verify + /bmad-e2e-browser-test (full-stack)
  │
  └── 4.14 Retrospective
```

---

## Parallel BE/FE Execution Model — Per-Story Worktree Isolation

In separated mode, **each story runs in its own git worktree** with its own branch. This eliminates all parallel write conflicts — no two agents ever write to the same file.

See `specs/worktree-isolation.md` for the full specification.

### Architecture

```
/workspace/                                          # Main worktree
├── main 分支
├── sprint-status.yaml                               # 聚合状态（story merge 时更新）
├── _bmad-output/web-dev-flow/stories/
│   ├── S-3.1-status.yaml                            # 每个 story 的状态（agent 在 worktree 中写）
│   └── S-3.2-status.yaml

.claude/worktrees/story/S-3.1-be/                    # Story S-3.1 worktree
├── story/S-3.1-be 分支
└── 该 story 的代码变更

.claude/worktrees/story/S-1.1-fe/                    # Story S-1.1 worktree（并行）
├── story/S-1.1-fe 分支
└── 该 story 的代码变更
```

### 写入隔离

每个字节只有一个写入者：

| 文件 | Main worktree | Story worktree |
|------|:---:|:---:|
| `sprint-status.yaml` | **写** (story merge 时) | 只读 |
| `stories/{id}-status.yaml` | 只读 | **写** |
| `src/` 该 story 的 scope | — | **写** |
| `src/` 其他 scope | 只读 | 只读 |

### Git 流程（Per Story）

```
Story Start:
  git worktree add -b story/{id}-{track} .claude/worktrees/story/{id}-{track} main
  Agent 在 worktree 中工作

Story CODE_ACCEPTED:
  git commit -m "{id}: {title} — CODE_ACCEPTED"
  cd /workspace  # 切回 main
  git merge story/{id}-{track} --no-ff
  git worktree remove .claude/worktrees/story/{id}-{track}
  git branch -d story/{id}-{track}
  更新 sprint-status.yaml

Phase 4.13 Integration:
  所有 story 已合并到 main
  git tag -a phase-4/complete -m "Phase 4 complete"
```

### Cross-Track Synchronization

FE story 依赖 BE story 时：

```
1. FE agent 启动前读取 sprint-status.yaml（main worktree）
2. 检查 depends_on 中的 BE story status 是否为 CODE_ACCEPTED
3. 未完成 → 标记 FE story BLOCKED_BY_DEPENDENCY
4. 等待 BE story merge 到 main 后，sprint-status.yaml 更新
5. 下次循环检测到依赖满足 → 创建 FE story worktree
```

No file is ever written by two agents. Story worktrees are physically isolated. sprint-status.yaml is only updated during story merge (sequential, in main worktree).

---

## Auto-Continue Behavior (4.4 and 4.10)

Sub-phases 4.4 (BE API Endpoints) and 4.10 (FE Page Implementation) use AUTO-CONTINUE mode.

### Auto-Continue Algorithm (Per-Story Worktree)

```
Load development_order from sprint-status.yaml
  → filter by track ("backend" for 4.4, "frontend" for 4.10)
  → sort by order ASC

FOR each story_entry:
  IF status == MERGED:
    skip (already complete — only MERGED = done)

  IF status == IN_PROGRESS:
    Resume scenario — read stories/{story_id}-status.yaml:
      - Read last_completed_substep → 精确定位中断点
      - cd .claude/worktrees/story/{story_id}-{track}  (worktree 还存在)
      - resume from next sub-step
    BREAK

  IF status == NOT_STARTED:
    Check cross-track dependencies in sprint-status.yaml:
      FOR each dep IN story_entry.depends_on:
        IF dep.status != MERGED:
          Mark story BLOCKED_BY_DEPENDENCY → skip → recheck next loop

    IF all deps MERGED (or no deps):
      # 创建 story worktree + 分支
      git worktree add -b story/{story_id}-{track} \
        .claude/worktrees/story/{story_id}-{track} main
      
      # 初始化 story 状态文件
      write stories/{story_id}-status.yaml with status: NOT_STARTED
      
      cd .claude/worktrees/story/{story_id}-{track}
      auto-select this story → Go to Step 4
      BREAK

  IF no story selected (all MERGED or all BLOCKED):
    exit auto-continue loop → present phase summary
```

### Story Ready Gate

```yaml
story_ready_gate:
  checks:
    - id: "SRG-01"
      description: "scope_write array is defined and non-empty"
      type: "field_exists"
      source: story_file
      field: "scope_write"

    - id: "SRG-02"
      description: "acceptance_check is defined"
      type: "field_exists"
      source: story_file
      field: "acceptance_check"

    - id: "SRG-03"
      description: "Story file exists at expected path"
      type: "artifact_exists"
      source: "{stories_output}/{story_id}.md"

    - id: "SRG-04"
      description: "scope_write paths are safe — relative, no traversal, within project"
      type: "custom_check"
      rule: "Each scope_write path must: (a) be relative (not absolute), (b) not contain '../' or '..\\' (no path traversal), (c) resolve within the project root directory, (d) not match any path in customize.toml scope_lock.forbidden_paths"
      severity: "blocking"

    - id: "SRG-05"
      description: "No conflicting IN_PROGRESS story with overlapping scope_write"
      type: "custom_check"
      rule: "For all other IN_PROGRESS stories, verify their scope_write does not overlap with this story's scope_write"
      severity: "blocking"
    - id: "SRG-06"
      description: "scope_write paths are within implementation_boundary"
      type: "scope_boundary"
      rule: "Each scope_write path must match at least one entry in implementation_boundary.{track}_scope or implementation_boundary.shared_scope"
      severity: "blocking"
    - id: "SRG-07"
      description: "scope_write path parent directories exist"
      type: "custom_check"
      rule: "Parent directory of each scope_write entry must exist in the project filesystem"
      severity: "blocking"

    - id: "SRG-09"
      description: "acceptance_check commands pass safety validation"
      type: "custom_check"
      rule: "Each acceptance_check command must: (a) start with an allowed prefix from customize.toml [acceptance_check_safety].allowed_prefixes, (b) not contain any forbidden_patterns (pipes, redirects, chaining, eval, curl, rm), (c) reference a script or binary that exists in the project. Commands failing safety are blocked."
      severity: "blocking"
      config_ref: "customize.toml → [acceptance_check_safety]"
```

### Implementation Flow Per Story

#### For 4.4 (BE API Endpoints):

```
▶ {story_id}: {story_title} — BACKEND
  scope_write: {paths}
  tasks.count: {N}

  1. TDD cycle:
     Write failing test → implement endpoint → pass test → refactor
     Progress: [BE 1/{N}] {task_description} ✓
     Progress: [BE 2/{N}] {task_description} ...

  2. Self-check: verify scope_write output

  3. Generate handoff docs:
     - {story_output_dir}/{story_id}/self-check.md
     - {story_output_dir}/{story_id}/handoff.md

  4. CODE ACCEPTANCE (Tier 1):
     /bmad-code-review adversarial → fix → re-review
     acceptance_check → all exit 0
     → Story: CODE_ACCEPTED

  ✓ {story_id}: {story_title} — CODE_ACCEPTED

  All BE stories CODE_ACCEPTED:
    → FEATURE ACCEPTANCE (Tier 2):
      /bmad-feature-verify backend
      /bmad-contract-verify backend
      → All BE stories: FEATURE_ACCEPTED
      → BE_TRACK_COMPLETE
```

#### For 4.10 (FE Page Implementation):

```
▶ {story_id}: {story_title} — FRONTEND
  scope_write: {paths}
  tasks.count: {N}

  1. TDD cycle:
     Write failing test → implement component → pass test → refactor
     Progress: [FE 1/{N}] {task_description} ✓
     Progress: [FE 2/{N}] {task_description} ...

  2. Self-check: verify scope_write output

  3. Generate handoff docs:
     - {story_output_dir}/{story_id}/self-check.md
     - {story_output_dir}/{story_id}/handoff.md

  4. CODE ACCEPTANCE (Tier 1):
     /bmad-code-review adversarial → fix → re-review
     acceptance_check → all exit 0
     → Story: CODE_ACCEPTED

  ✓ {story_id}: {story_title} — CODE_ACCEPTED

  All FE stories CODE_ACCEPTED:
    → FEATURE ACCEPTANCE (Tier 2):
      /bmad-feature-verify frontend
      → All FE stories: FEATURE_ACCEPTED

    → UI ACCEPTANCE (Tier 3):
      /bmad-ui-verify → /bmad-a11y-verify → /bmad-perf-verify
      → All FE stories: UI_ACCEPTED

    → E2E BROWSER ACCEPTANCE (Tier 4):
      /bmad-e2e-browser-test → /bmad-visual-regression → /bmad-cross-browser-verify
      → All FE stories: E2E_BROWSER_ACCEPTED
      → FE_TRACK_COMPLETE
```

### Error Halt Menu (Only on Failure)

Auto-continue halts only when an error is encountered:

```
✗ {story_id} — {failure_reason}

  Failed at: {acceptance_tier} acceptance
  Details: {error_details}

  [1] Retry from failure point
  [2] Skip story (note issues, requires CR to re-add)
  [3] Exit auto-continue — return to sub-phase menu
```

---

## Sub-Phase FSM Definitions

### Per-Story FSMs

**4.4 (BE API Endpoints) — Per-Story FSM:**
```
NOT_STARTED → IN_PROGRESS → IMPLEMENTED → CODE_ACCEPTED → FEATURE_ACCEPTED
NOT_STARTED → BLOCKED_BY_DEPENDENCY
```

**4.10 (FE Page Implementation) — Per-Story FSM:**
```
NOT_STARTED → IN_PROGRESS → IMPLEMENTED → CODE_ACCEPTED → FEATURE_ACCEPTED → UI_ACCEPTED → E2E_BROWSER_ACCEPTED
NOT_STARTED → BLOCKED_BY_DEPENDENCY
```

### Sub-Phase Level FSMs

**4.1 (Sprint Planning):**
```
NOT_STARTED → IN_PROGRESS → SPRINT_PLANNED → LOCKED
```

**4.2 (BE Scaffolding) / 4.7 (FE Scaffolding):**
```
NOT_STARTED → IN_PROGRESS → SCAFFOLDED → VERIFIED → LOCKED
```

**4.3 (BE Database):**
```
NOT_STARTED → IN_PROGRESS → MIGRATIONS_WRITTEN → MIGRATIONS_RUN → VERIFIED → LOCKED
```

**4.4 (BE API Endpoints):**
```
NOT_STARTED → IN_PROGRESS → ALL_STORIES_CODE_ACCEPTED → ALL_STORIES_FEATURE_ACCEPTED → BE_TRACK_COMPLETE → LOCKED
```

**4.5 (BE Testing Suite):**
```
NOT_STARTED → IN_PROGRESS → TESTS_WRITTEN → ALL_PASSING → COVERAGE_MET → LOCKED
```

**4.6 (BE Completion Review) / 4.12 (FE Completion Review):**
```
NOT_STARTED → IN_PROGRESS → REVIEWED → APPROVED → LOCKED
```

**4.8 (FE Design System):**
```
NOT_STARTED → IN_PROGRESS → COMPONENTS_BUILT → DOCUMENTED → REVIEWED → LOCKED
```

**4.9 (FE API Client):**
```
NOT_STARTED → IN_PROGRESS → CLIENT_GENERATED → MOCKS_READY → VERIFIED → LOCKED
```

**4.10 (FE Page Implementation):**
```
NOT_STARTED → IN_PROGRESS → ALL_STORIES_CODE_ACCEPTED → ALL_STORIES_FEATURE_ACCEPTED → ALL_STORIES_UI_ACCEPTED → ALL_STORIES_E2E_BROWSER_ACCEPTED → FE_TRACK_COMPLETE → LOCKED
```

**4.11 (FE A11y & Perf Audit):**
```
NOT_STARTED → IN_PROGRESS → A11Y_PASSED → PERF_PASSED → LOCKED
```

**4.13 (Integration):**
```
NOT_STARTED → IN_PROGRESS → CONTRACTS_VERIFIED → E2E_PASSED → INTEGRATED → LOCKED
```

**4.14 (Retrospective):**
```
NOT_STARTED → IN_PROGRESS → RETRO_COMPLETED → APPROVED → LOCKED
```

---

## Phase 4 Entry

### Step 1: Gate Card Check and Mode Detection

Evaluate all G4 checks. Record results to `{status_phase_04_be_file}` (gate check) and `{status_global_file}` (dev_mode, development_order).

If gate passes:
- Auto-lock Phase 3 if not already locked
- Read `global_state.dev_mode` from `{status_global_file}`
- Read `global_state.development_order` from `{status_global_file}`

Initialize phase state:

```yaml
phases:
  phase_4:
    status: "IN_PROGRESS"
    dev_mode: "{separated|full_stack}"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "IN_PROGRESS", at: "{ISO}" }
    gate_card:
      phase: 4
      checks:
        - {id: "G4-01", status: "pass"}
        - {id: "G4-02", status: "pass"}
        - {id: "G4-03", status: "pass"}
        - {id: "G4-04", status: "pass"}
        - {id: "G4-05", status: "pass"}
        - {id: "G4-06", status: "pass"}
        - {id: "G4-07", status: "pass"}
        - {id: "G4-08", status: "pass"}
      all_pass: true
    substates:
      phase_4_1:  { status: "NOT_STARTED" }
      phase_4_2:  { status: "NOT_STARTED" }
      phase_4_3:  { status: "NOT_STARTED" }
      phase_4_4:  { status: "NOT_STARTED", stories: [] }
      phase_4_5:  { status: "NOT_STARTED" }
      phase_4_6:  { status: "NOT_STARTED" }
      phase_4_7:  { status: "NOT_STARTED" }
      phase_4_8:  { status: "NOT_STARTED" }
      phase_4_9:  { status: "NOT_STARTED" }
      phase_4_10: { status: "NOT_STARTED", stories: [] }
      phase_4_11: { status: "NOT_STARTED" }
      phase_4_12: { status: "NOT_STARTED" }
      phase_4_13: { status: "NOT_STARTED" }
      phase_4_14: { status: "NOT_STARTED" }
    tracks:
      backend:  { status: "NOT_STARTED" }
      frontend: { status: "NOT_STARTED" }
```

---

### Step 2: Present Phase 4 Entry Menu

Based on `dev_mode`, present the appropriate menu.

#### Separated Mode Menu

```
Phase 4 — Implementation (Dual-Track)
═══════════════════════════════════════════
Dev Mode: SEPARATED (parallel BE + FE tracks)
Story Count: {N} total ({B} backend, {F} frontend)

Workflow:
  4.1 Sprint Planning → then parallel tracks:

  ── BACKEND TRACK ──
  4.2 BE Scaffolding        [{status}]
  4.3 BE Database           [{status}]
  4.4 BE API Endpoints      [{status}] AUTO-CONTINUE
  4.5 BE Testing Suite      [{status}]
  4.6 BE Completion Review  [{status}]

  ── FRONTEND TRACK ──
  4.7 FE Scaffolding        [{status}]
  4.8 FE Design System      [{status}]
  4.9 FE API Client         [{status}]
  4.10 FE Page Impl          [{status}] AUTO-CONTINUE
  4.11 FE A11y & Perf       [{status}]
  4.12 FE Completion Review [{status}]

  ── INTEGRATION ──
  4.13 Integration & E2E    [{status}] (requires both tracks)
  4.14 Retrospective        [{status}]

Available Actions:
  [1] Start 4.1 — Sprint Planning (/bmad-sprint-planning)
  ── Backend Track (after 4.1) ──
  [B2] Start 4.2 — BE Scaffolding
  [B3] Start 4.3 — BE Database
  [B4] Start 4.4 — BE API Endpoints (auto-continue)
  [B5] Start 4.5 — BE Testing Suite
  [B6] Start 4.6 — BE Completion Review
  ── Frontend Track (after 4.1, can run parallel with BE) ──
  [F7] Start 4.7 — FE Scaffolding
  [F8] Start 4.8 — FE Design System
  [F9] Start 4.9 — FE API Client
  [F10] Start 4.10 — FE Page Implementation (auto-continue)
  [F11] Start 4.11 — FE A11y & Perf Audit
  [F12] Start 4.12 — FE Completion Review
  ── Integration ──
  [I13] Start 4.13 — Integration & E2E
  [I14] Start 4.14 — Retrospective
  [P] View parallel execution guide
  [S] View sub-phase status
  [Q] Return to main menu
```

#### Full-Stack Mode Menu

```
Phase 4 — Implementation (Full-Stack)
═══════════════════════════════════════════
Dev Mode: FULL_STACK (merged single-codebase development)
Story Count: {N} total (all full-stack)

Workflow:
  4.1 Sprint Planning
  → Merged Full-Stack Development (skip 4.2─4.12)
  → 4.13 Integration & E2E
  → 4.14 Retrospective

Available Actions:
  [1] Start 4.1 — Sprint Planning (/bmad-sprint-planning)
  [M] Start Merged Full-Stack Development (AUTO-CONTINUE)
  [I13] Start 4.13 — Integration & E2E
  [I14] Start 4.14 — Retrospective
  [S] View sub-phase status
  [Q] Return to main menu
```

**Selection Rules:**
- 4.1 (Sprint Planning) must be LOCKED before any track sub-phase can start
- Backend track sub-phases (B2─B6) are sequential within the track
- Frontend track sub-phases (F7─F12) are sequential within the track
- BE and FE tracks can run in parallel — independent sessions
- Each sub-phase has its own gate (e.g., 4.3 gate: 4.2 LOCKED)
- 4.4 and 4.10 are AUTO-CONTINUE — no manual story selection during normal flow
- 4.13 requires both BE_TRACK_COMPLETE and FE_TRACK_COMPLETE (separated) or merged dev complete (full-stack)
- 4.14 requires 4.13 LOCKED
- Show track completion status

**Parallel Execution Guide (Separated Mode):**
```
Parallel BE/FE Execution:
  - Open a separate session for the other track
  - Both sessions share sprint-status.yaml
  - BE writes API endpoints → FE reads for API client
  - Cross-track dependencies auto-detected in 4.10 auto-continue
  - Both tracks must complete before 4.13 Integration
```

---

### Step 3: Route to Selected Sub-Phase

When the user selects a sub-phase:

1. **Verify sub-phase gate.** Each sub-phase has its own gate in the sub-workflow file:
   - 4.2 gate: 4.1 LOCKED
   - 4.3 gate: 4.2 LOCKED
   - 4.4 gate: 4.3 LOCKED — AUTO-CONTINUE
   - 4.5 gate: all 4.4 stories FEATURE_ACCEPTED
   - 4.6 gate: 4.5 LOCKED
   - 4.7 gate: 4.1 LOCKED
   - 4.8 gate: 4.7 LOCKED
   - 4.9 gate: 4.8 LOCKED (can run parallel with 4.8 if both unlocked)
   - 4.10 gate: 4.9 LOCKED — AUTO-CONTINUE
   - 4.11 gate: all 4.10 stories E2E_BROWSER_ACCEPTED
   - 4.12 gate: 4.11 LOCKED
   - 4.13 gate: BE_TRACK_COMPLETE AND FE_TRACK_COMPLETE (separated) OR merged dev complete (full-stack)
   - 4.14 gate: 4.13 LOCKED

2. **Load the sub-workflow file** from the reference path
3. **Read the entire file** before taking any action
4. **For 4.4 and 4.10:** Initialize the auto-continue loop (see Auto-Continue section above)
5. **For 4.13:** Invoke `/bmad-contract-verify` and `/bmad-e2e-verify` + `/bmad-e2e-browser-test` (full-stack)
6. **For 4.14:** Invoke `/bmad-retrospective`
7. **Follow the sub-workflow's instructions** exactly as written
8. **After completion**, write to `{status_phase_04_be_file}` or `{status_phase_04_fe_file}`, and return to the Phase 4 menu

**CRITICAL:** Do not load more than one sub-workflow file at a time. Only the selected sub-phase file is read and executed.

**For Full-Stack Mode:** When user selects `[M] Merged Full-Stack Development`:
- Skip sub-workflow files 4.2─4.12
- Run merged full-stack development following the same auto-continue algorithm
- Each story has both `tasks.backend` and `tasks.frontend` — implement BE tasks first, then FE tasks
- Apply all four acceptance tiers after all stories complete
- Transition directly to 4.13

---

### Step 4: Track-Level Completion

#### Backend Track Completion

When 4.4─4.6 are all LOCKED (or equivalent completion states):

```yaml
tracks:
  backend:
    status: "BE_TRACK_COMPLETE"
    completed_at: "{ISO_TIMESTAMP}"
```

Display:
```
═══════════════════════════════════════════
BACKEND TRACK COMPLETE
═══════════════════════════════════════════
  Stories: {N} implemented
  Acceptance: FEATURE_ACCEPTED
  API Contract: /bmad-contract-verify passed
  Tests: {N} unit, {M} integration, coverage {C}%
  Waiting for: Frontend track to complete
```

#### Frontend Track Completion

When 4.7─4.12 are all LOCKED:

```yaml
tracks:
  frontend:
    status: "FE_TRACK_COMPLETE"
    completed_at: "{ISO_TIMESTAMP}"
```

Display:
```
═══════════════════════════════════════════
FRONTEND TRACK COMPLETE
═══════════════════════════════════════════
  Stories: {N} implemented
  Acceptance: E2E_BROWSER_ACCEPTED
  Tiers passed:
    ✓ CODE ACCEPTANCE (per story)
    ✓ FEATURE ACCEPTANCE (track-level)
    ✓ UI ACCEPTANCE (design + a11y + perf)
    ✓ E2E BROWSER ACCEPTANCE (browser + visual + cross-browser)
  Waiting for: Backend track to complete
```

---

### Step 5: Phase-Level Completion

When both tracks are complete (separated) or merged dev is complete (full-stack), and 4.13 Integration passes:

**Transition:** `BE_TRACK_COMPLETE` + `FE_TRACK_COMPLETE` → `FULL_STACK_INTEGRATED` (separated)
or `IN_PROGRESS` → `FULL_STACK_INTEGRATED` (full-stack)

Display integration summary:

```
═══════════════════════════════════════════
Phase 4 — FULL_STACK_INTEGRATED
═══════════════════════════════════════════

── Backend ──
  Stories: {B} implemented, all FEATURE_ACCEPTED
  API: {E} endpoints verified against contract
  Tests: {C}% coverage, all passing

── Frontend ──
  Stories: {F} implemented, all E2E_BROWSER_ACCEPTED
  Acceptance:
    ✓ CODE: all stories
    ✓ FEATURE: track-level verified
    ✓ UI: design match + a11y (WCAG AA) + perf (Lighthouse >= 90)
    ✓ E2E BROWSER: critical paths + visual regression + cross-browser

── Integration ──
  ✓ Contract verification: all endpoints match api-spec.yaml
  ✓ E2E tests: {N} scenarios passed
  ✓ Browser tests: Chrome ✓, Firefox ✓, Safari ✓

── Retrospective ──
  {status}

Available Actions:
  [1] Approve Phase 4 — Transition to APPROVED
  [2] Review specific track/sub-phase findings
  [S] View full sprint status
```

---

## Step 6: Phase 4 Approval

When the user is ready to approve Phase 4:

> "Implementation is complete. {B} backend stories and {F} frontend stories implemented with four-tier acceptance verification. Integration verified. Retrospective complete."
>
> "Do you approve Phase 4 — Implementation?"
>
> "[Y] Approve and lock  [N] Continue revising"

On approval:
- Transition Phase 4: `FULL_STACK_INTEGRATED` → `APPROVED`
- All implementation artifacts are final

---

## Step 7: Phase Complete Record

Write to `{status_phase_04_be_file}` (BE) or `{status_phase_04_fe_file}` (FE) when Phase 4 reaches LOCKED:

```yaml
phases:
  phase_4:
    status: "LOCKED"
    dev_mode: "{separated|full_stack}"
    state_history:
      - { state: "NOT_STARTED", at: "{ISO}" }
      - { state: "IN_PROGRESS", at: "{ISO}" }
      - { state: "BE_TRACK_COMPLETE", at: "{ISO}" }      # separated only
      - { state: "FE_TRACK_COMPLETE", at: "{ISO}" }      # separated only
      - { state: "FULL_STACK_INTEGRATED", at: "{ISO}" }
      - { state: "APPROVED", at: "{ISO}" }
      - { state: "LOCKED", at: "{ISO}" }
    tracks:
      backend:
        status: "BE_TRACK_COMPLETE"
      frontend:
        status: "FE_TRACK_COMPLETE"
    artifacts:
      - { type: "sprint_plan", path: "{sprint_plan_output}", status: "locked" }
      - { type: "backend_dev_log", path: "{backend_dev_log_output}", status: "locked" }
      - { type: "frontend_dev_log", path: "{frontend_dev_log_output}", status: "locked" }
      - { type: "integration_report", path: "{integration_output}", status: "locked" }
      - { type: "retrospective", path: "{retrospective_output}", status: "locked" }
    gate_card:
      all_pass: true
    substates:
      phase_4_1:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "SPRINT_PLANNED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "sprint_plan", path: "{sprint_plan_output}", status: "locked" }
        gate_card:
          all_pass: true

      # Backend track
      phase_4_2:
        status: "LOCKED"
        artifacts:
          - { type: "be_scaffold_report", path: "{backend_scaffold_report_output}", status: "locked" }
      phase_4_3:
        status: "LOCKED"
        artifacts:
          - { type: "be_migration_report", path: "{backend_migration_report_output}", status: "locked" }
      phase_4_4:
        status: "LOCKED"
        stories:
          - id: "S-001"
            status: "FEATURE_ACCEPTED"
            acceptance_tiers: ["CODE_ACCEPTED", "FEATURE_ACCEPTED"]
          # ... per-story records
        artifacts:
          - { type: "be_dev_log", path: "{backend_dev_log_output}", status: "locked" }
      phase_4_5:
        status: "LOCKED"
        artifacts:
          - { type: "be_test_report", path: "{backend_test_report_output}", status: "locked" }
      phase_4_6:
        status: "LOCKED"
        artifacts:
          - { type: "be_completion_review", path: "{backend_completion_review_output}", status: "locked" }

      # Frontend track
      phase_4_7:
        status: "LOCKED"
        artifacts:
          - { type: "fe_scaffold_report", path: "{frontend_scaffold_report_output}", status: "locked" }
      phase_4_8:
        status: "LOCKED"
        artifacts:
          - { type: "fe_design_system_report", path: "{design_system_report_output}", status: "locked" }
      phase_4_9:
        status: "LOCKED"
        artifacts:
          - { type: "fe_api_client_report", path: "{api_client_report_output}", status: "locked" }
      phase_4_10:
        status: "LOCKED"
        stories:
          - id: "S-002"
            status: "E2E_BROWSER_ACCEPTED"
            acceptance_tiers: ["CODE_ACCEPTED", "FEATURE_ACCEPTED", "UI_ACCEPTED", "E2E_BROWSER_ACCEPTED"]
          # ... per-story records
        artifacts:
          - { type: "fe_dev_log", path: "{frontend_dev_log_output}", status: "locked" }
      phase_4_11:
        status: "LOCKED"
        artifacts:
          - { type: "fe_audit_report", path: "{frontend_audit_report_output}", status: "locked" }
      phase_4_12:
        status: "LOCKED"
        artifacts:
          - { type: "fe_completion_review", path: "{frontend_completion_review_output}", status: "locked" }

      # Integration
      phase_4_13:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "CONTRACTS_VERIFIED", at: "{ISO}" }
          - { state: "E2E_PASSED", at: "{ISO}" }
          - { state: "INTEGRATED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "integration_report", path: "{integration_output}", status: "locked" }
        gate_card:
          all_pass: true

      phase_4_14:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "RETRO_COMPLETED", at: "{ISO}" }
          - { state: "APPROVED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "retrospective", path: "{retrospective_output}", status: "locked" }
        gate_card:
          all_pass: true
```

---

## Full-Stack Mode Routing Detail

When `dev_mode == "full_stack"`, the orchestrator skips sub-phases 4.2─4.12 entirely.

### Merged Development Flow

After 4.1 (Sprint Planning) is LOCKED:

```
  4.1 LOCKED
    → [M] Merged Full-Stack Development
      │
      ├── Step 1: Project Scaffolding (merged BE+FE)
      │   - Create project with framework CLI (create-next-app, etc.)
      │   - Configure TypeScript, ESLint, Prettier
      │   - Set up project structure per architecture.md
      │   - Run DB migrations
      │   - Verify dev server starts
      │
      ├── Step 2: Design System & API Client (merged)
      │   - Build base components (Button, Input, Modal, etc.)
      │   - Generate typed API client from api-spec.yaml
      │   - Set up mock server for tests
      │   - Create auth provider/guard
      │
      ├── Step 3: Story Implementation (AUTO-CONTINUE)
      │   FOR each story in development_order (track: "full-stack"):
      │     1. Implement backend tasks (API routes, services, DB queries)
      │     2. Implement frontend tasks (pages, components, API hooks)
      │     3. Write tests (BE + FE)
      │     4. CODE ACCEPTANCE: /bmad-code-review adversarial
      │     5. Generate handoff docs
      │     6. Auto-advance to next story
      │
      ├── Step 4: Testing & Audit
      │   - Run full test suite
      │   - Run accessibility audit
      │   - Run performance audit
      │   - Verify quality gates
      │
      └── Step 5: Completion Review
          - Code review all modified files
          - Verify all endpoints match api-spec.yaml
          - Security audit
    │
    → Merged Development Complete → FULL_STACK_INTEGRATED
```

### Full-Stack Acceptance Flow

After all merged stories are implemented:

```
All full-stack stories CODE_ACCEPTED:
  → /bmad-feature-verify full-stack → FEATURE_ACCEPTED
  → /bmad-ui-verify + /bmad-a11y-verify + /bmad-perf-verify → UI_ACCEPTED
  → /bmad-e2e-browser-test + /bmad-visual-regression + /bmad-cross-browser-verify → E2E_BROWSER_ACCEPTED
  → FULL_STACK_INTEGRATED
```

---

## Sprint-Status Update Instructions for Phase 4

Throughout Phase 4, status/ files are updated after every state transition. Key update points:

### After 4.1 Sprint Planning

Write to `{status_phase_04_be_file}` and `{status_phase_04_fe_file}`:

```yaml
phases:
  phase_4:
    substates:
      phase_4_1:
        status: "LOCKED"
      phase_4_2: { status: "NOT_STARTED" }
      # ... all substates initialized
    tracks:
      backend: { status: "NOT_STARTED" }
      frontend: { status: "NOT_STARTED" }
```

### During 4.4 / 4.10 Auto-Continue

Update after each story state change in `{status_phase_04_be_file}` or `{status_phase_04_fe_file}`:

```yaml
phase_4_4:
  status: "IN_PROGRESS"
  stories:
    - id: "S-001"
      title: "User Registration API"
      track: "backend"
      order: 1
      status: "CODE_ACCEPTED"
      state_history:
        - { state: "NOT_STARTED", at: "{ISO}" }
        - { state: "IN_PROGRESS", at: "{ISO}" }
        - { state: "IMPLEMENTED", at: "{ISO}" }
        - { state: "CODE_ACCEPTED", at: "{ISO}" }
      acceptance_tiers: ["CODE_ACCEPTED"]
      handoff:
        self_check: "{story_output_dir}/S-001/self-check.md"
        handoff: "{story_output_dir}/S-001/handoff.md"
    - id: "S-003"
      title: "Dashboard API"
      track: "backend"
      order: 3
      status: "IN_PROGRESS"
      state_history:
        - { state: "NOT_STARTED", at: "{ISO}" }
        - { state: "IN_PROGRESS", at: "{ISO}" }
    - id: "S-005"
      title: "Notifications API"
      track: "backend"
      order: 5
      status: "NOT_STARTED"
```

### After Acceptance Tier Transitions

```yaml
# After FEATURE ACCEPTANCE on BE stories:
phase_4_4:
  stories:
    - id: "S-001"
      status: "FEATURE_ACCEPTED"
      acceptance_tiers: ["CODE_ACCEPTED", "FEATURE_ACCEPTED"]

# After all acceptance tiers on FE stories:
phase_4_10:
  stories:
    - id: "S-002"
      status: "E2E_BROWSER_ACCEPTED"
      acceptance_tiers: ["CODE_ACCEPTED", "FEATURE_ACCEPTED", "UI_ACCEPTED", "E2E_BROWSER_ACCEPTED"]
```

### After Track Completion

```yaml
tracks:
  backend:
    status: "BE_TRACK_COMPLETE"
    completed_at: "{ISO_TIMESTAMP}"
  frontend:
    status: "FE_TRACK_COMPLETE"
    completed_at: "{ISO_TIMESTAMP}"
```

---

## Completion Summary

When Phase 4 is locked, present:

> "Phase 4 complete — Implementation delivered."
>
> "**Dev Mode:** {separated|full_stack}"
>
> "**Backend:** {B} stories implemented, {E} API endpoints, {C}% test coverage, FEATURE_ACCEPTED"
>
> "**Frontend:** {F} stories implemented, four-tier acceptance passed:"
> "  - CODE ACCEPTANCE: {F} stories reviewed"
> "  - FEATURE ACCEPTANCE: frontend features verified"
> "  - UI ACCEPTANCE: design match, WCAG 2.1 AA, Lighthouse >= 90"
> "  - E2E BROWSER ACCEPTANCE: critical paths, visual regression, cross-browser"
>
> "**Integration:** Contracts verified ({E} endpoints), {N} E2E scenarios passed"
>
> "**Retrospective:** Lessons captured, action items logged"
>
> "**Artifacts:** [list of all implementation artifacts with paths]"
>
> "Implementation complete. All quality gates passed. Project ready for deployment."
>
> "Thank you for using web-dev-flow V3.0."

Return to the main workflow menu.
