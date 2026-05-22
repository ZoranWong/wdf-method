---
sub_workflow: "4-4-be-api-endpoints"
phase: 4
sub_phase: "4.4"
version: "3.6.0"
title: "Phase 4.4 — Backend API Endpoint Implementation (AUTO-CONTINUE)"
description: "Implement API endpoints per story with AUTO-CONTINUE. V3.1 adds Contract Gate (API field-level verification), Protected Paths check (SRG-08), Code Standards Gate (SRG-09), Handoff Minimum Gate, and Merge Queue enqueueing."
dependencies:
  - api-spec.yaml
  - story files (backend/full-stack track)
  - sprint-status.yaml (development_order)
iterate: true
auto_continue: true
---

# Phase 4.4 — Backend API Endpoint Implementation

**Sub-Phase Goal:** Implement all backend stories automatically in development order. The agent reads `global_state.development_order` from sprint-status.yaml, filters to `track: "backend"`, finds the first `NOT_STARTED` story, auto-selects it, implements through to `APPROVED`, runs CODE ACCEPTANCE, marks it, and loops to the next story. No menus during normal flow. Only halt on failures or phase completion.

**Gate:** Phase 4.3 status must be LOCKED.

**AUTO-CONTINUE:** This sub-phase runs autonomously. The agent auto-selects and auto-advances stories without user menus. The only halts are: (a) a story fails tests/verification, (b) all stories are APPROVED, (c) a blocked story cannot be skipped.

## FSM State Transition Table (Per Story)

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Story Ready Gate passes | `IN_PROGRESS` | Development begins |
| `IN_PROGRESS` | Endpoint + service implemented | `IMPLEMENTED` | Code complete |
| `IMPLEMENTED` | Unit + integration tests pass | `TESTED` | Tests passing |
| `TESTED` | Validated against api-spec | `SPEC_COMPLIANT` | Matches spec |
| `SPEC_COMPLIANT` | Handoff docs generated (self-check + handoff) | `SUBMITTED` | Ready for acceptance |
| `SUBMITTED` | Acceptance checks pass (executable commands exit 0) | `APPROVED` | Story done |
| `APPROVED` | CODE ACCEPTANCE gates pass | `CODE_ACCEPTED` | Code quality verified, advance to next |
| `NOT_STARTED` | Cross-track dep not APPROVED | `BLOCKED_BY_DEPENDENCY` | Skip, recheck later |

## Story Ready Gate

Before a story begins execution, verify these conditions (enforced at Step 4, before 4a):

```yaml
story_ready_gate:
  story_id: "{story_id}"
  checks:
    - id: "SRG-01"
      description: "Story is not BLOCKED_BY_DEPENDENCY"
      type: "dependency_status"
      expected: "status != BLOCKED_BY_DEPENDENCY"
      severity: "blocking"

    - id: "SRG-02"
      description: "scope_write is defined (not empty)"
      type: "field_check"
      source: "development_order[story_id].scope_write"
      operator: "not_empty"
      severity: "blocking"

    - id: "SRG-03"
      description: "acceptance_check is defined (not empty)"
      type: "field_check"
      source: "development_order[story_id].acceptance_check"
      operator: "not_empty"
      severity: "blocking"

    - id: "SRG-04"
      description: "Story file exists and is readable"
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
      rule: "Each scope_write path must match at least one entry in implementation_boundary.backend_scope or implementation_boundary.shared_scope"
      severity: "blocking"

    - id: "SRG-07"
      description: "scope_write path parent directories exist in project"
      type: "custom_check"
      rule: "Parent directory of each scope_write entry must exist in the project filesystem"
      severity: "blocking"

    - id: "SRG-08"
      description: "scope_write does not intersect with protected_paths (V3.1)"
      type: "protected_path_compliance"
      source: "customize.toml scope_lock.protected_paths"
      rule: "If scope_write intersects any protected_path entry, mark story as serial_only. Protected paths include: shared/contract, shared/types, schema/migration, root/config, api/contract, route/entry, permission/model, build/ci, env/template, shared/ui/shell, route/registry, global/design/tokens."
      severity: "blocking"

    - id: "SRG-08b"
      description: "scope_write does NOT intersect with forbidden_paths (V3.6 — security)"
      type: "forbidden_path_compliance"
      source: "customize.toml scope_lock.forbidden_paths"
      rule: "If scope_write intersects any forbidden_path entry, BLOCK immediately — cannot proceed. Forbidden paths include: /etc/, ~/.ssh/, ~/.aws/, .env.production, .git/, node_modules/. This is a hard security boundary."
      severity: "critical"

    - id: "SRG-09"
      description: "code_standards_source is declared and non-empty (V3.1)"
      type: "field_check"
      source: "development_order[story_id].code_standards_source"
      operator: "not_empty"
      severity: "blocking"
  all_pass: false
```

If any **blocking** check fails, halt and present the error menu. If only warnings, proceed with a note.

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "4.4"
  enters_from: "4.3"
  checks:
    - id: "G4.4-01"
      description: "Phase 4.3 status is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_4.substates.phase_4_3.status"
      operator: "eq"
      expected: "LOCKED"
    - id: "G4.4-02"
      description: "api-spec.yaml is APPROVED or LOCKED"
      type: "artifact_metadata"
      source: "{api_spec_output}"
      field: "frontmatter.status"
      operator: "in"
      expected: ["approved", "locked"]
    - id: "G4.4-03"
      description: "Development order is frozen"
      type: "artifact_metadata"
      source: "{sprint_tracking}"
      field: "global_state.development_order_frozen_at"
      operator: "neq"
      expected: null
  all_pass: false
```

---

## Step 0: Load Sprint Status and Initialize

**Objective:** Load the sprint status, development order, and initialize per-story tracking before the auto-continue loop.

**Actions:**

1. Read `{sprint_tracking}` to load:
   - `global_state.development_order` — the frozen development sequence
   - `phases.phase_4.substates.phase_4_4` — current phase state and story statuses

2. Filter `development_order` for this track:

```yaml
# Extract backend stories with their order, deps, and current status
backend_stories:
  - { order: 1, story_id: "S-3.1", title: "Database Setup & Migrations", depends_on: [], status: null }
  - { order: 2, story_id: "S-3.2", title: "Auth Endpoints", depends_on: [], status: null }
  - { order: 3, story_id: "S-4.1", title: "User CRUD Endpoints", depends_on: [{story_id: "S-3.2", track: "backend"}], status: null }
```

3. Merge with existing story statuses from `phase_4_4.stories` if resuming. Stories not in the tracking yet are initialized to `NOT_STARTED`.

4. Initialize sprint status for this sub-phase if first entry:

```yaml
phases:
  phase_4:
    substates:
      phase_4_4:
        status: "IN_PROGRESS"
        state_history:
          - { state: "IN_PROGRESS", at: "{ISO_TIMESTAMP}" }
        stories:
          - { id: "S-3.1", status: "NOT_STARTED", started_at: null, completed_at: null }
          - { id: "S-3.2", status: "NOT_STARTED", started_at: null, completed_at: null }
          - { id: "S-4.1", status: "NOT_STARTED", started_at: null, completed_at: null }
```

---

## Step 1: Gate Card Check

Evaluate G4.4 checks. Abort if any fail.

---

## Step 2: Load Story Context

Read `{api_spec_output}` for endpoint contracts. Read `{stories_output}/` for all story files with `track: backend` or `track: full-stack`. Read `{sprint_tracking}` for `global_state.development_order`.

---

## Step 3: Parallel Sub-Agent Dispatch (Orchestrator-Controlled)

**IMPORTANT:** The orchestrator dispatches MULTIPLE independent sub-agents CONCURRENTLY when stories have no cross-dependencies and non-overlapping scope_write. Each sub-agent runs in its own worktree with CLEAN context.

### Orchestrator's Parallel Dispatch Algorithm

```
1. Read sprint-status.yaml → global_state.development_order
2. Filter stories WHERE track IN ("backend", "full-stack")
3. Sort by order ASC

4. Identify ALL eligible stories (can run in parallel):
   
   FOR each story IN filtered_stories:
     ✓ status == "NOT_STARTED" or "BLOCKED_BY_DEPENDENCY" (re-check deps)
     ✓ ALL depends_on stories are CODE_ACCEPTED or MERGED
     ✓ scope_write does NOT overlap with any currently RUNNING story's scope_write
     ✓ IF scope_write intersects protected_paths → mark serial_only
   
5. Group eligible stories:
   
   PARALLEL_BATCH = [stories where parallel_safe == true AND NOT serial_only]
   SERIAL_QUEUE = [stories where serial_only == true]
   
6. Dispatch PARALLEL_BATCH stories CONCURRENTLY (up to max_concurrent_stories):
   - Each gets its own worktree, branch, and CLEAN sub-agent prompt
   - Sub-agents run SIMULTANEOUSLY with zero awareness of each other
   
7. Dispatch ONE story from SERIAL_QUEUE if no other serial story is running

8. BLOCKED stories (deps not met): skip, recheck on next dispatch cycle

9. As each sub-agent returns:
   - IF CODE_ACCEPTED: merge → update sprint-status → cleanup worktree
   - IF FAILED: log error, present [Retry|Skip|Exit]
   - Free up dispatch slot → check for more eligible stories → dispatch

10. Loop continues until ALL stories are CODE_ACCEPTED, BLOCKED, or FAILED
```

### Concurrency Constraints

| Constraint | Rule |
|-----------|------|
| `max_concurrent_stories` | Max sub-agents running simultaneously (default 5) |
| `serial_only` | Stories touching protected_paths execute ONE AT A TIME |
| `scope_write` overlap | Stories with overlapping scope CANNOT run in parallel |
| Cross-track deps | Story waits until dep reaches CODE_ACCEPTED |
| Merge queue | Serial merge to main (one at a time, dependency order) |

### Sub-Agent Prompt Template

When dispatching, the orchestrator sends a CLEAN prompt containing ONLY:

```
你在实现一个独立的 story。只关注这个 story，不要参考本会话中的任何其他内容。

Story: {story_id}: {story_title}
Track: backend
scope_write: {paths}
acceptance_check: {commands}
code_standards_source: {sources}
依赖（已满足）: {dep_list or "无"}

你需要读取的文件:
  - {story_file_path} (你的 story 定义)
  - {api_spec_output} (API 契约)
  - {architecture_output} (架构约束)
  - {db_schema_output} (数据库结构)

你的工作目录: .claude/worktrees/story/{story_id}-{track}/
你的代码分支: story/{story_id}-{track}
基线 tag: scope-freeze/pre-implementation

实现步骤 (按顺序执行，不要暂停):
  4a: Story Ready Gate 检查
  4b: 读取 story 文件，标记 IN_PROGRESS
  4b2: [API stories only] Contract Gate — 逐字段验证 api-spec 对齐
  4c: 实现代码 (Validator → Service → Controller → Route)
  4d: 编写并运行测试
  4e: 验证与 api-spec 一致
  4f: 生成 self-check.md + handoff.md
  4f1: Handoff Minimum Gate
  4f2: Scope Exit Verification (git diff 验证)
  4g: 运行 acceptance_check (所有命令 exit 0)
  4h: CODE ACCEPTANCE 检查 (CA-01~CA-05)
  4i2: Checkpoint commit — CODE_ACCEPTED
  4j: 写入 per-story status 文件，返回结果

Git 提交规范 (至少 3 次 commit):
  1. feat({story_id}): implement {story_title} — IMPLEMENTED
  2. test({story_id}): tests passing for {story_title} — TESTED
  3. accept({story_id}): CODE_ACCEPTED — {story_title}

返回格式:
  { story_id: "{story_id}", status: "CODE_ACCEPTED", summary: "...", commit_count: 3 }
  
如果任何步骤失败，立即返回 { story_id, status: "FAILED", step: "4x", error: "..." }
```

### Orchestrator Post-Dispatch (Parallel Merge Semantics)

Sub-agents complete in ANY order. The orchestrator processes each result as it arrives:

1. **IF status == "CODE_ACCEPTED"**:
   - Read per-story status file
   - **Serial merge**: `git merge story/{story_id}-{track} --no-ff` (ONE merge at a time, even if multiple complete simultaneously)
   - Update sprint-status.yaml: story.status → CODE_ACCEPTED
   - Cross-story validation: `npm run test && npm run type-check && npm run lint`
   - Cleanup: `git worktree remove` + `git branch -d`
   - Free up dispatch slot → check for more eligible stories → dispatch next

2. **IF status == "FAILED"**:
   - Log failure reason to sprint-status.yaml
   - Present error menu: [Retry] [Skip] [Exit]
   - If Skip: mark IMPLEMENTED with issues noted, continue
   - Free up slot → dispatch next

3. **IF a serial_only story completes**:
   - Dispatch next story from SERIAL_QUEUE (if any)

---

## Step 4: Per-Story Development Loop (Auto-Execute)

For the auto-selected story, execute the following sub-steps in order. **Do NOT pause between sub-steps — execute continuously through to CODE_ACCEPTED.**

**Step Audit Protocol:** Every sub-step (4a through 4j) MUST write a Step Completion Record to `{step_audit_log_output}` after completion. See `specs/step-audit.md` for the full template. Each record includes: step_id, timestamp, story_id, status, skill_used, command_run, summary, quality, artifacts_produced, state_transition, next_action. Additionally, update the story's `last_completed_substep` field in sprint-status.yaml (e.g., `last_completed_substep: "4c"`).

### 4a. Story Ready Gate Check

Before starting work, evaluate the Story Ready Gate:

1. Verify `scope_write` is defined and non-empty
2. Verify `acceptance_check` is defined and non-empty
3. Verify story file exists
4. Check for conflicting `scope_write` overlaps with other IN_PROGRESS stories (blocking)
5. Verify `scope_write` paths are within `implementation_boundary` (SRG-06)
6. Verify `scope_write` path parent directories exist (SRG-07)
7. Check `scope_write` does not intersect `protected_paths` (SRG-08, V3.1) — if so, mark serial_only
8. Verify `code_standards_source` is declared and non-empty (SRG-09, V3.1)
9. Enforce scope: The agent MUST NOT create or modify files outside `scope_write` paths

If the gate passes, display:
`\u25b6 {story_id}: {story_title} — SCOPE LOCKED → starting implementation`
`  scope_write: {paths}`
`  acceptance_check: {commands}`
`  boundary: within implementation_boundary \u2713`

If a blocking check fails, present the error menu.

### 4b. Read Story File and Mark IN_PROGRESS

Extract: acceptance criteria (Given-When-Then), technical notes (endpoints, DB operations), dependencies.

Update sprint status:

```yaml
phase_4_4:
  stories:
    - { id: "{story_id}", status: "IN_PROGRESS", started_at: "{ISO_TIMESTAMP}", completed_at: null }
```

Display: `\u25b6 Implementing {story_id}: {story_title}`

### 4b2. Contract Gate \u2014 API/Data Model Stories Only (V3.1)

**When to apply:** The story involves API endpoints, data model changes, or contract modifications.

**Objective:** Before writing code, verify exact field-level contract alignment with api-spec.yaml. This prevents implementation drift from the spec.

**Steps:**

1. **List all touched API endpoints**: Read api-spec.yaml and enumerate every endpoint this story will implement or modify.

2. **Field-level contract verification**: For each endpoint:
   - List every field in request and response schemas
   - Confirm exact field names (snake_case backend vs camelCase frontend)
   - Confirm data types match between spec and planned implementation
   - Identify any adapter/normalize mapping between layers

3. **Output the contract gate report**:
   ```
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   CONTRACT GATE \u2014 {story_id}: {story_title}
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   
   Endpoints:
     POST /api/auth/login
       Request: { email: string, password: string }
       Response: { token: string, user: User }
       Field names: snake_case (DB) \u2192 camelCase (API) \u2713
       Adapter: src/adapters/auth.adapter.ts
   
     POST /api/auth/register
       Request: { email: string, password: string, name: string }
       Response: { token: string, user: User }
       Field names: snake_case (DB) \u2192 camelCase (API) \u2713
   
   Contract Compliance: VERIFIED \u2014 2/2 endpoints match api-spec.yaml
   Field Name Consistency: VERIFIED \u2014 snake_case/camelCase mapping confirmed
   Adapter/Normalize Logic: DEFINED \u2014 src/adapters/auth.adapter.ts
   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
     Summary:  CONTRACT GATE PASSED
     Next:     Step 4c \u2014 Implement endpoints per contract
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   ```

4. **If a mismatch is found**: Halt immediately and file a Change Request (CR) against the api-spec:
   ```
   \u26a0 CONTRACT GATE FAILED \u2014 Mismatch detected:
     POST /api/users \u2014 response field "avatarUrl" in spec but "avatar_url" in codebase
     \u2192 Filing CR against Phase 3.8 (API Design)
     \u2192 Story BLOCKED until CR is resolved
   ```

5. **If no api-spec endpoint exists for a required feature**: File a blocking CR:
   ```
   \u26a0 CONTRACT GATE FAILED \u2014 Missing endpoint:
     Story requires POST /api/auth/refresh but no such endpoint in api-spec.yaml
     \u2192 Filing CR against Phase 3.8
     \u2192 Story BLOCKED
   ```

**For non-API stories** (pure database migration, utility, configuration): Skip this step with note: "N/A \u2014 no API endpoints in scope."

### 4c. Implement (Clean Architecture)

1. **Validator** (`src/validators/{resource}.validator.ts`): Zod/Joi schema matching spec
2. **Service** (`src/services/{resource}.service.ts`): Business logic, DB queries
3. **Controller** (`src/controllers/{resource}.controller.ts`): Request handling, response formatting
4. **Route** (`src/routes/{resource}.ts`): Wire method + path + middleware + controller

After implementation, **checkpoint commit 1** — commit the implementation before testing:

```bash
git add {scope_write paths}
git commit -m "feat({story_id}): implement {story_title} — service/controller/route

Scope: {scope_write paths}
Endpoints: {endpoint list}
Status: IMPLEMENTED"
```

Update status to `IMPLEMENTED`.

### 4d. Write Tests

- **Unit tests**: Service layer with mocked DB
- **Integration tests**: Full endpoint with test DB
- Cover: happy path, validation errors, auth failures, not found, edge cases

Run tests. If any fail, fix and re-run.

After all tests pass, **checkpoint commit 2** — commit the passing tests:

```bash
git add {scope_write paths including test files}
git commit -m "test({story_id}): tests passing for {story_title}

Coverage: {percent}%
Tests: {unit_count} unit, {integration_count} integration
Status: TESTED"
```

Update status to `TESTED`.

### 4e. Validate Against API Spec

- Request shape matches spec schema
- Response shape matches spec schema
- Status codes match spec
- Error format matches spec error schema
- Auth requirements match spec

After validation passes, update status to `SPEC_COMPLIANT`.

### 4f. Generate Handoff Documents

After spec validation, generate two mandatory handoff documents. These serve as the audit trail and submission package for this story.

**File: `_story-output/{story_id}/self-check.md`**

```markdown
# Self-Check: {story_id} — {story_title}

## Commands Run
```bash
npm run test:auth
# Result: 12 pass, 0 fail, 0 skip

npm run test:integration -- --grep auth
# Result: 5 pass, 0 fail, 0 skip
```

## Results
- Unit tests: {N} pass, 0 fail
- Integration tests: {N} pass, 0 fail
- Spec compliance: VERIFIED
- Coverage: {percent}%
```

**File: `_story-output/{story_id}/handoff.md`**

```markdown
# Handoff: {story_id} — {story_title}

## Summary
{2-3 sentence summary of what was implemented}

## Files Changed
- src/validators/auth.validator.ts [new]
- src/services/auth.service.ts [new]
- src/controllers/auth.controller.ts [new]
- src/routes/auth.ts [new]

## Endpoints Implemented
- POST /api/auth/login
- POST /api/auth/register
- POST /api/auth/refresh

## Scope Verification
- scope_write: src/modules/auth/ ✓
- No files written outside scope

## Notes for Reviewer
{Any decisions, trade-offs, or items needing attention}
```


After both documents are written, run the **Handoff Minimum Gate (V3.1)** before transitioning to SUBMITTED.

### 4f1. Handoff Minimum Gate (V3.1)

**Objective:** Verify handoff documents contain substantive content — not placeholders or empty sections. This gate MUST pass before SUBMITTED transition.

**self-check.md minimum content:**
- "Commands run" section must be non-empty AND must not contain only "todo"/"tbd"/"none"
- "Results" section must be non-empty AND must not contain only "todo"/"tbd"/"none"
- Must include at least one actual command execution with results

**handoff.md minimum content:**
- "Summary" section must be non-empty AND must not contain only "todo"/"tbd"/"none"
- "Files changed" section must list at least one actual file path
- "Scope Verification" must confirm no files written outside scope_write

**If gate fails:** Do NOT transition to SUBMITTED. Display the failure:
```
✗ HANDOFF MINIMUM GATE — {story_id} FAILED
  self-check.md:
    Commands run: ✗ EMPTY / placeholder
    Results: ✗ contains "todo"
  handoff.md:
    Files changed: ✗ EMPTY
Action required: Fill in all marked sections before resubmitting.
```

**After gate passes:** Update status to `SUBMITTED`.

Display: `📄 Handoff docs generated → _story-output/{story_id}/`


### 4f2. Scope Exit Verification

Before proceeding to acceptance checks, verify all file modifications are within the story's `scope_write`:

```bash
# Get all modified files since story started
CHANGED_FILES=$(git diff --name-only scope-freeze/pre-implementation..HEAD)
VIOLATIONS=0
for f in $CHANGED_FILES; do
  matched=0
  for p in ${scope_write}; do
    # 目录边界匹配：精确匹配 或 路径前缀+目录分隔符
    [[ $f = "$p" || $f = "$p"/* ]] && { matched=1; break; }
  done
  if [ $matched = 0 ]; then
    echo "VIOLATION: $f"
    VIOLATIONS=$((VIOLATIONS+1))
  fi
done
if [ $VIOLATIONS -gt 0 ]; then
  echo "SCOPE EXIT FAILED — $VIOLATIONS violation(s)"
  # Present error menu: [Revert] [Expand Scope] [Exit]
fi
```

If `VIOLATIONS` is zero:
```
═══════════════════════════════════════════════════════
SCOPE LOCK — Scope Exit Verification
═══════════════════════════════════════════════════════
  Phase:    4.4
  Story:    {story_id}: {story_title}
  Step:     4f2
  Skill:    /bmad-dev-story
  Command:  git diff --name-only scope-freeze/pre-implementation..HEAD
  Status:   PASS
───────────────────────────────────────────────────────
  Files Changed:   {total_changed}
    ✓ {file_1}  (within scope_write)
    ✓ {file_2}  (within scope_write)
  Violations:      0
───────────────────────────────────────────────────────
  Summary:  CLEAN — 0 violations ({total_changed} files checked)
  Next:     Step 4g — Execute Acceptance Checks
═══════════════════════════════════════════════════════
```

**Document Record** — append to `{scope_audit_log_output}` (see specs/scope-lock.md Operation 6 for full YAML record).

If violations are found:
```
  \u26a0 SCOPE VIOLATION in {story_id}: {N} file(s) outside scope_write
    \u2717 {file_1}
    \u2717 {file_2}

    [1] Revert — git checkout the violating files, keep scope_write changes
    [2] Expand Scope — Submit CR to add files to scope_write (requires approval)
    [3] Exit — Save state, return to menu for manual resolution
```

- **[1] Revert**: `git checkout -- <violating_files>` then continue to acceptance checks
- **[2] Expand Scope**: Submit Scope Expansion CR, wait for user approval before continuing
- **[3] Exit**: Halt auto-continue, story stays in SUBMITTED state

### 4g. Execute Acceptance Checks

Run the `acceptance_check` commands defined in the development order for this story. These are executable shell commands that must all exit with code 0.

```
Running acceptance checks for {story_id}:

  [1/2] npm run test:auth
  Executing... ✓ PASSED (exit 0)

  [2/2] npm run test:integration -- --grep auth
  Executing... ✓ PASSED (exit 0)

  All acceptance checks passed! ✓
```

If any acceptance check fails (non-zero exit), halt and present the error menu.

After all acceptance checks pass, update status to `APPROVED`.

### 4h. CODE ACCEPTANCE

After all acceptance checks pass for the story, invoke `/bmad-code-review adversarial` on the story's scope to run adversarial code review against the implemented changes. This is a mandatory quality gate.

**Code Acceptance Check:**

```yaml
code_acceptance:
  story_id: "{story_id}"
  type: "code_acceptance"
  checks:
    - id: "CA-01"
      description: "Adversarial code review passes"
      command: "/bmad-code-review adversarial"
      target: "{scope_write files}"
      expected: "No critical or high-severity issues"
    - id: "CA-02"
      description: "Test coverage meets threshold"
      command: "npm run test:coverage -- {scope_write}"
      expected: ">= min_test_coverage from customize.toml"
    - id: "CA-03"
      description: "Type check passes"
      command: "npm run type-check"
      expected: "exit 0"
    - id: "CA-04"
      description: "Lint passes"
      command: "npm run lint"
      expected: "exit 0 (no errors)"
    - id: "CA-05"
      description: "Scope boundary audit — git diff verification. Uses for-loop with directory boundary matching (\"$p\"/*) to prevent false positives like src/auth matching src/foobar.ts"
      command: "SCOPE_FILES=\$(git diff --name-only scope-freeze/pre-implementation..HEAD); VIOLATIONS=0; for f in \$SCOPE_FILES; do matched=0; for p in \${scope_write}; do [[ \$f = \"\$p\" || \$f = \"\$p\"/* ]] && { matched=1; break; }; done; [ \$matched = 0 ] && { echo \"VIOLATION: \$f\"; VIOLATIONS=\$((VIOLATIONS+1)); }; done; [ \$VIOLATIONS = 0 ]"
      expected: "exit 0 (0 violations)"
  all_pass: false
```

Run CODE ACCEPTANCE checks:

```
Running CODE ACCEPTANCE for {story_id}:

  [1/5] /bmad-code-review adversarial
  Executing... ✓ PASSED — 0 critical, 0 high, 2 info

  [2/5] npm run test:coverage -- src/modules/auth/
  Executing... ✓ PASSED — 87.5% coverage (min 80%)

  [3/5] npm run type-check
  Executing... ✓ PASSED (exit 0)

  [4/5] npm run lint
  Executing... ✓ PASSED (exit 0)

  [5/5] git diff --name-only scope-freeze/pre-implementation..HEAD → for each file, verify within scope_write → count violations
  Executing... ✓ PASSED — 0 violations ({N} files checked)

  All CODE ACCEPTANCE checks passed! ✓
```

If any CODE ACCEPTANCE check fails, halt and present the error menu.

After all CODE ACCEPTANCE checks pass, update status to `CODE_ACCEPTED`.

### 4i. Update Dev Log

Record progress in `{backend_dev_log_output}` with story status including CODE ACCEPTANCE results.

### 4i2. Checkpoint Commit — CODE_ACCEPTED

Before enqueuing the merge, create a final checkpoint commit confirming CODE_ACCEPTED status:

```bash
git add {scope_write paths}
git commit -m "accept({story_id}): CODE_ACCEPTED — {story_title}

Review: PASSED
Coverage: {percent}%
Type check: PASSED
Lint: PASSED
Scope audit: 0 violations
Handoff docs: _story-output/{story_id}/{self-check.md, handoff.md}
Status: CODE_ACCEPTED → queued for merge"
```

This commit marks the final, verified state of the story and serves as the merge candidate.

### 4j. Mark CODE_ACCEPTED and Auto-Advance (Replaces Post-Story Menu)

**There is NO post-story menu.** After CODE ACCEPTANCE checks pass, the story is automatically marked `CODE_ACCEPTED`:

```yaml
phase_4_4:
  stories:
    - { id: "{story_id}", status: "CODE_ACCEPTED", started_at: "{ISO_TIMESTAMP}", completed_at: "{ISO_TIMESTAMP}" }
```

Display: `\u2713 {story_id}: {story_title} — CODE_ACCEPTED`

**Enqueue Merge (V3.6):** After CODE_ACCEPTED, the story enters the file-based Merge Queue.

**Lock protocol (only during creation, ~100ms):**
```bash
# 1. Acquire short-lived lock
mkdir merge-queue/.lock 2>/dev/null || exit 1

# 2. Read next merge_order from queue.yaml
MERGE_ORDER=$(grep "next_merge_order" merge-queue/queue.yaml | awk '{print $2}')

# 3. Create empty item file with sequential number
touch "merge-queue/items/$(printf '%04d' $MERGE_ORDER)-{story_id_slug}-{track}.yaml"

# 4. Release lock immediately
rmdir merge-queue/.lock

# 5. Write full item content (NO LOCK NEEDED — this file is ours)
cat > "merge-queue/items/$(printf '%04d' $MERGE_ORDER)-{story_id_slug}-{track}.yaml" <<EOF
queue_item:
  queue_item_id: "QUEUE-$(printf '%04d' $MERGE_ORDER)-{story_id_slug}-{track}"
  story_id: "{story_id}"
  track: "{track}"
  branch: "{current_branch}"
  merge_order: $MERGE_ORDER
  depends_on: [{dep_story_ids}]
  integration_checks: ["npm run test", "npm run build", "npm run type-check"]
  merge_status: "queued"
  enqueued_at: "{ISO_TIMESTAMP}"
EOF

# 6. Update queue metadata (NO LOCK — single writer)
# increment next_merge_order by 10 in queue.yaml
```

**Lock minimizes contention:** Only step 1-4 is locked (~100ms). Steps 5-6 (writing content) use no lock. Multiple stories can enqueue with near-zero wait.

Display: `📥 {story_id} enqueued for merge — order {merge_order} → merge-queue/items/`

**Then loop back to Step 3** to auto-select the next story.

### 4k. Error Halt Menu (Only on Failure)

If a story **fails** tests, verification, or CODE ACCEPTANCE, present this minimal 3-option menu (the ONLY menu in this phase):

```
\u2717 {story_id}: {story_title} — {failure_reason}

[1] Retry — Fix the issue and re-run tests/verification for this story
[2] Skip — Mark as IMPLEMENTED with issues noted, continue to next story
[3] Exit — Save state and return to main menu (manual intervention needed)
```

**If [1] Retry:** Fix the identified issue, re-run the failing step, and retry the transition.
**If [2] Skip:** Add a note to the dev log documenting the unresolved issue. Mark the story as `IMPLEMENTED` (not `CODE_ACCEPTED`). Continue to Step 3.
**If [3] Exit:** Save state. Return to main menu. The story remains in its current non-CODE_ACCEPTED state.

### Scope Violation Menu (when scope exit verification or CA-05 fails)

```
\u26a0 SCOPE VIOLATION in {story_id}: {N} file(s) outside scope_write

  \u2717 {file_1}
  \u2717 {file_2}

[1] Revert — git checkout the violating files, keep scope_write changes
[2] Expand Scope — Submit CR to add files to scope_write (requires approval)
[3] Exit — Save state and return to main menu
```

---

## Step 5: Spec Compliance Check (Auto-Execute Context)

After the auto-continue loop finishes (all backend stories processed — either CODE_ACCEPTED or BLOCKED_BY_DEPENDENCY), verify every endpoint defined in api-spec.yaml has a corresponding implementation.

For each missing endpoint, file a Change Request (CR) with appropriate severity.

---

## Step 6: Change Request Detection

Check for: missing spec endpoints, spec violations, missing error handling, auth gaps. File CRs as blocking or non-blocking per severity.

---

## Step 7: BE Track Summary

After all backend stories are processed, present the phase summary:

```
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
Phase 4.4 — API Endpoint Implementation
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

Stories Processed: {total_count}
  CODE_ACCEPTED: {code_accepted_count}
    \u2713 S-3.1: Database Setup & Migrations
    \u2713 S-3.2: Auth Endpoints
    \u2713 S-4.1: User CRUD Endpoints
  BLOCKED_BY_DEPENDENCY: {blocked_count}
    \u2298 S-5.1: Webhook Handler (waiting on frontend S-4.3)
  SKIPPED (issues): {skipped_count}

CRs Filed: {cr_count} ({blocking_count} blocking, {non_blocking_count} non-blocking)

All CODE_ACCEPTED stories are ready for Phase 4.5 — Backend Testing Suite.
Blocked stories will be re-checked on next entry to this phase.
```

### TRACK VERIFICATION (BE Track)

After the phase summary, verify all CODE_ACCEPTED stories are consistent and contract-compliant:

```yaml
track_verification:
  phase: "4.4"
  track: "backend"
  checks:
    - id: "TV-01"
      description: "Backend contract verification — all endpoints in stories match api-spec.yaml"
      command: |
        ENDPOINT_LINES=$(grep -r "endpoint\|route\|HTTP" {stories_output}/)
        VIOLATIONS=0
        IFS=$'\n'; for line in $ENDPOINT_LINES; do
          endpoint=$(echo "$line" | grep -oE '(GET|POST|PUT|DELETE) [^ ]+')
          if [ -n "$endpoint" ] && ! grep -q "$endpoint" {api_spec_output}; then
            echo "MISSING: $endpoint not in api-spec.yaml"
            VIOLATIONS=$((VIOLATIONS+1))
          fi
        done
        [ "$VIOLATIONS" = "0" ]
      expected: "All endpoints referenced in stories exist in api-spec.yaml"
    - id: "TV-02"
      description: "All backend stories CODE_ACCEPTED"
      command: "Check sprint-status.yaml: phases.phase_4.substates.phase_4_4.stories[].status == CODE_ACCEPTED for non-blocked"
      expected: "All non-blocked backend stories CODE_ACCEPTED"
    - id: "TV-03"
      description: "No test failures in implemented stories"
      command: "npm run test -- --grep '{backend_story_pattern}' || true; verify exit 0"
      expected: "All backend story tests pass"
  all_pass: false
```

```
Running TRACK VERIFICATION (BE Track):

  [1/3] Contract verification
  Checking all endpoints in stories match api-spec.yaml...
  ✓ PASSED — 15/15 endpoints match

  [2/3] All stories CODE_ACCEPTED
  ✓ PASSED — 5/5 non-blocked stories CODE_ACCEPTED

  [3/3] Test suite
  ✓ PASSED — 42 tests pass, 0 fail

  All TRACK VERIFICATION checks passed! ✓
```

If any TRACK VERIFICATION check fails, present the error and halt.

After all checks pass, track is ready for Phase 4.5 — Backend Testing Suite.

---

## Phase Complete

Update `{sprint_tracking}` under `phases.phase_4.substates.phase_4_4`:

```yaml
phase_4_4:
  status: "CODE_ACCEPTED"
  state_history:
    - { state: "IN_PROGRESS", at: "{ISO}" }
    - { state: "CODE_ACCEPTED", at: "{ISO}" }
  artifacts:
    - { type: "dev_log", path: "{backend_dev_log_output}", status: "complete" }
    - { type: "handoff_docs", path: "_story-output/{story_id}/", status: "complete" }
  stories:
    - { id: "S-3.1", status: "CODE_ACCEPTED", started_at: "...", completed_at: "..." }
    - { id: "S-3.2", status: "CODE_ACCEPTED", started_at: "...", completed_at: "..." }
    - { id: "S-4.1", status: "CODE_ACCEPTED", started_at: "...", completed_at: "..." }
  stories_code_accepted: {N}
  stories_blocked_by_dependency: {N}
  crs_filed: {N}
```

**Gate for Phase 4.5:** All non-blocked stories must be CODE_ACCEPTED. `BLOCKED_BY_DEPENDENCY` stories do NOT count as incomplete for gate purposes.

Present: "Phase 4.4 complete — {N} stories CODE_ACCEPTED, BE track FEATURE_ACCEPTED. {B} blocked by cross-track dependencies. Next: Phase 4.5 — Backend Testing Suite."
