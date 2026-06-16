---
name: wdf-status
description: Show the current project progress dashboard including phase states and story progress.
argument-hint: ""
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Start Current Phase"
    command: /wdf-start
    prompt: "Start or resume the current phase"
  - label: "Jump to Phase"
    command: /wdf-phase
    prompt: "Jump to a specific phase number"
  - label: "Generate Report"
    command: /wdf-report
    prompt: "Generate a detailed progress report"
scripts:
  sh: "echo 'wdf-method status — reading state'"
---

# /wdf-status — Project Dashboard

Display a concise, real-time status dashboard of the current wdf-method project.

## Pre-Execution Checks

**Check for status directory:**
- Verify `status/global.yaml` exists
- If missing: suggest `/wdf-init` to bootstrap the project
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_status` hooks

**Check for paused workflow:**
- Read `status/global.yaml` and check `pause_requested`
- If paused: flag it prominently in the dashboard

## Execution

1. **Read status files**:
   - `status/global.yaml` — overall status, current phase, freeze timestamps, dev mode
   - `status/phase-01.yaml` through `status/phase-03.yaml` — phase FSM states
   - `status/phase-04-be.yaml` + `status/phase-04-fe.yaml` — Phase 4 track states and stories
   - `status/change-requests.yaml` — open CRs
   - `status/merge-queue/items/` — merge queue entries
2. **Display dashboard** following SKILL.md "Step 5: Present Status Overview" format:
   - Project name, workflow version, overall status, dev mode, triage mode
   - Phase progress bars (e.g., `[████] LOCKED`, `[░░░░] NOT_START`)
   - Blockers and CR summary
   - Merge queue counts (queued, merged, waiting)
3. **If Phase 4 active**: Show per-story detail with BE/FE track progress
4. **If paused**: Show pause point and resume instruction

## Full Spec

See `SKILL.md` section "## Commands > Progress Report Command (V3.3)" for the extended report format.

## Example

```
/wdf-status
```
