---
name: wdf-loop
description: Automatic dispatch loop for Phase 4. Evaluates all stories and returns the next dispatch action, then loops until all stories are complete.
argument-hint: "[--human] | [--post-dispatch --story=<id> --stage=<stage>]"
platforms: [claude]
handoffs:
  - label: "Manual Start"
    command: /wdf-start
    prompt: "Fall back to manual dispatch mode"
  - label: "Check Status"
    command: /wdf-status
    prompt: "Show the full project dashboard"
scripts:
  sh: "echo 'wdf-method loop — automatic dispatch protocol'"
---

# /wdf-loop — Automatic Dispatch Loop

The "半自动 → 全自动" switch. Instead of manually calling `/wdf start` after each agent completes, enter a tight dispatch-next loop that automatically evaluates and dispatches until all stories are done.

## How It Works

```
┌─── /wdf loop ───────────────────────────────────────────────────┐
│                                                                   │
│  1. CLI evaluates ALL stories' pipeline states                    │
│  2. Returns ONE structured action:                                │
│     ├─ dispatch  → Agent tool (role from manifest)                │
│     ├─ escalation → Human review required                        │
│     ├─ blocked    → Wait for dependencies                        │
│     └─ complete   → Phase 4 done                                 │
│  3. After agent returns:                                         │
│     wdf loop --post-dispatch --story=<id> --stage=<stage>        │
│  4. Repeat until 'complete' or 'escalation'                      │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Claude Agent Protocol

When you invoke `/wdf loop`, follow this protocol:

### Step 1: Get next action

```bash
wdf loop --json
```

Parse the JSON output. The `action.kind` field determines what to do.

### Step 2: Execute the action

#### If `action.kind === 'dispatch'`:

1. Read `action.manifest_path` for the full dispatch manifest
2. **Permission injection is automatic** (the CLI already wrote to settings.local.json)
3. Use the Agent tool to dispatch a sub-agent:
   - **description**: `"wdf ${action.role}: ${action.story_id}"`
   - **prompt**: Use `action.manifest.prompt` verbatim
   - The sub-agent inherits the injected permissions from the host
4. Wait for the sub-agent to complete
5. Read the result and proceed to Step 3

#### If `action.kind === 'escalation'`:

1. Display the escalation details to the user
2. Ask for human review and decision
3. Do NOT auto-dispatch further — wait for user instruction

#### If `action.kind === 'blocked'`:

1. Display which stories are blocking
2. If blocking stories are on a different track, dispatch them first
3. Otherwise, report and wait

#### If `action.kind === 'complete'`:

1. Display the summary
2. Run `/wdf start` to proceed to the next phase

### Step 3: Post-dispatch

After the sub-agent returns (success or failure):

```bash
wdf loop --post-dispatch --story=<story_id> --stage=<stage> --json
```

This revokes the permissions for the completed dispatch and returns the next action. Go back to Step 2.

### Step 4: Loop exit conditions

Exit the loop when:
- `action.kind === 'complete'` — all stories processed
- `action.kind === 'escalation'` — needs human intervention
- User interrupts with a different command

## V3 Three-Layer Permission Flow

The loop engine automatically handles permission injection/revocation:

```
evaluateNextLoopAction()
  ├─ applyRolePermissions(role, story_id, stage)   ← writes to settings.local.json
  └─ returns manifest with permissions_applied: true

After agent completes:
postDispatchNext()
  └─ revokePermissions(story_id, stage)            ← cleans up settings.local.json
```

The sub-agent inherits permissions from the host process — no per-step prompts needed.

## Example

```
$ wdf loop --json
{
  "action": {
    "kind": "dispatch",
    "story_id": "S-AUTH-01",
    "title": "User Registration",
    "track": "backend",
    "stage": "dev",
    "attempt": 1,
    "role": "backend-developer",
    "manifest_path": "_wdf_output/.dispatch/pipeline/S-AUTH-01/dev.json",
    "remaining": 7,
    "permissions_applied": true
  },
  "pipeline_snapshot": [
    { "story_id": "S-DB-01", "status": "MERGED", "stage": "qa", "is_next": false },
    { "story_id": "S-AUTH-01", "status": "IN_PROGRESS", "stage": "dev", "is_next": true },
    ...
  ]
}

→ Claude dispatches Agent tool with backend-developer role
→ Sub-agent completes
→ Claude calls: wdf loop --post-dispatch --story=S-AUTH-01 --stage=dev --json
→ CLI revokes permissions, returns next action (S-AUTH-01 review stage, or next story)
→ Repeat...
```

## Error Handling

- **Permission injection failure**: Non-fatal, logged as `permissions_applied: false`
- **Missing sprint status**: Exits with error, suggests `wdf init`
- **All stories blocked**: Reports blocking dependencies, suggests dispatching blocking stories first

## See Also

- `commands/wdf-start.md` — Manual dispatch mode
- `commands/wdf-permissions.md` — V3 three-layer permission model
- `orchestrator/src/orchestrator/dispatch-loop-engine.ts` — Engine implementation
