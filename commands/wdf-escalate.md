---
name: wdf-escalate
description: Manage PIPELINE_ESCALATED stories — list, resolve, or force-fail them.
argument-hint: "<list|--resolve|--reject> [--story=<id>] [--json]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "After Resolve"
    command: /wdf-loop
    prompt: "Story recovered — re-dispatch"
scripts:
  sh: "echo 'wdf-method escalate — invoke via wdf CLI directly'"
---

# /wdf-escalate — Manual Escalation Control

PIPELINE_ESCALATED is the "human review" state — a story exhausted its retry budget (5 attempts across dev→review→testing→qa) and needs human attention. This command gives the human three explicit actions instead of waiting for the auto-fail timeout.

## Why It Exists

Without manual control, PIPELINE_ESCALATED → FAIL happens automatically after the hold window (default 24h). That's fine when humans are asleep, but during active work you want to:
- See what's escalated and how long it's been waiting (`list`)
- Mark it fixed and re-dispatch immediately (`--resolve`)
- Give up and force-fail without waiting 24h (`--reject`)

## Subcommands

### `wdf escalate list` (default)

Shows all PIPELINE_ESCALATED and FAIL stories with hold-time info:

```
Escalated / Failed stories (hold limit: 24h):

🚨 story-005 [PIPELINE_ESCALATED] — 8h elapsed / 24h limit
     failed stage: review
     reason: Exceeded 5 total retries at stage "review". Last failure: ...
     → `wdf escalate --resolve --story=story-005` to retry
     → `wdf escalate --reject  --story=story-005` to FAIL
⛔ story-012 [FAIL] — 28h elapsed / 24h limit
     failed stage: qa
     reason: QA ACCEPTANCE FAILED.
     → `wdf reset --force --story=story-012` to recover
```

### `wdf escalate --resolve --story=<id>`

Human fixes the issue manually and wants to retry from scratch.

- Transition: `PIPELINE_ESCALATED → IN_PROGRESS`
- Side effects: pipeline context re-initialized (stage='dev', attempts reset)
- Audit: writes `pipeline_reset` event with `recovery: 'manual-resolve'`
- Next: run `wdf loop` to re-dispatch

### `wdf escalate --reject --story=<id>`

Human judges the story unrecoverable and wants to FAIL immediately (bypass hold timeout).

- Transition: `PIPELINE_ESCALATED → FAIL`
- Side effects: `completed_at` set; story is now terminal
- Audit: writes `pipeline_fail` event with `recovery: 'manual-reject'`, `bypass_hold: true`
- Next: only `wdf reset --force` can recover

## Pre-Execution Checks

1. **Project initialized?** `_wdf_output/sprint-status.yaml` must exist.
2. **Story exists?** Searched in both `phase_4_4` (backend) and `phase_4_10` (frontend) sub-phases.
3. **Status matches?** `--resolve`/`--reject` only operate on `PIPELINE_ESCALATED`. For FAIL recovery, use `wdf reset`.

## Example

```bash
# What needs attention?
wdf escalate list

# I fixed it manually — retry
wdf escalate --resolve --story=story-005

# This is unrecoverable — fail it now
wdf escalate --reject --story=story-005
```

## Full Spec

See `orchestrator/src/orchestrator/index.ts` → `runEscalateCommand()` and `escalateTransition()`. Hold-time defaults from `customize.toml` `[pipeline] escalation_hold_hours` (default 24h).
