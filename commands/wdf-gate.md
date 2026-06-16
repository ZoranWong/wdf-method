---
name: wdf-gate
description: Check a specific phase gate card to see if the phase is ready to enter.
argument-hint: "N (1-4)"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Enter Phase"
    command: /wdf-start
    prompt: "Enter the phase now that gate has passed"
  - label: "Jump to Phase"
    command: /wdf-phase
    prompt: "View detailed phase status"
scripts:
  sh: "echo 'wdf-method gate — evaluating checks'"
---

# /wdf-gate — Check Phase Gate

Evaluate a specific phase Gate Card to determine if the phase is ready to enter. Displays check-by-check results.

## Pre-Execution Checks

**Check for gate card files:**
- Verify `{skill-root}/references/gate-cards/phase-0N-gate.md` exists for the target phase
- If missing: gate cards not generated — run the prior phase first
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_gate` hooks

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md`
2. **Parse arguments**: `/wdf-gate N` where N is 1-4
3. **Load gate card**: Read `{skill-root}/references/gate-cards/phase-0N-gate.md`
4. **Evaluate each check**:
   - For `artifact_exists`: verify file exists
   - For `artifact_metadata`: verify frontmatter field values
   - For `dependency_status`: verify prior phase is LOCKED
   - For `user_confirmation` in auto-mode: evaluate auto alternative
5. **Display results**:
   - Each check ID, description, and pass/fail status
   - If ALL pass: "Gate PASSED — ready to enter Phase N"
   - If ANY fail: "Gate FAILED — {N} check(s) blocking"
6. **Optionally enter**: If all pass, ask if user wants to enter now

## Full Spec

See `SKILL.md` section "## Gate Card System" and `schemas/gate-card-schema.yaml`.

## Example

```
/wdf-gate 3    — Check if Phase 3 (Solutioning) gate passes
/wdf-gate 4    — Check if Phase 4 (Implementation) gate passes
```
