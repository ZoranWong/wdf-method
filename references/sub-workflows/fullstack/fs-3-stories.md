---
sub_workflow: "fullstack-3"
phase: 4
sub_phase: "fs-3"
version: "3.6.0"
title: "Full-Stack Story Implementation (AUTO-CONTINUE)"
description: "Implement stories in development order using TDD. Each story covers both BE and FE tasks within the unified codebase. Auto-continues through all stories with CODE ACCEPTANCE after each."
dependencies:
  - sprint-status.yaml (development_order)
  - story files (stories/*.md)
  - api-spec.yaml
mode: "full_stack"
bmad_skill: "/bmad-dev-story"
iterate: true
auto_continue: true

# V3.6 Parity Mapping — these separated-mode features apply equally to full-stack
v36_parity:
  story_ready_gate: "SRG-01 through SRG-09 (see phase-04-implementation.md Story Ready Gate)"
  path_safety: "SRG-04 — scope_write path validation (relative, no traversal, not forbidden)"
  command_safety: "SRG-09 — acceptance_check command allowlisting (see customize.toml [acceptance_check_safety])"
  protected_paths: "SRG-08 — scope_write ∩ protected_paths → serial_only execution"
  atomic_merge: "specs/worktree-isolation.md § Story Merge — --no-commit → checks → commit|abort"
  hidden_dependency: "specs/merge-queue.md § Hidden Dependency Detection — pre-merge cross-branch diff analysis"
  sub_step_recovery: "specs/step-audit.md § Sub-Step ID Mapping — last_completed_substep tracks FS-3a through FS-3j"
  command_sanitization: "FSG-03 validates acceptance_check commands against customize.toml allowlist"
  path_safety: "FSG-01 — scope_write path validation (relative, no traversal, not forbidden)"
  protected_paths: "FSG-02 — scope_write ∩ protected_paths → serial_only execution"
  scope_exit_verification: "4f — git diff vs scope_write with directory boundary matching"
  handoff_minimum_gate: "4g — self-check.md (Commands run + Results), handoff.md (Summary + Files changed)"
  atomic_merge: "4h — git merge --no-commit --no-ff → integration checks → commit|abort"
  checkpoint_commits: "Minimum 3: feat → test → accept per specs/git-commit-checkpoints.md"
  hidden_dependency: "specs/merge-queue.md § Hidden Dependency Detection — pre-merge cross-branch diff analysis"
  fallback_mode: "If /bmad-dev-story unavailable, dispatch inline sub-agent per customize.toml [bmad_skill_fallbacks.bmad_dev_story]"
  sub_step_mapping: "See § Sub-Step ID Mapping below for full full-stack step IDs"
---

# Full-Stack 3 — Story Implementation

**Sub-Phase Goal:** Implement all full-stack stories automatically in development order. Each story spans BE (API routes, services, DB queries) and FE (pages, components, API client calls) within the unified codebase. TDD per story with CODE ACCEPTANCE after each.

**Gate:** Full-Stack 2 status must be LOCKED. Development order must be frozen.

**AUTO-CONTINUE:** The agent auto-selects and auto-advances stories without user menus. Halts only on: (a) story failure, (b) all stories approved, (c) blocked by dependency.

## Full-Stack Sub-Step ID Mapping (V3.6)

Each full-stack story follows this sequence. `last_completed_substep` enables precise session recovery.

| Sub-Step | Step ID | Description | Parity Ref |
|----------|---------|-------------|-----------|
| Story Ready Gate | FS-3a | SRG-01 through SRG-09 checks | BE 4a / FE 4a |
| Read Story + Mark IN_PROGRESS | FS-3b | Load story file, set status | BE 4b / FE 4b |
| Contract Gate (API stories) | FS-3b2 | Field-level api-spec alignment verification | BE 4b2 |
| Implement BE Tasks | FS-3c-be | API routes, services, DB queries | BE 4c |
| Implement FE Tasks | FS-3c-fe | Pages, components, API hooks | FE 4c |
| Write BE Tests | FS-3d-be | Unit + integration tests for BE | BE 4d |
| Write FE Tests | FS-3d-fe | Component + integration tests for FE | FE 4e+4f |
| Accessibility Audit | FS-3e | a11y check for implemented pages | FE 4d |
| Spec Validation | FS-3f | Verify implementation against api-spec | BE 4e |
| Generate Handoff Docs | FS-3g | self-check.md + handoff.md | BE 4f / FE 4h |
| Scope Exit Verification | FS-3g2 | git diff vs scope_write, directory boundary match | BE 4f2 / FE 4h2 |
| Run Acceptance Checks | FS-3h | Execute story-defined acceptance_check commands | BE 4g / FE 4i |
| CODE ACCEPTANCE | FS-3i | CA-01 through CA-05: review, coverage, type-check, lint, scope audit | BE 4h / FE 4j |
| Mark CODE_ACCEPTED | FS-3j | Update per-story status, enqueue merge item | BE 4j / FE 4k |

**Recovery example:** `last_completed_substep: "FS-3e"` → Resume from FS-3f (Spec Validation).
`last_completed_substep: "FS-3c-be"` → Resume from FS-3c-fe (FE implementation follows BE).

## FSM State Transition Table (Per Story)

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Story Ready Gate passes | `IN_PROGRESS` | Development begins |
| `IN_PROGRESS` | BE + FE implemented | `IMPLEMENTED` | Code complete |
| `IMPLEMENTED` | Unit + integration tests pass | `TESTED` | Tests passing |
| `TESTED` | Validated against api-spec + design | `SPEC_COMPLIANT` | Matches contracts |
| `SPEC_COMPLIANT` | CODE ACCEPTANCE passes | `CODE_ACCEPTED` | Story accepted |
| `CODE_ACCEPTED` | Handoff docs generated | `APPROVED` | Story done |
| `NOT_STARTED` | Cross-story dependency not met | `BLOCKED_BY_DEPENDENCY` | Skip, recheck later |

## Story Ready Gate

```yaml
story_ready_gate:
  checks:
    - id: "SRG-01"
      description: "Story is not BLOCKED_BY_DEPENDENCY"
      type: "dependency_status"
      expected: "status != BLOCKED_BY_DEPENDENCY"
      severity: "blocking"
    - id: "SRG-02"
      description: "scope_write is defined"
      type: "field_check"
      field: "development_order[story_id].scope_write"
      operator: "not_empty"
      severity: "blocking"
    - id: "SRG-03"
      description: "acceptance_check is defined"
      type: "field_check"
      field: "development_order[story_id].acceptance_check"
      operator: "not_empty"
      severity: "blocking"
    - id: "SRG-04"
      description: "Story file exists"
      type: "artifact_exists"
      source: "{stories_output}/story-{N}-{slug}.md"
      severity: "blocking"
    - id: "SRG-05"
      description: "No conflicting IN_PROGRESS story with overlapping scope_write"
      type: "custom_check"
      rule: "For all other IN_PROGRESS stories, verify their scope_write does not overlap with this story's scope_write"
      severity: "blocking"
    - id: "SRG-06"
      description: "scope_write paths are within implementation_boundary"
      type: "scope_boundary"
      rule: "Each scope_write path must match at least one entry in implementation_boundary.shared_scope or track-specific scope"
      severity: "blocking"
    - id: "SRG-07"
      description: "scope_write path parent directories exist"
      type: "custom_check"
      rule: "Parent directory of each scope_write entry must exist in the project filesystem"
      severity: "blocking"
    # V3.6 full-stack safety gates (equivalent to separated SRG-04, SRG-08, SRG-09)
    - id: "FSG-01"
      description: "scope_write paths are safe — relative, no traversal, not in forbidden_paths"
      type: "custom_check"
      rule: "Each path must be relative, not contain '../', not match customize.toml [scope_lock].forbidden_paths"
      severity: "blocking"
    - id: "FSG-02"
      description: "scope_write does not intersect protected_paths (or story is serial_only)"
      type: "custom_check"
      rule: "If scope_write ∩ customize.toml protected_paths → mark serial_only, ensure no other protected-path story running"
      severity: "blocking"
    - id: "FSG-03"
      description: "acceptance_check commands pass safety validation"
      type: "custom_check"
      rule: "Commands must start with allowed_prefix, not contain forbidden_patterns (pipes, redirects, chaining, curl, rm, chmod)"
      severity: "blocking"
      config_ref: "customize.toml → [acceptance_check_safety]"
  all_pass: false
```

---

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "fs-3"
  enters_from: "fs-2"
  checks:
    - id: "GFS3-01"
      description: "Full-Stack 2 status is LOCKED"
      type: "dependency_status"
      field: "phases.phase_4.substates.phase_fs_2.status"
      operator: "eq"
      expected: "LOCKED"
    - id: "GFS3-02"
      description: "Development order is frozen"
      type: "artifact_metadata"
      source: "{sprint_tracking}"
      field: "global_state.development_order_frozen_at"
      operator: "neq"
      expected: null
  all_pass: false
```

---

## Step 0: Load Sprint Status

Read `{sprint_tracking}`:
- `global_state.development_order` — stories filtered by `track: "full-stack"`
- `phases.phase_4.substates.phase_fs_3` — existing story statuses

## Step 1: Gate Check

Evaluate GFS3 checks. Abort if any fail.

## Step 2: Load Story Context

Read all story files from `{stories_output}/` with `track: "full-stack"`.

## Step 3: AUTO-CONTINUE Story Selection

```
FOR each story_entry IN development_order (sorted by order ASC):
  WHERE story_entry.track == "full-stack":

  1. IF status is APPROVED → skip
  2. IF status is IN_PROGRESS → auto-select (resume)
  3. IF status is NOT_STARTED:
     Check dependencies. IF all deps APPROVED → auto-select
     ELSE → mark BLOCKED_BY_DEPENDENCY, skip
  4. IF status is BLOCKED_BY_DEPENDENCY:
     Re-check deps. IF now resolved → auto-select
     ELSE → skip

END FOR
```

If no story selected → go to Step 6 (Phase Summary).

## Step 4: Per-Story Development Loop (Auto-Execute)

For each auto-selected story, execute TDD in order. **Do NOT pause between sub-steps.**

### 4a. Story Ready Gate Check

Verify scope_write, acceptance_check, story file exists, no parallel scope overlap, scope within implementation_boundary, and paths exist. Display:
```
▶ {story_id}: {story_title} — SCOPE LOCKED
  scope_write: {paths}
  acceptance_check: {commands}
  boundary: within implementation_boundary ✓
```

### 4b. Read Story + Mark IN_PROGRESS

Extract acceptance criteria, technical notes, tasks. Update sprint status.

### 4c. TDD: RED — Write Failing Tests

Write tests for both BE and FE parts of the story:
- **API route tests**: request/response validation, auth, business logic
- **Component tests**: rendering, user interaction, state changes
- **Integration tests**: full user flow through the feature

Run tests → confirm they FAIL (RED).

### 4d. TDD: GREEN — Implement

1. **API routes** (`src/server/routes/`): endpoints per api-spec.yaml
2. **Services** (`src/server/services/`): business logic, DB operations
3. **Validators** (`src/server/validators/`): request schema validation
4. **Pages** (`src/app/` or `src/pages/`): UI with loading/empty/error/success states
5. **Components** (`src/components/`): reusable UI components
6. **API client calls** (`src/lib/api/`): typed fetch functions

Run tests → confirm they PASS (GREEN).

Update status → `IMPLEMENTED` → `TESTED`.

### 4e. TDD: REFACTOR

Clean up code: extract helpers, remove duplication, improve naming. Tests must stay GREEN.

### 4f. Validate Against Specs + Scope Exit Verification (V3.6)

- API routes match api-spec.yaml (method, path, request/response schemas, status codes)
- UI matches wireframes/design-tokens (from Phase 2)
- Error handling covers all edge cases
- **Scope Exit Verification:** `git diff --name-only HEAD` → verify all changed files ⊆ scope_write (directory boundary matching: `[[ $f = "$p" || $f = "$p"/* ]]`)
- **Violations:** 3 options → [Revert] git checkout violating files | [Expand] file Scope Expansion CR | [Exit] save state

Update status → `SPEC_COMPLIANT`.

### 4g. Generate Handoff + Handoff Minimum Gate (V3.6)

Create `_story-output/{story_id}/self-check.md` and `_story-output/{story_id}/handoff.md`.

**Handoff Minimum Gate:**
- `self-check.md` MUST contain non-empty "Commands run" and "Results" sections
- `handoff.md` MUST contain non-empty "Summary" and "Files changed" sections
- Missing content → SUBMITTED state blocked; fix before continuing

### 4h. CODE ACCEPTANCE (V3.6 CA-01 ~ CA-05)

Execute adversarial code review via `/bmad-code-review` (or native agent `references/agents/code-reviewer.md`):

```yaml
code_acceptance:
  checks:
    - id: "CA-01"
      check: "Adversarial code review — security, correctness, readability, test quality"
      fallback: "references/agents/code-reviewer.md"
    - id: "CA-02"
      check: "Test coverage >= 80% (from customize.toml [acceptance_gates])"
    - id: "CA-03"
      check: "Type check passes (tsc --noEmit or equivalent)"
    - id: "CA-04"
      check: "Lint passes (zero errors)"
    - id: "CA-05"
      check: "Scope audit — git diff scope-freeze/pre-implementation..HEAD, 0 violations"
```

Run story `acceptance_check` commands. All must exit 0.

**Atomic merge protocol (V3.6):**
1. `git merge --no-commit --no-ff story/{id}-{track}` 
2. Run integration checks: `npm run test && npm run build && npm run type-check`
3. All pass → `git commit -m "Merge {story_id}: {title} — MERGED"`
4. Any fail → `git merge --abort`, mark item failed

**Checkpoint commits (minimum 3 per story):**
```
1. feat({story_id}): {title} — IMPLEMENTED
2. test({story_id}): {title} — TESTED  
3. accept({story_id}): {title} — CODE_ACCEPTED
```

Update status → `CODE_ACCEPTED`. Enqueue merge item. Loop back to Step 3.

### 4h2. Scope Exit Verification

Before proceeding, verify all file modifications are within the story's `scope_write`:

```bash
CHANGED_FILES=$(git diff --name-only HEAD)
SCOPE_VIOLATIONS=()
for file in $CHANGED_FILES; do
  matched=false
  for scope_path in "${scope_write[@]}"; do
    if [[ "$file" == "$scope_path"* ]] || [[ "$file" == "$scope_path" ]]; then
      matched=true
      break
    fi
  done
  if [ "$matched" = false ]; then
    SCOPE_VIOLATIONS+=("$file")
  fi
done
```

If violations found, present scope violation menu (Revert / Expand Scope / Exit).

### 4i. Error Halt Menu (Only on Failure)

```
✗ {story_id}: {story_title} — {failure_reason}
[1] Retry — Fix and re-run
[2] Skip — Mark IMPLEMENTED with issues noted
[3] Exit — Save state, return to main menu
```

---

## Step 5: Spec Compliance Check

After the auto-continue loop, verify all endpoints in api-spec.yaml have implementations. File CRs for missing endpoints.

## Step 6: Code Acceptance Summary

Display per-story CODE ACCEPTANCE results:

```
═══════════════════════════════════════════
Full-Stack 3 — Story Implementation
═══════════════════════════════════════════
Stories: {total}
  APPROVED (CODE_ACCEPTED): {N}
    ✓ {story_id}: {title} — coverage: {pct}%, review: PASS
  BLOCKED_BY_DEPENDENCY: {B}
  SKIPPED: {S}

Next: Full-Stack 4 — QA & Acceptance Gates
```

## Step 7: Record State

```yaml
phases:
  phase_4:
    substates:
      phase_fs_3:
        status: "APPROVED"
        stories:
          - { id: "{story_id}", status: "APPROVED", bmad_story_state: "done",
              code_acceptance: { review_passed: true, test_coverage: {pct} } }
        stories_approved: {N}
        stories_blocked: {B}
```

**Gate for Full-Stack 4:** All non-blocked stories must be APPROVED.
