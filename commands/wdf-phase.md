---
name: wdf-phase
description: Jump to a specific phase or view detailed phase status.
argument-hint: "N (1-4) or N status"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Start Phase"
    command: /wdf-start
    prompt: "Start the selected phase"
  - label: "Check Gate"
    command: /wdf-gate
    prompt: "Check the gate for this phase"
scripts:
  sh: "echo 'wdf-method phase — checking prerequisites'"
---

# /wdf-phase — Jump to Phase

Jump to a specific phase. Evaluates the Gate Card before entering. Shows detailed status if `status` subcommand is used.

## Pre-Execution Checks

**Check for prior phases:**
- Verify all phases before the target phase are LOCKED
- If not: display which phases need to complete first
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_phase` hooks

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md`
2. **Parse arguments**:
   - `/wdf-phase N` — Jump to phase N (1-4)
   - `/wdf-phase N status` — Show detailed status for phase N
3. **Validate**: Phase must be 1-4. Prior phases must be at least LOCKED to jump forward.
4. **If jumping**:
   - Evaluate Gate Card for target phase
   - If passes: enter phase execution loop
   - If fails: present failing checks
5. **If status**: Display detailed phase status with all sub-phases, FSM state, and artifacts

## Full Spec

See `SKILL.md` section "## Phase Routing" for the phase file architecture and gate card evaluation rules.

## Example

```
/wdf-phase 3          — Enter Phase 3 (Solutioning)
/wdf-phase 3 status   — Show Phase 3 detailed status
```
