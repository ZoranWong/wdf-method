---
name: wdf-pause
description: Pause the workflow gracefully, saving all state for later resume.
argument-hint: ""
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Resume Workflow"
    command: /wdf-resume
    prompt: "Resume from the pause point"
scripts:
  sh: "echo 'wdf-method pause — signaling agents'"
---

# /wdf-pause — Pause Workflow

Gracefully suspend the workflow. Running agents complete their current sub-step, save state, and exit.

## Pre-Execution Checks

**Check for active agents:**
- Scan `/tmp/wdf-method/signals/` for active agent signals
- If no active agents: pause immediately (already idle)
- If active agents: signal them, wait for drain
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_pause` hooks

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md`
2. **Execute pause protocol** (signal-based via /tmp):
   - Write `/tmp/wdf-method/signals/global.json`: `{"action": "pause_all", "issued_at": "<ISO>"}`
   - For each running agent: write `/tmp/wdf-method/signals/main-to-{agentId}.json` with type: "pause"
   - Set `pause_requested: true` and `pause_issued_at` in `status/global.yaml`
3. **Wait for drain**: All agents return PAUSED or CODE_ACCEPTED
4. **Display confirmation**:

```
PAUSED WORKFLOW
Paused at: {phase}.{subphase}
Stories completed: {N}/{total}
Stories paused:    {N}
Resume: /wdf-resume
```

## Full Spec

See `SKILL.md` section "## Commands > Pause Command (V3.6)" and `specs/agent-communication.md`.

## Example

```
/wdf-pause
```
