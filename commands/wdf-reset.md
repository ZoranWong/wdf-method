---
name: wdf-reset
description: Recover a FAIL story to NOT_STARTED — the only path out of the terminal FAIL state.
argument-hint: "--story=<id> --force [--dry-run] [--restore-git] [--json]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Re-dispatch"
    command: /wdf-loop
    prompt: "Pipeline reset — re-dispatch the recovered story"
scripts:
  sh: "echo 'wdf-method reset — invoke via wdf CLI directly'"
---

# /wdf-reset — FAIL State Recovery

The **only** path from `FAIL` back to `NOT_STARTED`. FAIL is terminal — once a story hits it (either via `wdf escalate --reject` or escalation-hold timeout), it stays there until a human runs this command.

## Why It Exists

V3.9 introduced the FAIL terminal state to make "failure closure" real:
- `PIPELINE_ESCALATED` is the "awaiting human review" window (default 24h).
- If the human never shows up, the story auto-promotes to FAIL.
- FAIL is recoverable ONLY via this command — never silently via the FSM.

## Pre-Execution Checks

1. **Project initialized?** `_wdf_output/sprint-status.yaml` must exist.
2. **Story in FAIL state?** `wdf reset` refuses to operate on any other status. To recover from `PIPELINE_ESCALATED`, use `wdf escalate --resolve`.
3. **`--force` flag present?** Required — reset is destructive (clears pipeline context, optionally git reset).

## Usage

```bash
# Show plan without changes
wdf reset --story=story-005 --force --dry-run

# Recover (FSM only — code untouched)
wdf reset --story=story-005 --force

# Recover + L3 git reset (discards uncommitted work)
wdf reset --story=story-005 --force --restore-git

# Machine-readable output
wdf reset --story=story-005 --force --json
```

## What It Does

1. **FSM validation** — calls `validateStateTransition('FAIL', 'NOT_STARTED', { metadata: { reset: true } })`. Aborts if rejected (shouldn't happen — surfaces drift).
2. **Archive ESCALATED.json** — moves `_wdf_output/.dispatch/pipeline/<id>/ESCALATED.json` → `ESCALATED.json.archived-<timestamp>` for audit trail.
3. **Pipeline re-init** — `pipeline = initPipelineContext()` (stage='dev', attempt=1, total_retries=0).
4. **Status write** — `status: 'NOT_STARTED'`, `completed_at: undefined`, `bmad_story_state: 'ready-for-dev'`.
5. **Audit log** — writes `pipeline_reset` event to `_wdf_output/audit/<date>.jsonl`.
6. **Optional L3 git reset** — only when `--restore-git` is passed; resets to HEAD with snapshot backup.

## After Reset

```
✅ story-005: FAIL → NOT_STARTED
   ESCALATED.json archived → _wdf_output/.dispatch/pipeline/story-005/ESCALATED.json.archived-1735000000000
   Run `wdf loop` to redispatch.
```

## Full Spec

See `orchestrator/src/orchestrator/index.ts` → `runResetCommand()` and `orchestrator/src/orchestrator/fsm-engine.ts` → `validateStateTransition` for the metadata-gated FAIL→NOT_STARTED rule.
