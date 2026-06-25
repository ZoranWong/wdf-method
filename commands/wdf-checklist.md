---
name: wdf-checklist
description: Generate and verify a per-story requirement-quality checklist (CHK###) — "unit tests for requirements". The CLI emits mechanical hard-constraint items; this command guides Claude to supplement soft items (verifiability, vague wording, edge cases). Story Ready Gate refuses dispatch until every item is [x].
argument-hint: "<story-id> | verify <story-id> | list"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Generate checklist"
    command: /wdf-checklist
    prompt: "Generate the requirement checklist for this story, then review soft constraints"
  - label: "Verify checklist"
    command: /wdf-checklist
    prompt: "Verify every CHK item is checked for this story"
scripts:
  sh: "echo 'wdf-method checklist — invoke via wdf CLI directly'"
---

# /wdf-checklist — Requirements quality gate (CHK###)

Generates a per-story checklist of `CHK###` items the story must pass before
Phase-4 dispatch, then verifies they are all ticked. Borrowed from spec-kit's
"unit tests for requirements" idea, localized to wdf stories.

## Why It Exists

SRG-01..09 and the linter verify *"does the story exist with the right
shape?"* — scope, paths, command safety. They never ask *"does the story say
something testable?"*. A story titled `make the system user-friendly` sails
through because every field is syntactically valid; the ambiguity only
surfaces in Phase 4 when the dev agent gets stuck.

The checklist fills that gap with two kinds of items:

- **Mechanical (CLI-generated, deterministic, `CHK-M##`):** REQ mapping exists,
  scope_write is atomic, acceptance_check has ≥ N commands, the declared REQ
  actually resolves in `prd.md`, scope paths are project-relative.
- **Soft (Claude-reviewed, `CHK-0##`):** title has no vague adjectives, each AC
  is independently verifiable, edge cases considered, dependencies declared,
  out-of-scope is explicit.

## Usage

```bash
# Generate (or show, if it already exists) the checklist for a story
wdf checklist S-AUTH-01

# Force regenerate — re-runs mechanical checks, re-unchecks soft items
wdf checklist S-AUTH-01 --force

# Verify every CHK item is [x] (the gate that SRG calls)
wdf checklist verify S-AUTH-01

# List every checklist and its completion state
wdf checklist list
```

Output lives at `_wdf_output/checklists/<story-id>.md` (override with
`workflow.checklists_output` in `customize.toml`).

## The Claude review step

After `wdf checklist <id>` writes the skeleton, **read the story and tick the
soft items only when they genuinely hold** — do not auto-check. For each soft
item:

- **CHK-001 vague adjectives** — scan the title/description for "user-friendly",
  "fast", "robust", "good", "simple", "intuitive". Each must be replaced with a
  measurable criterion or moved to a quantified AC.
- **CHK-002 independently verifiable** — every `acceptance_criteria` entry must
  be pass/fail without a human judgment call.
- **CHK-003 edge cases** — empty input, concurrent calls, permission denied,
  timeout: are they in scope or explicitly excluded?
- **CHK-004 dependencies declared** — every `depends_on:` story exists and is in
  a valid upstream state.
- **CHK-005 out of scope explicit** — the story states what it deliberately does
  NOT touch.

Tick an item by editing its line in the checklist file to `- [x] CHK-0##`.

## Gate behavior

When `workflow.req_quality_gate = true` in `customize.toml`, the Story Ready
Gate adds a `REQ_QUALITY` check: a story is BLOCKED from dispatch unless its
checklist exists and every CHK item is `[x]`. The block is recorded in the
audit log with `reason=req_quality_gate`. The gate is opt-in so existing
projects without checklists are not retroactively blocked.

## Exit Codes

- `0` — generated / verified ok (all items checked)
- `1` — story not found, or one or more items unchecked

## Full Spec

- `orchestrator/src/orchestrator/checklist-cmd.ts` — generate / verify / list
- `orchestrator/src/orchestrator/index.ts` → `runChecklistCommand` — CLI entry
- `orchestrator/src/orchestrator/story-runner.ts` → `addReqQualityCheck` — gate
- `templates/checklists/story-checklist-template.md` — artifact shape
