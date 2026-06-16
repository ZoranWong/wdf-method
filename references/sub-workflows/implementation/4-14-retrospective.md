---
sub_workflow: "4-14-retrospective"
phase: 4
sub_phase: "4.14"
version: "3.6.0"
title: "Phase 4.14 — Retrospective"
description: "Conduct a structured retrospective on the complete web-dev-flow project. Collect data, surface insights, define action items, and produce a retrospective report to improve future projects."
dependencies:
  - Phase 4.13 (Integration) must be LOCKED
  - sprint-status.yaml (complete project data)
methodology: "Structured Retrospective"
bmad_skill: "/bmad-retrospective"
---

# Phase 4.14 — Retrospective

**Sub-Phase Goal:** Conduct a structured retrospective on the complete project lifecycle — from Analysis through Implementation. Capture what worked well, what could be improved, and actionable insights for future projects using the web-dev-flow workflow.

**Why This Matters:** Every project is a learning opportunity. A structured retrospective captures insights while they are fresh, identifies patterns across the workflow, and produces actionable improvements for the next project. It closes the loop on continuous process improvement.

**Duration:** One session. Runs once after all implementation and integration is complete. This is the final sub-phase of the entire workflow.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Gate check passes | `IN_PROGRESS` | Begin retrospective |
| `IN_PROGRESS` | Project data collected | `DATA_COLLECTED` | Metrics and observations gathered |
| `DATA_COLLECTED` | Insights documented | `INSIGHTS_DOCUMENTED` | What worked, what didn't |
| `INSIGHTS_DOCUMENTED` | Action items defined | `ACTION_ITEMS_DEFINED` | Concrete improvements identified |
| `ACTION_ITEMS_DEFINED` | User verifies retrospective | `VERIFIED` | Retrospective reviewed |
| `VERIFIED` | Retrospective locked | `LOCKED` | Retrospective complete |

---

## Gate Card

```yaml
gate_card:
  phase: 4
  sub_phase: "4.14"
  enters_from: "4.13"
  checks:
    - id: "G4.14-01"
      description: "Phase 4.13 (Integration) is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_4.substates.phase_4_13.status"
      operator: "eq"
      expected: "LOCKED"

    - id: "G4.14-02"
      description: "Feature acceptance has been achieved"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "global_state.feature_acceptance_achieved_at"
      operator: "neq"
      expected: null

    - id: "G4.14-03"
      description: "Sprint status tracking is complete and available"
      type: "artifact_exists"
      source: "{sprint_tracking}"

    - id: "G4.14-04"
      description: "User confirms readiness for retrospective"
      type: "user_confirmation"
  all_pass: false
```

**If gate fails:**

> "The retrospective cannot start until Phase 4.13 (Integration) is complete and Feature Acceptance has been achieved."
>
> "Current: Integration status = {P4.13_STATUS}, Feature Acceptance = {achieved/not achieved}"
>
> "Please complete integration and feature acceptance first."

---

## Step 1: Gate Card Check

Evaluate all G4.14 checks. Record results in `{sprint_tracking}`.

**On gate pass**, record:

```yaml
phases:
  phase_4:
    substates:
      phase_4_14:
        status: "IN_PROGRESS"
        gate_card:
          all_pass: true
```

---

## Step 2: Collect Project Data

Invoke: `/bmad-retrospective`

### 2.1 Quantitative Data Collection

Gather metrics from `{sprint_tracking}` and project artifacts:

```markdown
## Project Metrics

### Scope & Timeline
- **Total Stories:** {N} (BE: {B}, FE: {F}, Full-stack: {S})
- **Total Epics:** {E}
- **Sprint Duration:** Planned {planned_days} days, Actual {actual_days} days
- **Requirements Frozen:** {requirements_frozen_at}
- **Development Order Frozen:** {development_order_frozen_at}

### Quality Metrics
- **BE Test Coverage:** {coverage}%
- **FE Lighthouse Performance:** {score}
- **FE Lighthouse Accessibility:** {score}
- **FE Lighthouse Best Practices:** {score}
- **Bundle Size:** {size}KB
- **API Endpoints:** {N} implemented, {M} contract-compliant
- **E2E Tests:** {N} pass, {F} fail
- **Cross-Browser:** {B} browsers supported
- **Security Checks:** {S}/{S} pass

### Change Requests
- **Total CRs Filed:** {count}
- **Blocking CRs:** {count}
- **Non-Blocking CRs:** {count}
- **CRs Resolved:** {count}

### Story Completion
- **Stories Completed:** {completed}/{total}
- **Stories Blocked by Dependency:** {blocked}
- **Stories Skipped:** {skipped}
- **Acceptance Gates Passed:** CODE_ACCEPTANCE, UI_ACCEPTANCE, FEATURE_ACCEPTANCE
```

### 2.2 Qualitative Data Collection

Ask the user to reflect:

> "Let's gather qualitative feedback. For each phase of the workflow, consider:"
>
> "1. **What went well?** — Processes, artifacts, decisions that worked smoothly"
> "2. **What was challenging?** — Bottlenecks, confusion, rework"
> "3. **What surprised you?** — Unexpected outcomes, discoveries, learnings"
> "4. **What would you do differently?** — Changes for the next project"

Collect feedback for each phase:

```
Phase 1 (Analysis):
  Went well: ...
  Challenging: ...
  Surprises: ...
  Do differently: ...

Phase 2 (Planning):
  Went well: ...
  Challenging: ...
  Surprises: ...
  Do differently: ...

Phase 3 (Solutioning):
  Went well: ...
  Challenging: ...
  Surprises: ...
  Do differently: ...

Phase 4 (Implementation):
  Went well: ...
  Challenging: ...
  Surprises: ...
  Do differently: ...
```

Transition: `IN_PROGRESS` → `DATA_COLLECTED`.

---

## Step 3: Analyze and Document Insights

Synthesize the collected data into structured insights.

### 3.1 What Worked Well

Identify patterns of success:

```markdown
## What Worked Well

1. **{Category}:** {Description}
   - Impact: {How this contributed to project success}
   - Example: {Specific instance}

2. **{Category}:** {Description}
   - Impact: {How this contributed to project success}
   - Example: {Specific instance}
```

Categories may include: requirements clarity, architecture decisions, API contract enforcement, parallel development, acceptance gates, story design quality, sprint planning accuracy, etc.

### 3.2 What Could Be Improved

Identify patterns of friction:

```markdown
## What Could Be Improved

1. **{Category}:** {Description}
   - Impact: {How this affected the project}
   - Severity: {high/medium/low}
   - Root Cause: {Underlying reason}

2. **{Category}:** {Description}
   - Impact: {How this affected the project}
   - Severity: {high/medium/low}
   - Root Cause: {Underlying reason}
```

### 3.3 Workflow-Specific Insights

Analyze the web-dev-flow workflow itself:

```markdown
## Workflow Insights

### Process Efficiency
- **Time spent in each phase:** Analysis {A}%, Planning {P}%, Solutioning {S}%, Implementation {I}%
- **Most time-consuming sub-phase:** {name}
- **Most rework-prone artifact:** {name}
- **Most valuable sub-phase (user feedback):** {name}
- **Least valuable sub-phase:** {name}

### Acceptance Gate Effectiveness
- **CODE_ACCEPTANCE:** {assessment} — caught {N} issues, missed {M}
- **UI_ACCEPTANCE:** {assessment} — caught {N} issues, missed {M}
- **FEATURE_ACCEPTANCE:** {assessment} — caught {N} issues, missed {M}

### Automation Effectiveness
- **Auto-continue reliability:** {assessment}
- **Manual interventions needed:** {N} times
- **Gate card false positives:** {N}
- **Gate card false negatives:** {N}
```

Transition: `DATA_COLLECTED` → `INSIGHTS_DOCUMENTED`.

---

## Step 4: Define Action Items

Convert insights into concrete, actionable improvements:

```markdown
## Action Items

### Process Improvements
| ID | Action | Priority | Owner | Target | Justification |
|----|--------|----------|-------|--------|---------------|
| AI-01 | {Action description} | P0/P1/P2 | {Owner} | {Target completion} | {Which insight this addresses} |
| AI-02 | {Action description} | P0/P1/P2 | {Owner} | {Target completion} | {Which insight this addresses} |

### Template & Artifact Improvements
| ID | Action | Priority | Owner | Target | Justification |
|----|--------|----------|-------|--------|---------------|
| AI-03 | Update {template} to include {change} | P0/P1/P2 | {Owner} | {Target} | {Reason} |

### Workflow Improvements
| ID | Action | Priority | Owner | Target | Justification |
|----|--------|----------|-------|--------|---------------|
| AI-04 | Adjust {sub-phase} to {change} | P0/P1/P2 | {Owner} | {Target} | {Reason} |

### Tooling Improvements
| ID | Action | Priority | Owner | Target | Justification |
|----|--------|----------|-------|--------|---------------|
| AI-05 | Add {tool/script} for {purpose} | P0/P1/P2 | {Owner} | {Target} | {Reason} |
```

Priority definitions:
- **P0** — Must fix before next project (affects quality or efficiency significantly)
- **P1** — Should fix within 2 projects (important improvement)
- **P2** — Nice to have (consider when opportunity arises)

Transition: `INSIGHTS_DOCUMENTED` → `ACTION_ITEMS_DEFINED`.

---

## Step 5: Generate Retrospective Report

Produce `{retrospective_output}` (typically `_wdf_output/retrospective-report.md`) with frontmatter:

```yaml
---
artifact_type: "retrospective"
artifact_id: "{project}-retrospective-v1"
phase: 4
sub_phase: "4.14"
status: "draft"
version: "3.6.0"
project_started_at: "{ISO}"
project_completed_at: "{ISO}"
created_at: "{ISO_TIMESTAMP}"
---
```

Report structure:

```markdown
# Retrospective: {project_name}

## Executive Summary
{2-3 paragraph summary of key takeaways}

## Project Overview
- **Duration:** {days} days ({start_date} to {end_date})
- **Stories:** {completed}/{total} completed
- **Acceptance Gates:** CODE_ACCEPTANCE, UI_ACCEPTANCE, FEATURE_ACCEPTANCE achieved

## Quantitative Results
{Project metrics from Step 2.1}

## What Worked Well
{Insights from Step 3.1}

## What Could Be Improved
{Insights from Step 3.2}

## Workflow-Specific Analysis
{Insights from Step 3.3}

## Action Items
{Action items from Step 4}

## Lessons Learned
{Key lessons for future projects}

## Appendix: Data Sources
- sprint-status.yaml
- Integration Report: {integration_output}
- BE Code Acceptance Report: {be_code_acceptance_report}
- FE UI Acceptance Report: {fe_ui_acceptance_report}
```

---

## Step 6: Review and Verify

Present the retrospective to the user:

> "### Retrospective Complete"
>
> "**What Worked Well:** {N} areas identified"
> "**What Could Be Improved:** {M} areas identified"
> "**Action Items:** {K} defined (P0: {p0_count}, P1: {p1_count}, P2: {p2_count})"
>
> "**Key Takeaway:** {top insight}"
>
> "The full retrospective is at `{retrospective_output}`."
>
> "Does this accurately capture the project learnings? [Approve / Revise]"

**Revise:** Return to Step 3 or 4 for edits.

**Approve:** Transition `ACTION_ITEMS_DEFINED` → `VERIFIED`.

---

## Step 7: Lock Retrospective

Update retrospective output frontmatter:

```yaml
status: "locked"
approved_at: "{ISO_TIMESTAMP}"
locked_at: "{ISO_TIMESTAMP}"
```

Transition: `VERIFIED` → `LOCKED`.

Update `{sprint_tracking}`:

```yaml
global_state:
  overall_status: "complete"
  project_completed_at: "{ISO_TIMESTAMP}"

phases:
  phase_4:
    substates:
      phase_4_14:
        status: "LOCKED"
        state_history:
          - { state: "NOT_STARTED", at: "{ISO}" }
          - { state: "IN_PROGRESS", at: "{ISO}" }
          - { state: "DATA_COLLECTED", at: "{ISO}" }
          - { state: "INSIGHTS_DOCUMENTED", at: "{ISO}" }
          - { state: "ACTION_ITEMS_DEFINED", at: "{ISO}" }
          - { state: "VERIFIED", at: "{ISO}" }
          - { state: "LOCKED", at: "{ISO}" }
        artifacts:
          - { type: "retrospective", path: "{retrospective_output}", status: "locked" }
        insights:
          what_worked_well: {count}
          what_could_improve: {count}
          action_items:
            total: {K}
            p0: {p0_count}
            p1: {p1_count}
            p2: {p2_count}
        gate_card:
          all_pass: true
```

---

## Step 8: Completion

Present final project summary:

> "### Web Development Workflow Complete"
>
> "All phases are complete for **{PROJECT_NAME}**."
>
> "---"
>
> "### Project Summary"
> "| Phase | Status | Key Artifacts |"
> "|-------|--------|---------------|"
> "| 1. Analysis | LOCKED | `{brainstorm_output}`, `{domain_research_output}`, `{product_brief_output}` |"
> "| 2. Planning | LOCKED | `{prd_output}`, UX design artifacts |"
> "| 3. Solutioning | LOCKED | `{architecture_output}`, `{epics_output}`, `{stories_output}/`, `{api_spec_output}`, `{db_schema_output}` |"
> "| 4. Implementation | LOCKED | {N} stories implemented, CODE_ACCEPTANCE, UI_ACCEPTANCE, FEATURE_ACCEPTANCE |"
>
> "---"
>
> "### Acceptance Gates"
> "| Gate | Status | Details |"
> "|------|--------|---------|"
> "| CODE_ACCEPTANCE | PASS | {test_coverage}%, {lint} lint, {type_check} type check |"
> "| UI_ACCEPTANCE | PASS | Lighthouse {perf}/{a11y}/{bp}, bundle {size}KB |"
> "| FEATURE_ACCEPTANCE | PASS | Contract verified, {M} E2E journeys, {B} browsers |"
>
> "---"
>
> "### Retrospective"
> "**Action Items:** {K} defined for next project"
> "**Top Lesson:** {top_insight}"
> "**Report:** `{retrospective_output}`"
>
> "---"
>
> "The project is complete. All artifacts are locked. The retrospective captures learnings for continuous improvement."
>
> "Thank you for using web-dev-flow V3.0!"

Return to the main menu (all phases complete).
