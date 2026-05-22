# web-dev-flow V3.6 — Setup Guide

> AI-Assisted Web Development Workflow — PRD through parallel implementation

---

## What You Get

```
Your AI Agent
     │
     ▼
 /web-dev-flow init        ← bootstrap project
     │
     ▼
 Phase 1: Analysis (opt)   ← Brainstorming → Domain Research → Product Brief
     │
     │  [Gate Card review]
     ▼
 Phase 2: Planning         ← Impact Map → Story Map → Kano+RICE+PRD → UX
     │
     │  [Gate Card review]
     ▼
 Phase 3: Solutioning      ← C4 Architecture → Epics → Stories → API → Readiness
     │
     │  [Gate Card review]
     ▼
 Phase 4: Implementation   ← Sprint Planning → BE Track + FE Track (parallel)
                             → Integration → Retrospective
```

Each phase produces production-ready artifacts. Gate Cards validate quality at every transition.

---

## Quick Start (2 steps)

### Step 1 — Install

```bash
bash scripts/setup.sh
```

This creates a symlink in `~/.claude/skills/web-dev-flow` → your project directory.

Options:
```bash
bash scripts/setup.sh --init         # Also create project output directories
bash scripts/setup.sh --dry-run      # Preview without making changes
bash scripts/setup.sh --uninstall    # Remove skill symlink
```

### Step 2 — Initialize your project

In a Claude Code session:

```
/web-dev-flow init
```

This generates a project description prompt, bootstraps the `status/` directory, and begins Phase 1.

---

## Manual Installation

If the install script is not available:

```bash
# Create symlink to Claude Code skills directory
ln -sf /Users/wang/study/ai-agent/web-dev-flow ~/.claude/skills/web-dev-flow
```

Then restart Claude Code. The skill will appear as `/web-dev-flow`.

---

## Architecture

```
web-dev-flow/
├── SKILL.md                           # Main entry point (Claude Code skill)
├── SETUP.md                           # This file — installation guide
├── scripts/
│   └── setup.sh                       # One-command installer
├── customize.toml                     # Configurable defaults
├── references/
│   ├── phase-01-analysis.md           # Phase 1 (Analysis — optional)
│   ├── phase-02-planning.md           # Phase 2 (Planning — PRD + UX)
│   ├── phase-03-solutioning.md        # Phase 3 (Architecture + Stories)
│   ├── phase-04-implementation.md     # Phase 4 (BE + FE + Integration)
│   ├── gate-cards/                    # Phase gate validation rules
│   ├── prompt-templates/              # Sub-agent dispatch templates
│   ├── agents/                        # Native agent role definitions
│   └── sub-workflows/                 # Detailed sub-phase instructions
├── schemas/                           # Artifact & state schemas
├── specs/                             # Isolation, merge queue, communication
├── assets/                            # Templates (OpenAPI, DB, ADR)
└── _test-project/                     # Test project with sample status files
```

---

## Configuration

All settings in `customize.toml`:

| Section | Purpose |
|---------|---------|
| `[workflow]` | dev_mode (separated/full_stack), tech stack defaults |
| `[acceptance_gates]` | Lighthouse thresholds, coverage minimums, bundle size limits |
| `[scope_lock]` | protected_paths, forbidden_paths, enforcement mode |
| `[merge_queue]` | auto-promote, integration checks, lock timeout |
| `[auto_run]` | auto-progress, auto-skip, max retries, concurrency |
| `[bmad_skill_fallbacks]` | BMAD skill → native agent mapping |
| `[acceptance_check_safety]` | Command allowlist + forbidden patterns |
| `[agent_communication]` | Signal directory, heartbeat, pause timeouts |

---

## Agent Communication

Sub-agents work in isolated git worktrees. Communication uses a shared directory outside any git repo:

```
/tmp/web-dev-flow/signals/
├── global.json                    ← Pause/abort all agents
├── main-to-{agentId}.json         ← Main → sub-agent commands
└── {agentId}-to-main.json         ← Sub-agent → main heartbeat + status
```

See `specs/agent-communication.md` for the full protocol.

---

## Troubleshooting

### Skill not appearing in Claude Code
```bash
# Verify symlink
ls -la ~/.claude/skills/web-dev-flow
# Expected: ~/.claude/skills/web-dev-flow -> /path/to/web-dev-flow

# Recreate if needed
bash scripts/setup.sh
```

### Sub-agents can't write files
Create `.claude/settings.json` with allowed tools:
```json
{
  "permissions": {
    "allow": [
      "Bash(git:*)", "Bash(npm:*)", "Bash(npx:*)",
      "Write(*)", "Read(*)", "Edit(*)"
    ]
  }
}
```

### State corruption
```
/web-dev-flow rebuild-status
```
Rebuilds `sprint-status.yaml` from `status/` directory files. Zero data loss.

### Clean slate
```bash
bash scripts/setup.sh --uninstall
rm -rf _bmad-output/ _test-project/
```

---

## Version

| Version | Date | Notes |
|---------|------|-------|
| 3.6.0 | 2026-05-21 | Split-file status, native agents, agent communication, pause/resume |

Full changelog: `CHANGELOG.md`
