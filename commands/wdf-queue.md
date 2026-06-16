---
name: wdf-queue
description: Manage the dependency-ordered merge queue for Phase 4 implementation stories.
argument-hint: "show | retry <story-id> | process"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show merge queue in status"
  - label: "Generate Report"
    command: /wdf-report
    prompt: "Generate a progress report including merge status"
scripts:
  sh: "echo 'wdf-method queue — processing merges'"
---

# /wdf-queue — Merge Queue Management

View and manage the dependency-ordered merge queue. CODE_ACCEPTED stories enter this queue and are merged in dependency order.

## Pre-Execution Checks

**Check for merge queue directory:**
- Verify `status/merge-queue/items/` exists
- If empty: no stories ready for merge — suggest `/wdf-accept`
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_queue` hooks

**Check for merge conflicts:**
- For `retry` command: verify the story's failed merge status
- For `process` command: verify the next story has all deps merged

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md`
2. **Parse arguments**:
   - `/wdf-queue show` — Display the current merge queue
   - `/wdf-queue retry {story-id}` — Retry a failed merge
   - `/wdf-queue process` — Auto-process the next mergeable story
3. **Show flow**:
   - Read all files in `status/merge-queue/items/`
   - Display queue in merge order: merge_order, depends_on, status
   - Summary: "{queued} queued, {merged} merged, {waiting} waiting"
4. **Retry flow**: Reset story's merge status to `queued` and re-attempt
5. **Process flow**: Find next story with all deps merged, execute merge

## Full Spec

See `SKILL.md` section "## Auto-Run Mode > Phase 4 Auto-Run Behavior" and `specs/merge-queue.md`.

## Example

```
/wdf-queue show           — Show current merge queue
/wdf-queue retry S-3.1    — Retry merging story S-3.1
```
