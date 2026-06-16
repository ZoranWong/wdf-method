---
name: wdf-resume
description: Unified resume from any pause point, crash, or after completing interactive planning. Auto-detects state and continues correctly.
argument-hint: ""
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Start Phase"
    command: /wdf-start
    prompt: "Resume in interactive mode"
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show resumed project status"
  - label: "Build"
    command: /wdf-build
    prompt: "Return to full pipeline build"
scripts:
  sh: "echo 'wdf-method resume — restoring state'"
---

# /wdf resume — Universal Resume

Unified resume from any pause point, crash, or after completing interactive planning. Auto-detects state and continues correctly.

## Pre-Execution Checks

- Read `status/global.yaml` — check `pause_requested` or `overall_status`
- If no status directory: suggest `/wdf init` or `/wdf build`
- Scan `/tmp/wdf-method/signals/` for orphaned agent signals

## Execution

1. **Load state**: Read all status files to determine exact pause point
2. **Recovery** (if crash): Read each story's `last_completed_substep`, resume from next substep
3. **Clear signals**: Set `pause_requested: false` in `status/global.yaml`
4. **Smart routing**:
   - Phase 1-3 paused → resume in **interactive mode** (present Main Menu or sub-phase prompt)
   - Phase 3.9 complete but Phase 4 not started → present **"Ready to Build?"** confirmation
   - Phase 4 paused → resume in **automated mode** (hands-free auto-run)
   - `/wdf build` context → return to build pipeline

## Example

```
/wdf resume          — Auto-detect state and continue
/wdf build --resume  — Resume a /wdf build pipeline
```
