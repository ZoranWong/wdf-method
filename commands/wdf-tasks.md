---
name: wdf-tasks
description: Summarize tasks.md for cross-session continuity. Read-only — the Claude session owns the file content.
argument-hint: "[--json] [--check] [project-root]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Start next"
    command: /wdf-start
    prompt: "Pick up where tasks.md left off"
scripts:
  sh: "echo 'wdf-method tasks — invoke via wdf CLI directly'"
---

# /wdf-tasks — Cross-Session Continuity

`tasks.md` is the **continuity载体** between Claude sessions. The FSM state files record *what has happened*; tasks.md records *what to do next* in a form a fresh session can pick up immediately.

This command reads tasks.md and prints a summary. It does not write — the Claude session owns the content.

## Why It Exists

After `/clear` or context compaction, a fresh Claude session has no memory of:
- What was being worked on when the previous session ended
- What got blocked and why
- The most recent decision and its rationale

The Claude session writes all of this to tasks.md as it works. `wdf tasks` (and the integrated hints in `wdf start` / `wdf status`) surfaces that content without requiring the user to remember to check.

## Usage

```bash
# Full summary (default)
wdf tasks

# JSON output for tooling / CI integration
wdf tasks --json

# CI gate: fail when open tasks exist
wdf tasks --check

# Point at a different project root
wdf tasks /path/to/project
```

## File Format

Place `tasks.md` at the project root (or `_wdf_output/tasks.md` — both are auto-detected).

```markdown
# Tasks — <project name>

Last updated: 2026-06-22T15:30:00Z
Current phase: 4

## In Progress
- [ ] S-AUTH-01: dev stage — bcrypt register endpoint
  - last: dev-agent dispatched, waiting on agent-result.json
  - next: read review report, advance to testing
- [ ] S-AUTH-02: review stage — login endpoint

## Pending
- [ ] S-TODO-01: CRUD operations
- [ ] S-TODO-02: filter by status

## Done
- [x] 2026-06-22 Phase 3.9 readiness check passed
- [x] 2026-06-22 Phase 3.7 stories written (12 total)
- [x] 2026-06-21 Phase 2.10 design acceptance

## Notes
- 2026-06-22: paused for env refactor; resume from S-AUTH-01 dev stage.
- 2026-06-21: design system tokens locked, don't change.
```

### Section Semantics

| Section | Purpose |
|---------|---------|
| Header (`Last updated:` / `Current phase:`) | Machine-readable metadata, parsed by the summarizer |
| `## In Progress` | What's actively being worked on RIGHT NOW |
| `## Pending` | Queued but not yet started; usually ordered by dependency |
| `## Done` | Completed items, newest at top, with `- [x] YYYY-MM-DD` prefix |
| `## Notes` | Free-form decisions / context — newest at top |

### Sub-pointers under In Progress items

The `- last:` and `- next:` bullets under an In Progress item are the **most useful** part — they tell a fresh session exactly where to resume. The summarizer strips them from headlines but reads them as context.

## Conventions

- **Notes are reverse-chronological** (newest at top). The summarizer takes the first note as `last_note`.
- **Done items are reverse-chronological** too. The summarizer shows the top 5.
- **Pending can be in any order** — usually dependency-sorted.
- **In Progress should be small** (1-3 items). If it grows, demote extras to Pending.

## CI Gate

`wdf tasks --check` exits with code 1 when `open_count > 0`. Use this when your project policy is "no open tasks on master":

```yaml
# .github/workflows/ci.yml
- name: tasks.md gate
  run: wdf tasks --check
```

## Integration With Other Commands

- `wdf start` shows a one-line summary at the end of its output
- `wdf status` includes the same one-liner in its dashboard
- Both commands treat absent tasks.md as a soft state (no warning, no error)

## Adding tasks.md To An Existing Project

```bash
# Create the file
cat > tasks.md <<'EOF'
# Tasks — <project name>

Last updated: <now>
Current phase: <your current phase>

## In Progress
- [ ] (current item)

## Pending
- [ ] (next item)

## Done
- [x] <date> (last completed item)

## Notes
- <date>: <most recent decision>
EOF

# Verify it parses
wdf tasks
```

## Anti-Patterns

- ❌ **Don't let the CLI write tasks.md.** The Claude session owns the content; CLI reads only. This preserves the architectural split (CLI = state, Claude = intent).
- ❌ **Don't use tasks.md as a project plan.** That's what Phase 2.6 PRD + Phase 3.7 Stories are for. tasks.md is the *currently active slice*, not the backlog.
- ❌ **Don't accumulate.** If `## Done` grows past 30 items, archive old ones to a separate file. The summarizer only shows 5 — but the file gets noisy.

## Full Spec

- Summarizer: `orchestrator/src/orchestrator/tasks-md.ts`
- CLI handler: `orchestrator/src/orchestrator/index.ts` → `runTasksCommand`
- Integration: same file → `runStartCommand` end-of-output banner
