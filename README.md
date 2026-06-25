# wdf-method — Web Dev Flow V3.9

**Full-lifecycle web development automation powered by AI agents.**
PRD through parallel BE/FE implementation with dual-layer FSM, entry/exit gates, requirement traceability, an evolvable constitution, and a dev→review→testing→QA pipeline per story.

[![Version](https://img.shields.io/badge/version-3.9.0-blue)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![BMAD Module](https://img.shields.io/badge/BMAD-module-wdf-orange)](module.yaml)

---

## What is wdf-method?

> **Naming:** The project is `wdf-method` (npm package, repo name). In Claude Code, use `/web-dev-flow` to invoke. `wdf` is the BMAD module code. These all refer to the same system.

wdf-method is a **Claude Code skill** that orchestrates the complete web development lifecycle. You describe your project in one sentence — it produces:

- **PRD** — Kano + RICE prioritized product requirements
- **UX Design** — User flows, wireframes, design tokens, interaction specs
- **Architecture** — C4 L1-L3 system design with ADRs
- **Epics & Stories** — 7-contract-field story definitions with executable acceptance checks
- **Implementation** — TDD-driven BE + FE parallel development with 4-tier acceptance gates
- **Integration** — Merge queue, contract verification, E2E browser acceptance

All through **36 sub-phases** governed by **double-layer FSM** with **gates** at every transition.

```
Your Idea
    │
    ▼
 wdf init                    ← bootstrap project + state files
    │
    ▼
 Phase 1: Analysis (opt)     ← Brainstorming → Domain Research → Product Brief
    │
    ▼
 Phase 2: Planning           ← Impact Map → Story Map → Kano+RICE+PRD → UX
    │
    ▼
 Phase 3: Solutioning        ← C4 Architecture → Epics → Stories → API → Readiness
    │                           (Phase 3.9 → 4 ENTRY gate: semantic + traceability + checklist)
    ▼
 Phase 4: Implementation     ← BE Track ═ FE Track (parallel)
    │                           each story: dev → review → testing → QA pipeline (≤5 retries)
    │                           (Phase 4 → MERGED EXIT gate: test binding + no drift)
    ▼
 🎉 Production-ready code + acceptance reports
```

---

## Execution Model

wdf-method runs in **two strictly separated layers**. The CLI never dispatches agents and never calls AI — it only answers "where are we, what's missing, is it compliant?"

| Layer | Owns | How it works |
|-------|------|--------------|
| **Claude session (controller)** | All AI work: Phase 1-3 artifact authoring; Phase 4 reads the pipeline manifest and dispatches dev/review/testing/QA sub-agents (≤5 retries) via the Agent tool | Calls `wdf start` to get a dispatch manifest → dispatches sub-agents → calls `wdf start` again so the CLI reads stage reports and decides advance/retry/escalate |
| **TypeScript CLI (state machine + inspector)** | FSM state, artifact validation, pipeline manifest building, escalation. **Never spawns subprocesses, never calls AI** | Reads state, scans artifacts, writes manifests, reads review/test/QA reports to decide. A spec-driven "blackboard". |

This mirrors the spec-driven pattern of BMAD / SpecKit / OpenSpec: Claude is the brain, the CLI is the blackboard.

---

## Features

| Feature | Description |
|---------|-------------|
| **Native Agent System** | Role-based AI agents (analyst, PM, architect, developer, reviewer, QA...) |
| **Thin Orchestrator** | CLI is a pure state machine + quality inspector — never spawns agents, never calls AI |
| **Per-Story Pipeline** | Each story runs dev → review → testing → QA, with ≤5 feedback-driven retries |
| **One Story = One Agent** | Each story runs in isolated git worktree — zero write conflicts |
| **Requirement Traceability** | `wdf trace` / `wdf trace blame` link JTBD → REQ → Story → Test → Commit, both directions |
| **Entry & Exit Gates** | `wdf gate phase4` (semantic + traceability + checklist) on the way in; `wdf gate exit` (test binding + drift) before MERGED |
| **Evolvable Constitution** | `wdf constitution show/bump/diff` — semver versioning, changelog, sync-impact diff, CI-enforced |
| **Clarify & Checklist** | `wdf clarify` flags PRD ambiguity with suggested options; `wdf checklist` enforces per-story requirement quality (CHK###) |
| **4-Tier Acceptance** | CODE → FEATURE → UI → E2E BROWSER acceptance gates |
| **Autonomous Loop** | `wdf loop` evaluates all story pipelines and returns the next dispatch action |
| **Pause & Resume** | Signal-based cross-worktree agent communication |
| **Independent CLI** | `npx wdf-method install` — zero external dependencies |

---

## Quick Start

### Installation

```bash
# Via BMAD (recommended)
npx bmad-method install --yes \
  --custom-source https://github.com/ZoranWong/wdf-method \
  --tools claude-code \
  --set wdf.language=zh \
  --set wdf.frontend=react \
  --set wdf.backend=express

# Via independent CLI
npx wdf-method install --yes --project . --tools claude-code

# Via setup script
bash scripts/setup.sh --project . --init
```

### Usage

The CLI binary is `wdf`. In a Claude Code session, the same workflow is driven via the `/web-dev-flow` skill.

```
# Lifecycle
wdf init <path>              Initialize a project + state files
wdf start                    Query current state, emit next-step prompt (drives the main loop)
wdf status                   Full progress dashboard
wdf doctor                   Environment diagnostics

# Phase 4 automation
wdf loop [--json]            Evaluate all story pipelines, return next action
wdf loop --post-dispatch     Cleanup permissions after an agent completes + get next step

# Quality / gates
wdf check [--artifact=...]   Check artifact quality/compliance
wdf gate                     Check current gate
wdf gate phase4              Pre-check Phase 3.9→4 ENTRY gate (semantic + traceability + checklist; CI-usable)
wdf gate exit [--story=X]    Pre-check Phase 4→MERGED EXIT gate (test binding + STORY_NO_TEST + drift; CI-usable)
wdf lint --strict            Spec consistency check (includes constitution enforcement)

# Acceptance
wdf accept code|ui|feature|e2e   Run the corresponding acceptance gate

# Traceability
wdf trace <id>               Trace a requirement chain (JTBD → REQ → Story → Test → Commit)
wdf trace blame <file>:<line>   Reverse trace: code line → commit → story → REQ → JTBD

# Requirement quality
wdf checklist <story-id>     Generate/view a story's requirement-quality checklist (CHK###)
wdf checklist verify <id>    Verify all CHK items for a story are [x]
wdf clarify [verify]         Scan PRD for ambiguity (with suggested options); verify requires an Answer per item

# Constitution
wdf constitution             Run the CONSTITUTION_CHECK
wdf constitution show|bump|diff   Evolve the constitution: inventory / semver bump + changelog + snapshot / sync-impact diff

# Misc
wdf hooks install [--strict]   Install the commit-msg hook ([story:S-XXX] traceability)
wdf snapshot list|create     State snapshot management
wdf cr list|create|apply     Change-request management
wdf permissions list|apply   V3 permission injection
```

---

## Architecture

### Agents

| Agent | Role | Skills |
|-------|------|--------|
| `wdf-orchestrator` | Workflow Orchestrator | FSM, gate cards, agent dispatch |
| `wdf-analyst` | Business Analyst | Brainstorming, domain research, product brief |
| `wdf-product-manager` | Product Manager | Impact mapping, Kano+RICE, PRD |
| `wdf-ux-designer` | UX Designer | User flows, wireframes, design system |
| `wdf-architect` | System Architect | C4 L1-L3, ADRs, quality attributes |
| `wdf-story-planner` | Story Planner | Epics, stories (7 contract fields), dev order |
| `wdf-api-designer` | API Designer | OpenAPI 3.0, database schema |
| `wdf-backend-developer` | Backend Developer | TDD, Clean Architecture, REST API |
| `wdf-frontend-developer` | Frontend Developer | CDD, accessibility, responsive design |
| `wdf-code-reviewer` | Code Reviewer | Adversarial review, security audit |
| `wdf-qa-verifier` | QA Verifier | Feature/UI/A11y/Perf/E2E acceptance |
| `wdf-sprint-planner` | Sprint Planner | Capacity, story assignment, scope freeze |
| `wdf-retrospective-host` | Retrospective Host | Metrics, insights, action items |
| `wdf-readiness-auditor` | Readiness Auditor | Cross-phase artifact audit |

### State Machine

```
NOT_STARTED → IN_PROGRESS → IMPLEMENTED → TESTED → SPEC_COMPLIANT
    → SUBMITTED → CODE_ACCEPTANCE → CODE_ACCEPTED
    → FEATURE_ACCEPTANCE → FEATURE_ACCEPTED
    → UI_ACCEPTANCE → UI_ACCEPTED
    → E2E_BROWSER_ACCEPTANCE → E2E_BROWSER_ACCEPTED
    → MERGE_QUEUED → MERGED
```

Two hard gates bracket Phase 4 to enforce traceability strong-consistency:

- **Entry gate** (`wdf gate phase4`) — before any story enters implementation: semantic consistency + every story reverse-traces to a PRD REQ + checklist. Deliberately *excludes* test-side checks (tests aren't written yet).
- **Exit gate** (`wdf gate exit`) — before a story is marked MERGED: every AC binds to a TEST (`AC_TEST_BINDING`), no `STORY_NO_TEST`, and no spec drift (missing test / unspecified endpoint). Enforced both in the pipeline QA-pass branch and at atomic merge time. Opt-out via `[semantic_gate] enabled = false`.

### Story Ready Gate (SRG-01 ~ SRG-09)

Every story passes 9 safety gates before development:

| Gate | Check |
|------|-------|
| SRG-01 | scope_write defined and non-empty |
| SRG-02 | acceptance_check defined |
| SRG-03 | Story file exists |
| SRG-04 | Path safety (relative, no traversal, not forbidden) |
| SRG-05 | No scope_write overlap with active stories |
| SRG-06 | Within implementation_boundary |
| SRG-07 | Parent directories exist |
| SRG-08 | Protected path intersection → serial_only |
| SRG-09 | Command safety (allowlist + forbidden patterns) |

---

## Project Structure (after `--init`)

```
my-project/
├── .claude/
│   ├── skills/wdf/                 ← Orchestrator + 13 agents
│   └── settings.json               ← Sub-agent permissions
├── _wdf_output/
│   ├── prd.md                      ← Product requirements
│   ├── epics.md                    ← Epic decomposition
│   ├── stories/                    ← Story files (7 contract fields)
│   ├── architecture.md             ← C4 design + ADRs
│   ├── api-spec.yaml               ← OpenAPI 3.0
│   ├── db-schema.md                ← Database schema
│   ├── _output/
│   │   ├── planning/               ← Impact map, story map, user flows
│   │   ├── solutioning/            ← System context, readiness check
│   │   └── acceptance/             ← Acceptance reports
│   ├── status/                     ← Split-file state (each file 1 writer)
│   │   ├── global.yaml
│   │   ├── phase-01.yaml ~ phase-04-fe.yaml
│   │   ├── change-requests.yaml
│   │   ├── stories/
│   │   └── merge-queue/
│   └── sprint-status.yaml          ← Derived index (auto-generated)
└── _wdf_output/signals/      ← Agent communication
```

---

## Configuration

### CLI install flags

```bash
npx wdf-method install \
  --project .              # Project-local install
  --yes                    # Non-interactive
  --tools claude-code      # IDE/CLI tool
  --set wdf.language=zh    # Agent language (zh|en|ja)
  --set wdf.output_dir=out # Output directory
  --set wdf.dev_mode=separated  # separated|full_stack
  --set wdf.frontend=react # react|vue|svelte|next
  --set wdf.backend=express # express|nest|fastify|none
```

### customize.toml

All workflow behavior is configurable in `customize.toml`:
- Acceptance thresholds (Lighthouse, coverage, bundle size)
- Protected paths (12 categories)
- Merge queue settings
- Auto-run behavior
- Command safety allowlist
- Agent communication

---

## Specifications

| Spec | Purpose |
|------|---------|
| [agent-isolation.md](specs/agent-isolation.md) | One Story = One Agent = One Worktree |
| [worktree-isolation.md](specs/worktree-isolation.md) | Git branch + worktree control |
| [scope-lock.md](specs/scope-lock.md) | 3-level scope enforcement |
| [merge-queue.md](specs/merge-queue.md) | File-based dependency-ordered merge queue |
| [agent-communication.md](specs/agent-communication.md) | Cross-worktree signal protocol |
| [story-slicing.md](specs/story-slicing.md) | Optional P0/P1 story slices |
| [step-audit.md](specs/step-audit.md) | Sub-step tracking + crash recovery |
| [git-commit-checkpoints.md](specs/git-commit-checkpoints.md) | Minimum 3 commits per story |
| [status-directory.md](specs/status-directory.md) | Split-file write permission matrix |

---

## Requirements

- **Claude Code** (AI agent runtime)
- **Git 2.0+** with worktree support
- **Node.js 18+** (for test/type-check/lint in Phase 4)
- **BMAD-METHOD** (optional — for `npx bmad-method install`)

No other external dependencies. All 13 agents are self-contained.

---

## Comparison

| | wdf-method | BMAD bmm module |
|---|---|---|
| Scope | Web development | General software |
| Phases | 4 (36 sub-phases) | 4 |
| Agents | 14 (orchestrator + 13 roles) | 6 (analyst, pm, architect, dev, ux, writer) |
| Acceptance | 4-tier (CODE/FEATURE/UI/E2E) | Code review |
| Story isolation | Git worktree per story | Session-based |
| Pause/Resume | Signal-based cross-worktree | Not supported |
| Configuration | customize.toml (700+ lines) | module.yaml + config.yaml |

---

## Links

- **Repository:** [ZoranWong/wdf-method](https://github.com/ZoranWong/wdf-method)
- **BMAD Method:** [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)

## License

MIT

---

*Built with the BMAD framework. 100% free. 100% open source.*
