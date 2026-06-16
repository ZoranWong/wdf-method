---
name: wdf-start
description: Start or resume the current phase of the wdf-method workflow. Evaluates Gate Card and enters phase execution.
argument-hint: "[auto] | [phase N]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show the project status dashboard"
  - label: "Check Phase Gate"
    command: /wdf-gate
    prompt: "Check the gate card for the current phase"
  - label: "Jump to Phase"
    command: /wdf-phase
    prompt: "Jump to a specific phase"
  - label: "Pause Workflow"
    command: /wdf-pause
    prompt: "Gracefully pause the workflow"
  - label: "Retry Gate Check"
    command: /wdf-start
    prompt: "Re-evaluate the gate card and retry"
scripts:
  sh: "echo 'wdf-method start — evaluating gate'"
---

# /wdf-start — Start/Resume Current Phase

Start or resume the current phase. Evaluates the Gate Card and enters the execution loop. This is the primary "go" command.

## Pre-Execution Checks

**Check for paused workflow:**
- Read `status/global.yaml` and check `pause_requested`
- If `pause_requested` is true: display pause point and suggest `/wdf-resume` instead
- If `overall_status` is `"paused"`: redirect to `/wdf-resume`

**Check for blocking CRs:**
- Read `status/change-requests.yaml` and check for `severity: blocking` CRs
- If blocking CRs exist: display them and halt. Must resolve CR before proceeding.

**Check for status directory:**
- Verify `status/global.yaml` exists
- If missing: suggest `/wdf-init` to bootstrap the project

**Check for extension hooks (before_start):**
- Check if `.wdf/extensions.yml` exists in the project root
- If it exists, read `hooks.before_wdf_start` entries
- Execute mandatory hooks, present optional hooks

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md` and `{skill-root}/customize.toml`
2. **Detect state**: Read `status/global.yaml` and current phase file to determine:
   - `overall_status` and `current_phase`
   - Current phase FSM state
   - Any open blockers or CRs
   - `task_triage_mode` (light / serial / parallel)
3. **Mode-aware routing**:
   - If `task_triage_mode` is `serial` or `parallel` → skip Main Menu, enter auto-run loop
   - If `task_triage_mode` is `light` → skip Phases 1-3, enter simplified implementation
   - Otherwise → present Main Menu with numbered options
4. **Evaluate Gate Card**: Load `{skill-root}/references/gate-cards/phase-0N-gate.md` for the current phase
   - If any blocking check fails: present failures with recovery options (fix & retry, override, or file CR)
   - If all pass (or auto-mode): proceed to phase entry
5. **Enter phase**: Execute the phase per SKILL.md — present sub-phase menu or dispatch next sub-agent
6. **Auto-run**: If `task_triage_mode` is serial/parallel:
   - Auto-progress through phases without user prompts (see Auto-Run Mode section)
   - Halt only on gate failures, story errors, merge conflicts, or blocking CRs

## Failure Recovery

If a gate check fails:
- **Retry**: Fix the issue and run `/wdf-start` again
- **Override gate**: Use `/wdf-gate` to force-evaluate a specific gate
- **File CR**: If artifact needs upstream fix, use `/wdf-cr create`

## Full Spec

See `SKILL.md` section "## On Activation > Step 1-7" for the complete phase execution protocol, and "## Auto-Run Mode" for hands-free execution.

## Example

```
/wdf-start              — Start/resume current phase
/wdf-start auto         — Force auto-run mode (skip menus)
/wdf-start 3            — Start Phase 3 directly
```
