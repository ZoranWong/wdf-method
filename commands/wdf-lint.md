---
name: wdf-lint
description: Validate specification + artefact consistency across the project. Enforces constitution.yaml rules, traceability, scope contracts, and agent safety floors.
argument-hint: "[--only RULE] [--skip RULE] [--strict] [--fix] [--list-rules] [project-root]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Apply fix"
    command: /wdf-lint
    prompt: "Re-run lint after applying the suggested fixes"
scripts:
  sh: "echo 'wdf-method lint — invoke via wdf CLI directly'"
---

# /wdf-lint — Specification Linter

Runs the wdf-method specification linter: a rule-based scanner that enforces consistency across stories, agents, constitution rules, and framework versioning.

## Why It Exists

The linter is the "enforcement arm" of the framework. Without it, the constitution is just documentation — every rule in `constitution.yaml` becomes a promise instead of a gate. The linter turns those promises into CI checks.

V3.9 expanded the rule set from 4 to **8 rules** and added `--strict` mode so projects can decide whether warnings block CI or just decorate it.

## Usage

```bash
# Full scan
wdf lint

# List all registered rules
wdf lint --list-rules

# Run a single rule (useful for debugging or fast feedback)
wdf lint --only STORY_REFS_RESOLVE

# Skip noisy rules during transition periods
wdf lint --skip CONSTITUTION_CHECK

# Strict mode: warnings become errors (CI gate)
wdf lint --strict

# Auto-fix where possible (only some rules support this)
wdf lint --fix

# Lint a different project root
wdf lint /path/to/project
```

## Rules (8)

### Structural Consistency

- **VERSION_CONSISTENCY** (`error`) — every file declaring a `version:` must agree with `package.json`. Drift here breaks downstream tooling that reads the version.
- **SRG_ID_COMPLETENESS** (`warning`) — SRG-01..SRG-09 must all appear somewhere. Catches missing story-ready-gate definitions.

### Traceability (Phase 4 entry gate)

- **STORY_REFS_REQUIRED** (`error`) — every story must declare `refs:` in frontmatter for the traceability graph.
- **STORY_REFS_RESOLVE** (`error`) — every referenced ID (`REQ-`, `EPIC-`, `S-`, `/api/path`) must exist upstream in `prd.md` / `epics.md` / `api-spec.yaml` / `db-schema.md` / sibling stories. Surfaces dangling references that pass `STORY_REFS_REQUIRED` but point at non-existent upstream nodes.
- **STORY_SCOPE_REQUIRED** (`error`) — every story must declare `scope_write:` + `acceptance_check:`. Scope paths must be project-relative (no leading `/`, no `..`). Without these, the permission injector and QA stage have nothing to anchor on.

### Agent Safety Floor (WDF-004/005)

- **AGENT_SAFETY** (`error`) — every `references/agents/*.md` must have frontmatter with `name`, `description`, `default_permissions`, and `bash_deny` containing at minimum `git push` + `rm -rf`. Without this, a misbehaving agent could force-push or wipe the worktree and the injector would happily forward those commands.

### Constitution Enforcement (WDF-002/003/010)

- **CONSTITUTION_CHECK** (`error`) — executes the shell-check rules from `constitution.yaml`. Rules with `check:` + `expected:` are run from project root; stdout is parsed as int and compared. Covers stale dispatch permissions (WDF-002), leaked scratch directories (WDF-003), and secret leaks (WDF-010).

### Style Hygiene

- **NO_DEPRECATED_TERMS** (`warning`) — flags pre-3.6 terminology (`Pure Orchestrator`, `sprint_tracking`, `single-file status`). Inline opt-out via `<!-- lint-ignore-deprecated -->`.

## Strict Mode

`--strict` promotes every `warning` result to `error`:

```
$ wdf lint                            # 1 warning → exit 0
$ wdf lint --strict                   # 1 error   → exit 1
```

The original rule's level is preserved on the result line (so the report still shows what *was* a warning), but the exit code reflects the strict-adjusted count. Use this when your project has decided "warnings are debt we don't carry".

## Scope of File Scan

The linter walks the project root recursively. Default excludes:

- `node_modules/`, `.git/`, `dist/`, `.claude/`
- `.wdf-story-workspaces/` (transient worktrees)
- `_wdf_output/{.dispatch,.prompts,status,audit,backup,signals,test-reports,qa,review,party,_output}/` (transient state)

Default includes:
- `**/*.{md,toml,yaml,yml,ts,json}`

Spec artefacts that ARE scanned (this is the change from V3.8): `_wdf_output/stories/*.md`, `_wdf_output/prd.md`, `_wdf_output/epics.md`, `_wdf_output/api-spec.yaml`, `_wdf_output/db-schema.md`, `references/agents/*.md`, top-level `constitution.yaml` + `customize.toml`.

## Common Workflows

```bash
# CI gate (strict)
wdf lint --strict

# Pre-commit sanity check (skip slow constitution shell rules)
wdf lint --skip CONSTITUTION_CHECK

# Traceability audit before Phase 4 entry
wdf lint --only STORY_REFS_REQUIRED --only STORY_REFS_RESOLVE --only STORY_SCOPE_REQUIRED

# Add a new constitution rule? Edit constitution.yaml — no code change needed
# (CONSTITUTION_CHECK picks up any rule with check: + expected: fields).
```

## Adding a New Lint Rule

1. Create `orchestrator/src/orchestrator/linter/rules/<rule-name>.ts` exporting a `LintRule` object.
2. Register it in `orchestrator/src/orchestrator/linter/rules/index.ts` (`BUILTIN_RULES` array).
3. Add a row to `DEFAULT_RULE_CONFIG` in the same file.
4. Add a test under `orchestrator/src/orchestrator/__tests__/linter-<rule-name>.test.ts`.
5. Update this doc + the rule list above.

For constitution-shell-style rules (grep/wc/find), prefer adding to `constitution.yaml` instead — `CONSTITUTION_CHECK` will execute it without any code change.

## Exit Codes

- `0` — no errors (warnings may be present unless `--strict`)
- `1` — at least one error (or any warning under `--strict`)

## Full Spec

See `orchestrator/src/orchestrator/linter/` for the engine, rule registry, and individual rule implementations. `orchestrator/src/orchestrator/index.ts` → `runLintCommand` is the CLI entry point.
