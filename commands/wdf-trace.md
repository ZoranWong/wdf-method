---
name: wdf-trace
description: Query the traceability graph forward (REQ→Story→Test→Commit) or reverse (source line → story → REQ → JTBD). Powers both "what does REQ-1 touch?" and "what requirement does src/api/user.ts:42 implement?" workflows.
argument-hint: "<id> | blame <file>:<line> | --assert"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Query a node"
    command: /wdf-trace
    prompt: "Trace a REQ/EPIC/STORY/API/DB/JTBD forward and backward"
  - label: "Reverse-trace a source line"
    command: /wdf-trace
    prompt: "Find which REQ/JTBD a source line implements"
scripts:
  sh: "echo 'wdf-method trace — invoke via wdf CLI directly'"
---

# /wdf-trace — Bidirectional traceability

Queries the project traceability graph to show the complete upstream and
downstream chain for any node. Two query shapes:

## Forward trace (the original `wdf trace <id>`)

"What does this REQ / STORY / API / DB / JTBD / TEST / COMMIT touch?"

```bash
wdf trace REQ-7
wdf trace S-AUTH-01 --format=mermaid
wdf trace "API:GET /todos" --rebuild
wdf trace --assert        # Phase-4 exit gate: every merged story traces to a REQ
```

Returns every upstream parent (what this depends on) and downstream child
(what this impacts) through the full `JTBD→REQ→EPIC→STORY→API/DB→TEST→COMMIT` chain.

## Reverse trace — blame (`wdf trace blame`)

"What REQ does this specific source line implement?"

```bash
wdf trace blame src/api/user.ts:42
wdf trace blame backend/src/auth.ts:128 --rebuild
```

Pipeline:
1. `git blame -L <line>,<line> <file>` → commit hash + subject
2. Parse `[story:S-XXX]` from the commit subject
3. Build the traceability graph (or load cached)
4. Walk upstream from the STORY node: REQs and JTBDs in `refs:`
5. Walk downstream: TEST / API / DB nodes bound to the story

Output:

```
file             src/api/user.ts:42
commit           abc123456789 (feat: add login [story:S-AUTH-01])
story            S-AUTH-01 "User login"
REQ              REQ-1 "login"
JTBD             JTBD-1 "secure access"
TEST             TEST:src/api/user.test.ts "user login tests"
```

Any hop that can't be resolved is reported, not thrown — partial traceability
is surfaced explicitly (e.g. "story S-AUTH-01 not in traceability graph"), so
broken chains are visible instead of being hidden behind a 404.

## Why blame matters

- **Incident triage** — "this stack frame is in `auth.ts:42`. What REQ does it
  implement? Is there test coverage?" — one command instead of three tools.
- **Code review** — before approving a change, verify the REQ it claims to
  serve.
- **Traceability audit** — "does every merged commit still trace to a
  requirement?" — the reverse of `--assert`.

## Options

| Flag | Meaning |
|------|---------|
| `--format=text` | Human-readable output (default for forward trace) |
| `--format=mermaid` | Mermaid.js flowchart for embedding in markdown |
| `--rebuild` | Force rebuild the traceability graph instead of using cached |
| `--assert` | Verify every merged story traces back to a PRD REQ (Phase-4 gate) |

## Exit Codes

- `0` — node found / blame resolved / assert passed
- `1` — node not found / file not in git / assert failed

## Full Spec

- `orchestrator/src/orchestrator/trace-cmd.ts` — forward trace
- `orchestrator/src/orchestrator/trace-blame.ts` — reverse (blame) trace
- `orchestrator/src/orchestrator/traceability-graph.ts` — graph builder + index
- `orchestrator/src/orchestrator/index.ts` → `runTraceCommand` — CLI entry
