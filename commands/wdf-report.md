---
name: wdf-report
description: Generate a human-readable progress report with metrics and estimates.
argument-hint: ""
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show live status dashboard"
scripts:
  sh: "echo 'wdf-method report — generating metrics'"
---

# /wdf-report — Progress Report

Generate a comprehensive progress report from all status/ files.

## Pre-Execution Checks

**Check for status directory:**
- Verify `status/` directory exists with source files
- If missing: suggest `/wdf-init` to bootstrap
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_report` hooks

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md`
2. **Read all status files**: global, all phases, all stories, CRs, merge queue
3. **Calculate metrics**:
   - Overall completion percentage
   - Stories CODE_ACCEPTED / total
   - Throughput (stories per day based on timestamps)
   - Estimated completion date
4. **Display report**:

```
Project: {name} | v{version} | {date}
Overall Progress: {percent}% complete
Phase 1: {status}  Phase 2: {status}  Phase 3: {status}  Phase 4: {status}
Stories: {accepted}/{total} CODE_ACCEPTED
  Merged: {N}  In Progress: {N}  Blocked: {N}  Queued: {N}
Blockers: {N}
Merge Queue: {queued} queued | {merged} merged | {waiting} waiting
Throughput: {rate} stories/day
Estimated completion: {date}
Last Activity: {timestamp}
```

## Full Spec

See `SKILL.md` section "## Commands > Progress Report Command (V3.3)".

## Example

```
/wdf-report
```
