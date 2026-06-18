---
name: wdf-cr
description: Manage Change Requests for upstream artifact modifications.
argument-hint: "list | create | apply <id> [--dry-run] [--diff] | archive <id> [--force]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show CR status in dashboard"
  - label: "Freeze Artifact"
    command: /wdf-freeze
    prompt: "Freeze an artifact before modification"
scripts:
  sh: "echo 'wdf-method cr — managing change requests'"
---

# /wdf-cr — Change Request Management

List, create, and manage Change Requests (CRs) for modifying frozen artifacts. CRs can be blocking or non-blocking.

## Pre-Execution Checks

**Check for CR file:**
- Verify `status/change-requests.yaml` exists
- If missing: run `/wdf-init` to bootstrap the project
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_cr` hooks

**Check for frozen artifacts (create flow):**
- Verify the target artifact's freeze timestamp is set
- If not frozen: CR may not be necessary

## Execution

1. **Load spec**: Read `{skill-root}/SKILL.md`
2. **Parse arguments**:
   - `/wdf-cr list` — List all open CRs with status
   - `/wdf-cr create` — Create a new change request
   - `/wdf-cr apply <id>` — Apply `changes/<id>/delta.yaml` to the project
   - `/wdf-cr archive <id>` — Move a merged CR to `changes/_archive/<id>`
3. **List flow**:
   - Read `status/change-requests.yaml`
   - Display each CR: ID, severity, target artifact, description, status
   - Summary: "{N} open ({M} blocking)"
4. **Create flow**:
   - Ask: which frozen artifact needs modification?
   - Ask: what change is needed?
   - Ask: blocking or non-blocking?
   - Create CR entry in `status/change-requests.yaml` per `schemas/change-request-schema.yaml`
   - If blocking: halt current workflow and present blocker notice
5. **Apply flow** (`apply <id>`):
   - Resolve `changes/<id>/delta.yaml`; fail if missing (hint: copy `changes/.template/delta.yaml.example`)
   - Validate against `schemas/change-delta-schema.yaml`
   - Plan all ops in memory; abort the entire delta if any op fails (atomic)
   - With `--dry-run`: print plan summary + unified diff, write nothing
   - With `--diff`: also print unified diff after a real apply
   - On success: report files written/deleted; suggest reviewing `git diff` before committing
6. **Archive flow** (`archive <id>`):
   - Move `changes/<id>/` → `changes/_archive/<id>/` (preserves proposal + delta)
   - Refuse if target already archived unless `--force`
   - Run only after the CR is `IMPLEMENTED` and at least one minor version has shipped

## Full Spec

See `SKILL.md` section "## Change Request Management", `schemas/change-request-schema.yaml`, `schemas/change-delta-schema.yaml`, and `docs/CR-DELTA-WORKFLOW.md`.

## Example

```
/wdf-cr list                          — Show all open change requests
/wdf-cr create                        — Create a new change request for a frozen artifact
/wdf-cr apply CHG-2026-002 --dry-run  — Preview the delta as a unified diff
/wdf-cr apply CHG-2026-002            — Apply the delta atomically
/wdf-cr archive CHG-2026-001          — Archive an implemented CR
```
