---
name: wdf-converge
description: Brownfield gap analysis — compare declared requirements against code references.
argument-hint: "[--source=PATH] [--specs=PATH] [--prd=PATH] [--to-stories] [--json]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show project status"
  - label: "Trace Requirement"
    command: /wdf-trace
    prompt: "Trace a REQ through the full chain"
scripts:
  sh: "echo 'wdf-method converge — brownfield gap analysis'"
---

# /wdf-converge — Brownfield Gap Analysis

Scan an existing codebase against declared requirements and produce a gap report. Inspired by SpecKit's `/speckit.converge`.

## Pre-Execution Checks

- **Project root:** `--root=` flag, else cwd.
- **Specs source:** `_wdf_output/specs/` (V3.9+, preferred) or `_wdf_output/prd.md` (V3.8 legacy fallback).
- **Source roots:** `src/` and `backend/src/` by default. Override with `--source=PATH`.

## Execution

1. **Load engine**: Run `orchestrator/dist/index.js converge [flags]` from project root.
2. **Collect declared REQs**: Parse `specs/<domain>/spec.md` for `## REQ-NNN` headings, or fall back to `prd.md`.
3. **Scan source**: Regex-match `REQ-NNN` in `.ts/.tsx/.js/.jsx/.py/.go/.rs/.java/.rb/.php` files under source roots (excluding `node_modules`, `dist`, `_wdf_output`, etc.).
4. **Three-way compare**:
   - **IMPLEMENTED** — REQ declared AND referenced in code
   - **GAP** — REQ declared but no code reference found
   - **DRIFT** — code references a REQ id not declared in specs
5. **Emit report** to `_wdf_output/converge-report-<date>-<slug>.md`.
6. **Optional** `--to-stories`: write one draft story per gap to `_wdf_output/stories/converge-<date>/`.

## Output

The CLI prints a summary line:

```
Converge report: _wdf_output/converge-report-2026-06-21-a1b2c3.md
Summary: 4/10 implemented (40%), 6 gaps, 1 drift
Draft stories:  _wdf_output/stories/converge-2026-06-21 (6 files)
```

The report markdown contains:
- **Summary table** — declared / implemented / gaps / drift / coverage %
- **Gaps** — declared REQs with no code reference (the work to do)
- **Drift** — code references to undeclared REQ ids (the spec to fix or the code to remove)
- **Implemented** — REQs with at least one code reference
- **Methodology** — heuristic disclaimers + how to enrich via `// REQ-NNN` annotations

## Flags

| Flag | Purpose |
|------|---------|
| `--source=PATH` | Override source root (default: `src/`, also `backend/src/`) |
| `--specs=PATH` | Override specs directory (default: `_wdf_output/specs/`) |
| `--prd=PATH` | Override legacy PRD path (default: `_wdf_output/prd.md`) |
| `--to-stories` | Emit draft stories for each gap |
| `--json` | Emit JSON to stdout instead of writing report file |
| `--help`, `-h` | Show usage |

## Example

```bash
wdf converge                                   # basic scan
wdf converge --source=backend/src              # scan backend only
wdf converge --to-stories                      # also emit draft stories
wdf converge --json | jq '.summary'            # machine-readable
```

## When to use

- **Onboarding a brownfield project** — find what's specified but not built (or built but not specified).
- **After a long sprint** — verify the codebase still matches declared requirements.
- **Before a release** — ensure every P0 REQ has at least one code reference.
- **Auditing technical debt** — drift entries flag code that has lost its spec anchor.

## Limitations

- **Heuristic scan.** The engine uses regex, not AST analysis. Code that implements a requirement without citing the REQ-NNN id counts as a false-positive gap.
- **Enrichment pattern.** Add `// REQ-NNN: <one-line>` comments to route handlers / service entry points to make the scan reliable. This is the same convention `wdf trace` uses for its reverse lookups.
- **No semantic diff.** A code reference doesn't guarantee the requirement is correctly implemented — only that the code knows about it. Use `wdf accept` for behavioral verification.

## Handoff

After converge:
- **Gaps →** review each one. Implement and annotate, or remove the spec.
- **Drift →** either declare the missing REQ (via `wdf cr create` + spec delta) or delete the orphan code reference.
- **High coverage →** proceed to `wdf gate` to confirm Phase 4 readiness.
