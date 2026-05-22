# wdf-method — Web Dev Flow V3.6

**Full-lifecycle web development automation powered by AI agents.**
PRD through parallel BE/FE implementation with dual-layer FSM, Gate Cards, acceptance gates, and hands-free auto-run.

[![Version](https://img.shields.io/badge/version-3.6.0-blue)](package.json)
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

All through **36 sub-phases** governed by **double-layer FSM** with **Gate Cards** at every transition.

```
Your Idea
    │
    ▼
 /web-dev-flow init          ← bootstrap project
    │
    ▼
 Phase 1: Analysis (opt)     ← Brainstorming → Domain Research → Product Brief
    │
    ▼
 Phase 2: Planning           ← Impact Map → Story Map → Kano+RICE+PRD → UX
    │
    ▼
 Phase 3: Solutioning        ← C4 Architecture → Epics → Stories → API → Readiness
    │
    ▼
 Phase 4: Implementation     ← Sprint → BE Track ═ FE Track (parallel) → Integration
    │
    ▼
 🎉 Production-ready code + acceptance reports
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Native Agent System** | 13 role-based AI agents (analyst, PM, architect, developer, reviewer, QA...) |
| **Pure Orchestrator** | Thin state machine dispatches sub-agents with clean ~38KB context |
| **One Story = One Agent** | Each story runs in isolated git worktree — zero write conflicts |
| **4-Tier Acceptance** | CODE → FEATURE → UI → E2E BROWSER acceptance gates |
| **Autonomous Execution** | Hands-free auto-run mode from Phase 1 to completion |
| **Pause & Resume** | Signal-based cross-worktree agent communication |
| **BMAD Compatible** | Install via `npx bmad-method install --custom-source` |
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

In a Claude Code session:

```
/web-dev-flow init              Initialize a new project
/web-dev-flow status            Show progress dashboard
/web-dev-flow start             Start/resume current phase
/web-dev-flow pause             Pause and save state
/web-dev-flow resume            Resume from pause

/web-dev-flow freeze requirements   Freeze requirements (at Phase 2.5)
/web-dev-flow freeze dev-order      Freeze development order (at Phase 3.7)

/web-dev-flow accept code       Run CODE ACCEPTANCE
/web-dev-flow accept ui         Run UI ACCEPTANCE
/web-dev-flow accept feature    Run FEATURE ACCEPTANCE
/web-dev-flow accept e2e        Run E2E BROWSER ACCEPTANCE

/web-dev-flow gate 3            Check Phase 3 gate card
/web-dev-flow queue show        View merge queue
/web-dev-flow rebuild-status    Rebuild status index
/web-dev-flow report            Generate progress report
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
├── _bmad-output/web-dev-flow/
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
└── /tmp/web-dev-flow/signals/      ← Agent communication
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
