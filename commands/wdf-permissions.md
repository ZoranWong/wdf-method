---
name: wdf-permissions
description: Manage dispatch-permission injection into host .claude/settings.local.json so sub-agents run without per-step prompts.
argument-hint: "list | apply <manifest.json> | revoke <story_id> <stage> | purge"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Start Pipeline"
    command: /wdf-start
    prompt: "Resume pipeline dispatch"
  - label: "Project Status"
    command: /wdf-status
    prompt: "Show project status"
scripts:
  sh: "echo 'wdf-method permissions — manage dispatch permission injection'"
---

# /wdf-permissions — Dispatch Permission Injection

## Three-layer permission model (V3)

Each sub-agent dispatch resolves to a **union** of three sources, narrowest first:

1. **Role baseline** — declared in each `references/agents/<role>.md` file via `default_permissions` YAML frontmatter. Reflects what the role *always* needs (e.g. `backend-developer` always needs `npm test`, `npx tsc`, etc.). Falls back to `ROLE_BASELINE_FALLBACK` in `permission-injector.ts` if the agent file is missing or has no frontmatter.
2. **Story inference** — derived at dispatch time from the story's `acceptance_check` entries (model-side, see Mode A below). Captures what *this particular story* needs beyond the baseline (e.g. `npx playwright test auth.e2e.ts` for an auth-flow story).
3. **Tech stack widening** — optional, when the story touches infrastructure mentioned in `architecture.md` (e.g. docker compose, redis-cli). The model adds these as needed.

The parent session's model is the brain. It reads the story file, resolves the role baseline via `readRolePermissions`, infers story-specific extras via Mode A, and unions all three into the final `DispatchPermissions` block. Pre-approved `bash_deny` (`git push`, `rm -rf`, `docker push`) are enforced on every layer.

## Two operating modes

### Mode A (recommended): Model-driven inference

The **parent Claude session** is the brain. When about to dispatch a sub-agent, it reads the story file (scope_write, acceptance_check, maps_to_req) and *infers* the minimal permission set the sub-agent needs — then unions with the role baseline, injects via `applyPermissions`, dispatches, and revokes on completion.

```
parent session at dispatch time:
  1. read story → scope_write + acceptance_check + maps_to_req + tech stack
  2. resolve role baseline via readRolePermissions(role, frameworkRoot)
  3. INFERENCE (model-side, not lookup):
       acceptance_check "npm test X"     → Bash(npm test:*)
       acceptance_check "npx vitest ..."  → Bash(npx vitest:*)
       scope_write ["backend/src/auth.ts"] → Edit/Write(backend/src/auth.ts)
       maps_to_req REQ-007 (cross-user)   → no extra bash, repo logic only
       tech stack uses docker             → Bash(docker compose:*), deny Bash(docker push:*)
       NEVER grant                         → Bash(git push:*), Bash(rm -rf:*)
  4. union(role_baseline, story_inference, tech_stack_widen) → DispatchPermissions
  5. applyPermissions(manifest, projectRoot)
  6. Agent tool dispatch (sub-agent inherits host's newly-injected permissions)
  7. on sub-agent return: revokePermissions(story_id, stage, projectRoot)
```

This mode requires no static `permissions` block in the story file. The model derives what's needed. **This is the default for V3.9+.**

### Mode B (fallback / audit): Manifest-driven

For deterministic CI runs or environments without an LLM in the loop, stories may carry an explicit `permissions` block in their dispatch manifest. `wdf permissions apply <manifest.json>` injects as-is, *bypassing* the role baseline union. Use this when you need byte-exact audit trails of what was granted.

---

## Why this exists

**Problem.** The Claude Code `Agent` tool has no inline `permissions` parameter — a sub-agent inherits the host session's permission set. Without pre-population, every `npm test` / `npx vitest` / file write inside a sub-agent triggers a permission prompt, breaking the autonomous dispatch loop.

**Solution.** wdf-method attaches a `permissions` block to every `PipelineDispatchManifest`. The `permission-injector` writes tagged entries into the host project's `.claude/settings.local.json` before the parent session invokes Agent tool. Entries are tagged `# wdf-dispatch:<story_id>:<stage>` so they can be removed precisely after the story closes.

## When this runs

The intended call-site is **`pipeline-runner`**: when it writes a dispatch manifest, it should immediately call `applyPermissions(manifest, projectRoot)` so the host session picks up the new allow/deny entries before the next `Agent` tool call.

For manual use, the CLI is the entry point:

```bash
wdf permissions list                          # show currently injected entries
wdf permissions apply <manifest.json>         # inject from a manifest
wdf permissions revoke <story_id> <stage>     # clean up after a story stage closes
wdf permissions purge                         # nuclear: remove every wdf-dispatch entry
```

## Manifest `permissions` block

Defined in `orchestrator/src/orchestrator/types.ts`. Example:

```json
{
  "type": "pipeline_dispatch",
  "story_id": "S-AUTH-01",
  "stage": "dev",
  "scope_write": ["backend/src/auth.ts", "backend/test/auth.test.ts"],
  "permissions": {
    "bash_allow": ["npm test", "npx vitest", "npm run migrate:up"],
    "bash_deny": ["git push", "rm -rf"],
    "scope_read": ["backend/_wdf_output/**"]
  }
}
```

## Translation rules

| Manifest field | Translated to |
|---|---|
| `bash_allow[i] = "npm test"` | `Bash(npm test:*)` in `permissions.allow` |
| `bash_allow[i] = "npm"` (bare) | `Bash(npm:*)` (matches all npm subcommands) |
| `bash_deny[i] = "git push"` | `Bash(git push:*)` in `permissions.deny` |
| `scope_write[i] = "backend/src/**"` | `Edit(backend/src/**)` + `Write(backend/src/**)` |
| `scope_read[i] = "docs/**"` | `Read(docs/**)` |

Every entry is suffixed with `  # wdf-dispatch:<story_id>:<stage>` so `revoke` and `purge` can identify them.

## Safety guarantees

- **Never touches user-level `~/.claude/settings.json`.** All writes go to `<projectRoot>/.claude/settings.local.json`.
- **Idempotent.** Re-applying the same `(story_id, stage)` replaces, never duplicates.
- **Preserves pre-existing entries.** Untagged `allow`/`deny` lines from other tools survive.
- **Atomic JSON.** Read-modify-write with `JSON.stringify(parsed, null, 2)`; corrupt source is treated as empty rather than clobbered.
- **Audit-friendly.** `wdf permissions list` shows every injected entry with its story/stage origin.

## CLI examples

```bash
# After pipeline-runner writes .dispatch/pipeline/S-AUTH-01/dev.json:
wdf permissions apply .dispatch/pipeline/S-AUTH-01/dev.json

# After the story's review report comes back PASS:
wdf permissions revoke S-AUTH-01 dev

# End of sprint cleanup:
wdf permissions purge
```

## Integration with pipeline-runner (planned)

`pipeline-runner.ts` writes the manifest via `writePipelineManifest(manifest, outputDir)`. The intended follow-up (blocked on `pipeline-engine.ts` being restored to the tree) is to call:

```ts
import { applyPermissions } from './permission-injector.js';
// after writePipelineManifest(...)
applyPermissions(manifest, projectRoot);
```

and to call `revokePermissions(story_id, stage, projectRoot)` once the next-stage report reads PASS. Until that integration lands, use the CLI subcommands.

## Related

- `references/fsm-states.md` — `CONVERGING` and `IN_PIPELINE_*` states
- `orchestrator/src/orchestrator/permission-injector.ts` — engine (27 unit tests, 3-layer model)
- `orchestrator/src/orchestrator/types.ts` — `DispatchPermissions` / `PipelineDispatchManifest` schema
- `commands/wdf-start.md` — pipeline dispatch loop
- `references/agents/*.md` — role baseline declarations (`default_permissions` frontmatter)
