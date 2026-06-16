---
name: wdf-freeze
description: Freeze requirements or development order. Once frozen, changes require a Change Request.
argument-hint: "requirements | dev-order"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show project status with freeze timestamps"
  - label: "Create Change Request"
    command: /wdf-cr
    prompt: "Create a change request for a frozen artifact"
scripts:
  sh: "echo 'wdf-method freeze — locking artifact'"
---

# /wdf-freeze — Freeze Requirements or Dev Order

Formally freeze requirements (Phase 2.5) or development order (Phase 3.7). After freeze, any changes require a Change Request.

## Pre-Execution Checks

**Check for target sub-phase:**
- Verify the current phase/sub-phase matches the freeze target
- Requirements freeze: Phase 2.5 must be IN_PROGRESS or later
- Dev order freeze: Phase 3.7 must be IN_PROGRESS or later
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_freeze` hooks

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md`
2. **Parse arguments**:
   - `/wdf-freeze requirements` — Freeze requirements at Phase 2.5
   - `/wdf-freeze dev-order` — Freeze development order at Phase 3.7
3. **Validate prerequisites**:
   - Requirements freeze: Phase 2.5 (PRD) must be IN_PROGRESS or later
   - Dev order freeze: Phase 3.7 (Story Design) must be IN_PROGRESS or later
4. **Execute freeze**:
   - Set `global_state.requirements_frozen_at` or `global_state.development_order_frozen_at` in `status/global.yaml` with ISO timestamp
   - Update the corresponding phase file sub-state
5. **Confirm**: Display confirmation listing what is frozen and that changes now require CR

## Full Spec

See `SKILL.md` section "## Commands > Freeze Commands". Also see `schemas/gate-card-schema.yaml` for freeze timestamp tracking.

## Example

```
/wdf-freeze requirements    — Lock the PRD; new features need CR
/wdf-freeze dev-order       — Lock story sequence; reordering needs CR
```
