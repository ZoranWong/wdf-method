---
name: wdf-hooks
description: Install / uninstall the wdf commit-msg git hook. The hook rejects commits carrying a [story:S-XXX] tag whose story is missing or has no REQ mapping — catching broken traceability at commit time instead of in CI.
argument-hint: "[install --strict | uninstall | check-commit-msg <file>]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Install hook"
    command: /wdf-hooks
    prompt: "Install the commit-msg hook now"
  - label: "Uninstall hook"
    command: /wdf-hooks
    prompt: "Uninstall the commit-msg hook"
scripts:
  sh: "echo 'wdf-method hooks — invoke via wdf CLI directly'"
---

# /wdf-hooks — commit-msg git hook manager

Installs a `commit-msg` git hook that validates `[story:S-XXX]` tags against
the project's story registry before a commit enters the graph.

## Why It Exists

wdf-method has extensive in-flight gates (SRG, traceability, lint) — but they
all run post-hoc, after the commit exists. A commit-msg hook closes the gap
on the most common invariant violation *before* the bad commit lands:

- `[story:S-XXX]` references a story that doesn't exist
- The story exists but has no `maps_to_req:` / `refs:` mapping back to a REQ

Both of these silently break reverse traceability (production bug → code line
→ story → REQ → JTBD). Catching them at commit time turns a Phase-4 lint
failure into a developer-facing error with a fix suggestion.

## Progressive Strictness

Two modes — pick what your project needs:

- **Default (non-strict):** commits without a `[story:...]` tag pass. This
  keeps master writable for framework chores / docs while still validating
  Phase-4 story commits.
- **Strict (`--strict`):** every commit must carry a `[story:...]` tag. Use
  once your team is fully on the wdf workflow.

## Usage

```bash
# Install (default mode — only validates tagged commits)
wdf hooks install

# Install in strict mode (every commit must be tagged)
wdf hooks install --strict

# Reinstall over an existing user hook (backups the original to .wdf-backup)
wdf hooks install --force

# Remove the hook entirely
wdf hooks uninstall

# Validate a commit message file (used internally by the hook)
wdf hooks check-commit-msg .git/COMMIT_EDITMSG
```

The hook itself is a POSIX `/bin/sh` script at `.git/hooks/commit-msg` that
calls back into the wdf CLI. It's marked with `# wdf-hook:commit-msg:v1` so
reinstalls and uninstalls are idempotent; user code outside the wdf block is
preserved.

## Validation Rules

`wdf hooks check-commit-msg <file>` enforces, in order:

1. **No tag, non-strict** → pass (progressive strictness).
2. **No tag, strict** → fail with `[strict]` reason.
3. **Tag present, story file missing** in `_wdf_output/stories/<id>.md` →
   fail, message lists the searched paths.
4. **Story has no REQ mapping** (neither `maps_to_req:` nor `refs:`) → fail,
   message shows the expected frontmatter shape.
5. **Otherwise** → pass, prints `story_id → REQ-NNN, REQ-MMM` for traceability.

## Bypass

One-off bypass (when you intentionally need to land an untagged commit):

```bash
git commit --no-verify ...
```

Permanent removal:

```bash
wdf hooks uninstall
```

## Exit Codes

- `0` — hook check passed (or install/uninstall succeeded)
- `1` — commit message rejected, or install/uninstall failed

## Common Workflows

```bash
# First-time setup on a new project
wdf hooks install

# Existing team on-boarding (start non-strict, flip later)
wdf hooks install
# ... after everyone uses [story:...] tags ...
wdf hooks install --strict   # idempotent, replaces existing tagged block
```

## Full Spec

- `orchestrator/src/orchestrator/hooks-cmd.ts` — install / uninstall / check logic
- `orchestrator/src/orchestrator/index.ts` → `runHooksCommand` — CLI entry
