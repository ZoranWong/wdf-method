---
name: wdf-build
description: One-command full pipeline — from idea description to deployed application. Automates all 4 phases end-to-end.
argument-hint: "\"project description\" | [--no-interaction] | [--complexity simple|standard|complex]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show the project status dashboard"
  - label: "Pause Building"
    command: /wdf-pause
    prompt: "Pause the current auto-build"
  - label: "Resume from Halt"
    command: /wdf-resume
    prompt: "Resume from the last halt point"
  - label: "Check Phase Gate"
    command: /wdf-gate
    prompt: "Check the gate for a specific phase"
scripts:
  sh: "echo 'wdf-method build — starting full pipeline'"
---

# /wdf build — Full Pipeline

Build a complete web application from a single description. **Interactive planning (Phases 1-3) → Automated implementation (Phase 4).** All planning is guided by the First Principles methodology.

## Design Philosophy

All analysis and design follows `{skill-root}/references/principles/first-principles.md`:
- **Problems before solutions** — distinguish what users really need from what they say they want
- **Root causes before symptoms** — apply 5 Whys to every problem
- **Constraints before choices** — classify every constraint as P0 (hard) / P1 (strong) / P2 (soft) / P3 (assumed)
- **Simplicity as default** — every complexity must justify its existence with quantified value

## User Input

```text
$ARGUMENTS
```

The text after `/wdf build` is the project description.

## Execution Model

```
/wdf build "description"
  ↓
┌─────────────────────────────────────────┐
│  INTERACTIVE — User + Agent collaborate  │
│                                         │
│  Phase 1: Analysis (optional)            │
│  Phase 2: Planning (PRD + UX)            │
│  Phase 3: Solutioning (Arch + Stories)   │
│                                         │
│  User reviews & confirms each phase      │
├─────────────────────────────────────────┤
│  AUTOMATED — Hands-free execution        │
│                                         │
│  Phase 4: Implementation (BE + FE)       │
│  Acceptance: Code/UI/Feature/E2E         │
│                                         │
│  Zero prompts unless blocker             │
└─────────────────────────────────────────┘
  ↓
Done — working app
```

## Stage 1: Interactive Planning (Phases 1-3)

### Bootstrap & Init (interactive)
1. Classify complexity
2. Present recommendation, user confirms or customizes
3. Bootstrap `status/` directory

### Phase 1 — Analysis (interactive, skippable)
- User decides which sub-phases to run/skip
- Agent produces brainstorming, research, brief outputs
- User reviews and approves each

### Phase 2 — Planning (interactive)
- Agent produces PRD, impact map, user flows, wireframes, design tokens
- User reviews each artifact
- **Requirements Freeze** at Phase 2.5 — user explicitly confirms "requirements are complete"
- **Design Acceptance** at Phase 2.10 — user confirms UX is ready

### Phase 3 — Solutioning (interactive)
- Agent produces architecture, epics, stories, API spec, DB schema
- User reviews architecture decisions and story designs
- **Development Order Freeze** at Phase 3.7 — user explicitly confirms story sequence
- **Readiness Check** at Phase 3.9 — presents final "Ready to Build?" confirmation

### The Gate: Ready to Build

After Phase 3.9 passes, present the build confirmation:

```
═══════════════════════════════════════════
Ready to Build
═══════════════════════════════════════════
Project:    {name}
Stories:    {N} stories across {BE/FE} tracks
Architecture: {style} with {containers}
API:        {N} endpoints defined
DB:         {N} tables designed
Complexity: {simple|standard|complex}
Est. time:  ~{hours}h for implementation

[Y] Start automated build  [R] Review details  [C] Cancel
═══════════════════════════════════════════
```

User types `Y` to enter the automated phase. This is the LAST prompt.

## Stage 2: Automated Implementation (Phase 4)

After user confirms "Ready to Build", everything is hands-free:

### Auto-run protocol
1. **Sprint Planning (4.1)** — auto-generated from stories
2. **BE Track (4.2-4.6)** + **FE Track (4.7-4.12)** — parallel dispatch per slot management
3. **Integration (4.13)** — auto-merge queue processing
4. **Acceptance Gates** — auto CODE → UI → FEATURE → E2E acceptance

### Progress display (live, no interaction)

```
wdf-method: Building "{project_name}" — Automated Phase

BE Track [████░░] 4.4 Endpoints — 3/5 stories
FE Track [██░░░░] 4.10 Pages — 1/4 stories
Merge Queue: 2 merged, 4 queued
Last merge: S-3.1 (commit a1b2c3d) — all checks passed
─────────────────────────────────────────
Auto-advancing... press /wdf-pause to halt
```

### Halt conditions (only these stop the automated phase)
| Trigger | Recovery |
|---------|----------|
| Story agent returns FAILED | Present recovery dashboard, retry/skip/abort |
| Merge conflict | Manual resolution needed |
| Acceptance check fails | Fix code, re-run |
| Blocking CR filed | Resolve CR, resume |

### Done: Build complete

```
═══════════════════════════════════════════
wdf-method: Build Complete

Project:    {project_name}
Stories:    {merged}/{total} delivered
Acceptance: ✓ code  ✓ ui  ✓ feature  ✓ e2e
Time:       {duration}

Working app: {directory or URL}
Docs:       _bmad-output/wdf-method/

/wdf-status for dashboard
/wdf-report for full metrics
═══════════════════════════════════════════
```

## Flags

| Flag | Effect |
|------|--------|
| `--party` | Use Party Mode (multi-agent meeting) for Phases 1-3 |
| `--expert {domain}` | Invite external domain expert(s) to the party |
| `--complexity simple\|standard\|complex` | Skip classification prompt |
| `--skip-analysis` | Skip Phase 1 entirely |
| `--dev-mode separated\|fullstack` | Force dev mode (skip auto-detect) |

## Mode Selection

After bootstrap, present the mode choice:

```
Planning mode for "{project_name}":
[P] Party Mode — Multi-agent meeting (Analyst + PM + UX + Architect + Story Planner)
    Best for: new products, complex domains, stakeholder alignment
[S] Sequential — Step-by-step phase progression
    Best for: well-defined projects, solo developers, quick iterations

Choice: [P/S]
```

If `--party` flag: auto-select Party Mode, skip prompt.
If `--expert` flag: also invite the specified domain experts.

## Full Spec

- Party Mode: `commands/wdf-party.md` and `references/party/*.md`
- Interactive planning: SKILL.md "## On Activation Step 1-7" and Main Menu
- Automated implementation: SKILL.md "## Auto-Run Mode" and slot management

## Example

```
/wdf build "a team task management dashboard with React + Express + PostgreSQL"
/wdf build --party "a HIPAA-compliant patient portal" --expert "healthcare-compliance"
/wdf build --complexity simple "a URL shortener with Express + SQLite"
```

