---
name: wdf-init
description: Initialize a new web development project with the wdf-method workflow.
argument-hint: "[project description]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Start Phase 1"
    command: /wdf-start
    prompt: "Evaluate Phase 1 gate card and enter the current phase"
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show the project status dashboard"
  - label: "Jump to Phase"
    command: /wdf-phase
    prompt: "Jump to a specific phase"
scripts:
  sh: "echo 'wdf-method init — project bootstrap'"
---

# /wdf-init — Initialize Project

Initialize a new web project using the wdf-method workflow. Bootstraps the complete project structure including status directory, complexity classification, and phase configuration.

## Pre-Execution Checks

**Check for existing workflow:**
- Verify `status/global.yaml` does NOT already exist
- If it exists: warn "Project already initialized" and suggest `/wdf-status`
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_init` hooks

**Check for prerequisite tools:**
- Verify git is available (`git --version`)
- Verify node is available (`node --version`)

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md` and `{skill-root}/customize.toml`
2. **Ask for project description**: "Describe your project in one sentence."
3. **Classify complexity**: Based on the description, classify as simple/standard/complex per SKILL.md Init Command section
4. **Present recommendation**: Show recommended sub-phases, mode, and estimated time
5. **Bootstrap status/ directory**: Create the complete structure:
   - `status/global.yaml` — global state with defaults from customize.toml
   - `status/phase-01.yaml` through `status/phase-03.yaml` — phase files (NOT_STARTED)
   - `status/phase-04-be.yaml` + `status/phase-04-fe.yaml` — track files (NOT_STARTED)
   - `status/change-requests.yaml` — empty CR list
   - `status/merge-queue/` — empty queue directory
   - `status/stories/` — empty stories directory
6. **Rebuild sprint-status.yaml**: Generate the derived index from status/ files
7. **Display dashboard**: Show initial status and present next step

## Full Spec

See `SKILL.md` section "## Commands > Init Command (V3.6)" for complexity classification table, auto-configuration, and bootstrap sub-agent dispatch.

## Example

```
/wdf-init
> "Start a new web project — a team task management dashboard with React + Express + PostgreSQL"
```
