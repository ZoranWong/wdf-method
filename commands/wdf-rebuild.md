---
name: wdf-rebuild
description: Rebuild the sprint-status.yaml derived index from status/ directory source files.
argument-hint: ""
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Verify rebuilt status dashboard"
scripts:
  sh: "echo 'wdf-method rebuild — reconstructing index'"
---

# /wdf-rebuild — Rebuild Status Index

Rebuild `sprint-status.yaml` from the `status/` directory source files. Use when corrupted, missing, or needs verification.

## Pre-Execution Checks

**Check for status directory:**
- Verify `status/` directory exists with source files
- If missing: suggest `/wdf-init` to bootstrap the project
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_rebuild` hooks

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md`
2. **Read all source files**:
   - `status/global.yaml`
   - `status/phase-01.yaml` through `status/phase-03.yaml`
   - `status/phase-04-be.yaml` + `status/phase-04-fe.yaml`
   - `status/change-requests.yaml`
   - `status/stories/*-status.yaml`
3. **Rebuild sprint-status.yaml**:
   - Concatenate global + phase files in order
   - Append story summary entries (id, status, track)
   - Add header: "AUTO-GENERATED — DO NOT EDIT. Rebuilt from status/ files at {timestamp}"
4. **Verify**: Compare rebuilt with existing (if any). Report any differences.
5. **Confirm**: "sprint-status.yaml rebuilt from {N} source files at {timestamp}"

## Full Spec

See `SKILL.md` section "## Commands > Rebuild Status Command (V3.6)".

## Example

```
/wdf-rebuild
```
