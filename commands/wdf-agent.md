---
name: wdf-agent
description: View and manage sub-agents, dispatch agents manually, or check agent status.
argument-hint: "status | dispatch"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show project status with agent states"
  - label: "Start Phase"
    command: /wdf-start
    prompt: "Resume phase execution with agents"
scripts:
  sh: |
    cd "$WDF_PROJECT_ROOT"
    SUBCMD="${1:-status}"
    case "$SUBCMD" in
      status|dispatch|list)
        node "$WDF_SKILL_ROOT/orchestrator/bin/wdf.js" agent "$SUBCMD" "${@:2}"
        ;;
      *)
        echo "Usage: /wdf-agent [status|dispatch]"
        echo "  status    Show sub-agent states (default)"
        echo "  dispatch  Manually dispatch an agent"
        exit 1
        ;;
    esac
---

# /wdf-agent — Agent Management

View active sub-agents, manually dispatch an agent, or check agent communication status.

## Pre-Execution Checks

**Check for signal directory:**
- Verify `/tmp/wdf-method/signals/` exists
- If missing: agent communication not initialized — run `wdf-method install`
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_agent` hooks

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md`
2. **Parse arguments**:
   - `/wdf-agent status` — Show active agents and their states
   - `/wdf-agent dispatch` — Manually dispatch an agent to a sub-phase or story
3. **Status flow**:
   - Check `/tmp/wdf-method/signals/` for active agent signals
   - Read per-story status files for IN_PROGRESS stories
   - Display: Agent ID, role, current sub-phase/story, status, worktree branch
4. **Dispatch flow**:
   - Ask: which sub-phase or story to dispatch?
   - Load agent definition from `{skill-root}/references/agents/{role}.md`
   - Load prompt template from `{skill-root}/references/prompt-templates/phase-0N-prompts.md`
   - Dispatch sub-agent with a clean context window (no inherited conversation state)

## Example

```
/wdf-agent status        — Show all active agents
/wdf-agent dispatch      — Manually dispatch an agent to a story
```
