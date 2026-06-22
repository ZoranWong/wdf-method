---
sub_workflow: "3-9-readiness-check"
phase: 3
sub_phase: "3.9"
version: "3.6.0"
title: "Phase 3.9 — Implementation Readiness Check"
description: "Final validation gate before implementation begins. Verifies all artifacts exist, frontmatter statuses are consistent, no gaps exist between PRD/epics/stories/API spec, and both freezes (Requirements and Development Order) are in effect."
dependencies:
  - All upstream sub-phases 3.1 through 3.8
methodology: "Structured Artifact Audit"
bmad_skill: "/bmad-check-implementation-readiness"
---

# Phase 3.9 — Implementation Readiness Check

**Sub-Phase Goal:** Perform a comprehensive audit of all solutioning artifacts to verify the project is truly ready for implementation. This is the final gate before Phase 4 (Implementation) — it prevents starting development with incomplete or inconsistent specifications.

**Why This Matters:** Starting implementation with gaps in requirements, inconsistencies between artifacts, or missing freezes leads to rework, scope creep, and broken contracts. This check catches those issues before a single line of code is written.

**Duration:** One session. Runs once as the final Solutioning gate before transitioning to Implementation.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin readiness audit |
| `IN_PROGRESS` | All artifacts verified to exist | `ARTIFACTS_VERIFIED` | All required files present |
| `ARTIFACTS_VERIFIED` | Cross-artifact consistency checked | `CONSISTENCY_CHECKED` | No gaps or contradictions |
| `CONSISTENCY_CHECKED` | All checks pass, project ready | `READY` | Implementation can begin |
| `READY` | User locks the readiness check | `LOCKED` | Readiness verified and sealed |

---

## Gate Card

```yaml
gate_card:
  phase: 3
  sub_phase: "3.9"
  enters_from: "3.8"
  checks:
    - id: "G3.9-01"
      description: "Phase 3.1 through 3.8 are all LOCKED"
      type: "custom_check"
      source: "{sprint_tracking}"
      rule: "All substates under phases.phase_3.substates must have status LOCKED"
      severity: "blocking"

    - id: "G3.9-02"
      description: "Requirements are frozen (Phase 3.6)"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "global_state.requirements_frozen_at"
      operator: "neq"
      expected: null

    - id: "G3.9-03"
      description: "Development order is frozen (Phase 3.7)"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "global_state.development_order_frozen_at"
      operator: "neq"
      expected: null

    - id: "G3.9-04"
      description: "User confirms readiness to begin readiness audit"
      type: "user_confirmation"
  all_pass: false
```

The gate card requires ALL upstream sub-phases (3.1 through 3.8) to be LOCKED. This is enforced by recording which sub-phases are complete and comparing against the expected set.

---

## Step 1: Gate Card Check

Evaluate all G3.9 checks. The agent reads `{sprint_tracking}` and verifies:

1. All expected sub-phases under `phases.phase_3.substates` have status `LOCKED`.
2. `global_state.requirements_frozen_at` is not null.
3. `global_state.development_order_frozen_at` is not null.

**If gate fails**, produce a diagnostic report:

```
Implementation Readiness Gate FAILED:

Missing locked sub-phases:
  - Phase 3.6 (Epics): NOT_STARTED — must be LOCKED before readiness check

Missing freezes:
  - Requirements Freeze: NOT SET — must be confirmed in Phase 3.6
  - Development Order Freeze: NOT SET — must be confirmed in Phase 3.7

Please complete these sub-phases before running the readiness check.
```

Abort and return to the Phase 3 sub-phase menu.

**On gate pass**, record:

```yaml
phases:
  phase_3:
    substates:
      phase_3_9:
        status: "IN_PROGRESS"
        gate_card:
          all_pass: true
```

---

## Step 2: Artifact Existence Audit

Verify every expected artifact exists and has the correct status in its frontmatter.

### 2.1 Checklist

| Artifact | Expected Path | Expected Status | Exists? | Status OK? |
|----------|--------------|-----------------|---------|------------|
| PRD | `{prd_output}` | locked | ✅/❌ | ✅/❌ |
| Architecture | `{architecture_output}` | locked | ✅/❌ | ✅/❌ |
| Epics | `{epics_output}` | approved or locked | ✅/❌ | ✅/❌ |
| Story files | `{stories_output}/story-*-*.md` | locked (N files) | ✅/❌ | ✅/❌ |
| API Spec | `{api_spec_output}` | locked | ✅/❌ | ✅/❌ |
| DB Schema | `{db_schema_output}` | locked | ✅/❌ | ✅/❌ |
| Sprint Status | `{sprint_tracking}` | exists | ✅/❌ | ✅/❌ |

Also verify any phase-specific artifacts from sub-phases 3.1-3.5 (depending on workflow configuration).

### 2.2 Missing Artifact Resolution

If any artifact is missing or has incorrect status, the audit halts:

> "Artifact audit FAILED: {artifact} is missing / has status '{actual_status}' (expected 'locked')."
>
> "This must be resolved by returning to the relevant sub-phase and completing it."

File a blocking Change Request against the source sub-phase. Abort readiness check.

Transition to `IN_PROGRESS` but do NOT advance until all artifacts exist.

**On all artifacts verified:**

Transition: `IN_PROGRESS` → `ARTIFACTS_VERIFIED`.

---

## Step 3: Frontmatter Status Consistency Check

Verify all artifact frontmatter statuses are internally consistent and match the sprint-status.yaml.

### 3.1 Checks

For each artifact, verify:

1. **Frontmatter `status`** matches the `sprint_tracking` record for that artifact.
2. **Frontmatter `phase`** and `sub_phase` correctly identify the producing sub-phase.
3. **Frontmatter `locked_at`** is present and is a valid ISO timestamp if status is `locked`.
4. **Frontmatter `artifact_type`** matches the expected type for that artifact.
5. **Frontmatter `version`** is present.

### 3.2 Inconsistency Resolution

If any inconsistency is found:

> "Frontmatter inconsistency detected: {artifact} frontmatter `status` is '{frontmatter_status}' but status directory shows '{tracking_status}'."
>
> "[1] Auto-correct frontmatter to match status directory"
> "[2] Auto-correct status directory to match frontmatter"
> "[3] Leave as-is (skip — NOT recommended)"

After resolution, re-run the consistency check.

---

## Step 4: Cross-Artifact Consistency Check

Verify all artifacts are internally consistent with each other. This is the most important check — it validates the traceability chain from PRD through API spec.

### 4.1 PRD → Epics Coverage

Verify every functional requirement in the PRD is covered by at least one epic/story:

| PRD Feature | Epic Coverage | Status |
|-------------|--------------|--------|
| Feature A | Epic 1, Story 1.1 | OK |
| Feature B | NOT COVERED | GAP |

Flag uncovered PRD features as blocking gaps.

### 4.2 Epics → Stories Coverage

Verify every story in the epics document has a corresponding story file:

| Epic Story | Story File | Status |
|------------|------------|--------|
| Epic 1, Story 1.1 | story-1-auth-login.md | OK |
| Epic 1, Story 1.2 | MISSING | GAP |

Flag missing story files as blocking gaps.

### 4.3 Stories → API Spec Coverage

Verify every backend/full-stack story's required endpoints exist in the API spec:

| Story | Required Endpoint | Spec Coverage | Status |
|-------|------------------|---------------|--------|
| S-3.2: Auth Endpoints | POST /api/v1/auth/login | OK | OK |
| S-4.1: User CRUD | GET /api/v1/users | OK | OK |
| S-5.1: Dashboard | GET /api/v1/dashboard/stats | MISSING | GAP |

Flag missing endpoints as blocking gaps.

### 4.4 API Spec → DB Schema Coverage

Verify every data entity in the API spec has a corresponding table in the DB schema:

| API Entity | DB Table | Status |
|------------|----------|--------|
| User | users | OK |
| Product | MISSING | GAP |

Flag missing tables as blocking gaps.

### 4.5 Development Order Validity

Verify the development order in `{sprint_tracking}` is valid:
- Each story in development order has a corresponding story file
- Dependencies in development order are valid (no circular deps)
- Cross-track dependencies reference existing stories
- `parallel_safe` flags are consistent (no two `parallel_safe: false` at same order)

### 4.6 Scope Write Completeness

Verify all stories have `scope_write` defined and non-empty:

```
Scope Write Completeness Check:
  ✓ S-3.1: scope_write = ["src/db/", "src/migrations/"]
  ✓ S-3.2: scope_write = ["src/modules/auth/", "src/middleware/auth.ts"]
  ✓ S-1.1: scope_write = ["src/pages/", "src/components/layout/"]
  ✗ S-5.1: scope_write = undefined — MISSING
```

If any story lacks `scope_write`, flag as a blocking gap:
> "Story {story_id} has no scope_write defined. This must be resolved before implementation can begin."

### 4.7 Implementation Boundary Generation

Compute `implementation_boundary` from all story `scope_write` paths:

```
1. Collect all scope_write arrays from development_order
2. De-duplicate and normalize paths
3. Classify by track:
   - backend_scope: paths from track="backend" stories
   - frontend_scope: paths from track="frontend" stories
   - shared_scope: paths from track="full-stack" stories
4. Merge with forbidden_paths from customize.toml [scope_lock]
```

Write to `{sprint_tracking}`:

```yaml
global_state:
  implementation_boundary:
    defined_at: "{ISO_TIMESTAMP}"
    scope_frozen: true
    backend_scope: ["src/modules/", "src/middleware/", "src/db/", "src/migrations/"]
    frontend_scope: ["src/pages/", "src/components/", "src/hooks/", "src/app/"]
    shared_scope: ["package.json", "tsconfig.json"]
    forbidden_paths: []  # from customize.toml
```

**Console Output** (follow specs/scope-lock.md Operation 1 format):

```
═══════════════════════════════════════════════════════
SCOPE LOCK — Implementation Boundary Generation
═══════════════════════════════════════════════════════
  Phase:    3.9
  Step:     4.7
  Skill:    N/A
  Command:  N/A (computed from development_order)
  Status:   PASS
───────────────────────────────────────────────────────
  Stories analyzed:     {total_count}
  scope_write entries:  {total_paths}
  Backend scope:        {N} path(s)
  Frontend scope:       {M} path(s)
  Shared scope:         {K} path(s)
  Forbidden:            {F} path(s)
───────────────────────────────────────────────────────
  Summary:  Boundary generated from {total_count} stories — {total_paths} paths
  Next:     Step 4.8 — Requirements Freeze Verification
═══════════════════════════════════════════════════════
```

**Document Record** — append to `{scope_audit_log_output}` (see specs/scope-lock.md Operation 1 for full YAML record).

### 4.8 Requirements Freeze Verification

Verify the Requirements Freeze is still in effect:
- `global_state.requirements_frozen_at` is set
- No new features have been added since the freeze without a CR
- All CRs filed since freeze are tracked and have status

### 4.9 Development Order Freeze Verification

Verify the Development Order Freeze is still in effect:
- `global_state.development_order_frozen_at` is set
- Development order has not been modified since freeze without a CR

### 4.5a Cross-Phase Semantic Consistency (V3.6)

**This is the critical cross-phase coherence check.** It prevents the "Phase 3 architecture contradicts Phase 2 PRD" failure mode.

**Method:** Dispatch a dedicated sub-agent with BOTH the PRD (Phase 2 output) and Architecture + Stories (Phase 3 output). This is the ONE place where the thin orchestrator boundary is intentionally crossed — the sub-agent loads artifact body content and performs semantic validation.

**Sub-agent clean context:**
- `{prd_output}` — Phase 2 PRD (all sections)
- `{architecture_output}` — Phase 3 full architecture (system context through component design)
- `{epics_output}` — Phase 3 epics
- `{stories_output}/` — All story files
- `{api_spec_output}` — OpenAPI spec
- `{db_schema_output}` — Database schema

**Sub-agent instructions:**

```
You are a cross-phase consistency auditor. Your job is to verify that Phase 3
(Solutioning) completely and correctly addresses Phase 2 (Planning).

Perform these checks:

1. PRD REQUIREMENT COVERAGE:
   - Extract every functional requirement from the PRD
   - Verify each requirement maps to at least one story in the story files
   - Report any PRD requirement with ZERO story coverage → BLOCKING GAP

2. ARCHITECTURAL DECISION COVERAGE:
   - Extract every ADR (Architecture Decision Record) from the architecture
   - Verify each ADR is reflected in the stories (e.g., if ADR says "use Redis for caching",
     there should be stories that implement Redis integration)
   - Report any ADR not traceable to a story → NON-BLOCKING GAP

3. API SPEC ↔ STORY ALIGNMENT:
   - Extract every endpoint from the API spec
   - Verify each endpoint has a corresponding story that implements it
   - Verify each story that mentions an API endpoint has it defined in the spec
   - Report mismatches → BLOCKING GAP

4. DATA MODEL ↔ STORY ALIGNMENT:
   - Extract every entity from the DB schema
   - Verify each entity is referenced by at least one story
   - Report orphan entities (defined in schema, never used) → NON-BLOCKING GAP

5. PERSONA ↔ USER FLOW COVERAGE:
   - Extract personas from the PRD
   - Verify each persona has at least one user flow / story addressing their needs
   - Report underserved personas → NON-BLOCKING GAP

Output:
- Section 1: Requirement Coverage Matrix (requirement → stories, gaps flagged)
- Section 2: ADR Traceability (ADR → stories, untraced decisions flagged)
- Section 3: API Alignment (endpoint ↔ story, mismatches flagged)
- Section 4: Data Model Alignment (entity ↔ story, orphans flagged)
- Section 5: Persona Coverage (persona → stories, underserved flagged)
- Verdict: PASS (all BLOCKING checks pass) or FAIL (list blocking gaps)
```

**Sub-agent returns:** `{ status: "PASS" | "FAIL", gaps: [...], report_file: "{readiness_check_path}/cross-phase-consistency.md" }`

Blocking gaps halt the readiness check. Non-blocking gaps are recorded for Phase 4 awareness.

Transition: `ARTIFACTS_VERIFIED` → `CONSISTENCY_CHECKED`.

---

## Step 5: Resolve Gaps

For each gap found in Step 4, present to the user:

```
Consistency Gap Report:

BLOCKING (3):
  1. PRD Feature "Admin Dashboard" not covered by any epic
  2. Story S-5.1 file missing
  3. API endpoint GET /api/v1/dashboard/stats not in spec

NON-BLOCKING (1):
  1. Story S-2.3 "Notifications" has no UI mockup (frontend track)

Resolution options for each gap:
[1] Return to source sub-phase and add missing artifact
[2] File a CR and defer to Phase 4.1 (Sprint Planning)
[3] Mark as intentional (requires justification, logged)
```

All **blocking gaps** must be resolved before proceeding. The user must either return to the source sub-phase or file a blocking CR.

After all blocking gaps are resolved, re-run the consistency check (Step 4).

---

## Step 6: Readiness Declaration

When all checks pass with zero blocking gaps:

> "### Implementation Readiness: PASSED"
>
> "All artifacts exist, frontmatters are consistent, and cross-artifact traceability is verified."
>
> "**Requirements:** Frozen at {requirements_frozen_at}"
> "**Development Order:** Frozen at {development_order_frozen_at}"
> "**API Contract:** Locked ({N} endpoints, {M} resource groups)"
>
> "The project is ready for Phase 4 — Implementation."
>
> "Do you confirm readiness and want to lock this check? [Y] Confirm [N] Review Details"

Transition: `CONSISTENCY_CHECKED` → `READY`.

---

## Step 7: Lock Readiness Check

Transition: `READY` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
phases:
  phase_3:
    substates:
      phase_3_9:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "ARTIFACTS_VERIFIED", at: "{ISO}" }
          - { state: "CONSISTENCY_CHECKED", at: "{ISO}" }
          - { state: "READY", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        audit_results:
          artifacts_exist: {pass_count}/{total_count}
          frontmatter_consistent: true
          prd_to_epics_covered: true
          epics_to_stories_covered: true
          stories_to_api_covered: true
          api_to_db_covered: true
          development_order_valid: true
          scope_write_complete: true
          implementation_boundary_generated: true
          requirements_frozen: true
          development_order_frozen: true
        gaps_found: {count}
        gaps_resolved: {count}
        blocking_gaps_remaining: 0
        non_blocking_gaps_remaining: {count}
        gate_card:
          all_pass: true
```

Update `global_state`:

```yaml
global_state:
  overall_status: "ready_for_implementation"
  implementation_ready_at: "{ISO_TIMESTAMP}"
```

---

## Step 8: Completion

Present summary:

> "Phase 3.9 complete — Implementation Readiness Check PASSED."
>
> "**Phase 3 (Solutioning) is now complete.** All artifacts are verified, consistent, and locked."
>
> "---"
>
> "### Solutioning Summary"
> "| Sub-Phase | Status | Key Artifact |"
> "|-----------|--------|-------------|"
> "| 3.6 Epics | LOCKED | `{epics_output}` |"
> "| 3.7 Stories | LOCKED | {N} files in `{stories_output}/` |"
> "| 3.8 API Design | LOCKED | `{api_spec_output}`, `{db_schema_output}` |"
> "| 3.9 Readiness Check | LOCKED | All checks passed |"
>
> "---"
>
> "**Ready for Phase 4 — Implementation.**"
> "Next: Phase 4.1 — Sprint Planning."

Return to the Phase 3 sub-phase menu (now complete).
