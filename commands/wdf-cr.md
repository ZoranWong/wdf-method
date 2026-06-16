---
name: wdf-cr
description: Manage Change Requests for upstream artifact modifications.
argument-hint: "list | create"
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

## Full Spec

See `SKILL.md` section "## Change Request Management" and `schemas/change-request-schema.yaml`.

## Example

```
/wdf-cr list          — Show all open change requests
/wdf-cr create        — Create a new change request for a frozen artifact
```
