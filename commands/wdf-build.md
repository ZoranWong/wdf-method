---
name: wdf-build
description: One-command full pipeline — from idea description to deployed application. Automates all 4 phases end-to-end.
argument-hint: "\"project description\" | [--no-interaction] | [--complexity simple|standard|complex] | [--party]"
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
  - label: "Start Party"
    command: /wdf-party
    prompt: "Start multi-agent party mode for planning"
scripts:
  sh: |
    cd "$WDF_PROJECT_ROOT"
    node "$WDF_SKILL_ROOT/orchestrator/dist/index.js" build "$@"
---

# /wdf-build — Full Pipeline

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

The text after `/wdf-build` is the project description.

## Execution Model

```
/wdf-build "description"
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

## CLI Integration

This skill calls the orchestrator's build command which:

1. **Bootstrap**: Initialize project directory structure
2. **Classify Complexity**: Determine simple/standard/complex
3. **Interactive Planning (Phases 1-3)**: User-guided or Party Mode
4. **Freeze Checkpoints**: Requirements (Phase 2.5), Dev Order (Phase 3.7)
5. **Automated Implementation (Phase 4)**: Hands-free story execution
6. **Acceptance Gates**: 4-layer automated acceptance
7. **Done**: Application ready

---

## Stage 1: Bootstrap & Init (Interactive)

1. **Project Root**: Detect if in existing project or new directory
2. **Complexity Classification**:
   - Read description keywords
   - Classify into simple/standard/complex
   - Present recommendation, user confirms or customizes
3. **Dev Mode Auto-Detect**:
   - From keywords: "separated" or "fullstack"
   - Auto-detect: count of frontend vs backend keywords
   - User can override
4. **Tech Stack Selection**: Based on keywords in description
   - Frontend: React (default), Vue, Angular, Svelte, Next.js
   - Backend: Express (default), Nest, Fastify, Django, Flask
   - Database: PostgreSQL (default), MongoDB, SQLite, MySQL
   - Auth: JWT (default), Session, OAuth
   - Deployment: Docker (default)
5. **Bootstrap `status/` directory**: Create all 10 status files
6. **Pre-initialize**: Run pre-check to verify environment (node, git, etc.)

### Init Output

```
═══════════════════════════════════════
wdf-method: Project Initialized
═══════════════════════════════════════

Project:      team-task-dashboard
Description:  "a team task management dashboard"
Complexity:   standard (auto-classified)
Dev Mode:     separated (BE + FE)
Tech Stack:   React + Express + PostgreSQL + JWT
Tri Mode:     parallel (BE and FE run concurrently)

Est. phases:  3 (planning) + 1 (implementation)
Est. stories: 15 (9 backend + 6 frontend)

[Y] Proceed with these settings  [C] Customize  [A] Abort
```

---

## Stage 2: Interactive Planning (Phases 1-3)

### Phase 1 — Analysis (interactive, skippable)

User decides which sub-phases to run/skip:
- **1.1 Brainstorming**: Initial ideation
- **1.2 Domain Research**: Research similar products, patterns
- **1.3 Product Brief**: 1-page brief

For each artifact:
1. Agent produces output
2. User reviews and edits
3. User confirms → mark as LOCKED → proceed

**Optional Party Mode Skip**: If using `--party`, Phase 1 is run as multi-agent party session.

### Phase 2 — Planning (interactive)

Agent produces artifacts for each sub-phase, user reviews:
- **2.1 Impact Mapping**
- **2.2 Event Storming**
- **2.3 JTBD Cards**
- **2.4 Story Mapping**
- **2.5 Prioritization + PRD** → **REQUIREMENTS FREEZE** user confirms
- **2.6 User Flows + Sitemap**
- **2.7 Wireframes**
- **2.8 Design Tokens**
- **2.9 Interaction Design**
- **2.10 Design Acceptance** → DESIGN FROZEN user confirms

**Freeze at Phase 2.5**: User explicitly confirms "requirements are complete" — the PRD is frozen. Any new features after this point require a Change Request.

### Phase 3 — Solutioning (interactive)

Agent produces architecture and stories:
- **3.1 System Context** (C4 L1)
- **3.2 Architecture Style**
- **3.3 Container Design** (C4 L2)
- **3.4 Quality Attributes**
- **3.5 Component Design** (C4 L3)
- **3.6 Epics & Feature Plan**
- **3.7 Story Design** → **DEV ORDER FREEZE** user confirms
- **3.8 API & Data Design**
- **3.9 Readiness Check** → **READY TO BUILD** confirmation

**Freeze at Phase 3.7**: User explicitly confirms story sequence and scope is correct. Reordering after this point requires a Change Request.

### Ready to Build: The Final Gate

After Phase 3.9 passes, present the build confirmation:

```
═══════════════════════════════════════════
Ready to Build
═══════════════════════════════════════════
Project:    team-task-dashboard
Stories:    15 stories across 2 tracks
  Backend: 9 stories (API + DB)
  Frontend: 6 stories (Pages + Components)
Architecture: Layered with Repository pattern
API:        12 endpoints designed
DB:         8 tables designed
Complexity: standard

Est. implementation time:  ~4 hours
Scope Lock enforcement:     strict (violations block)
Parallel execution:         enabled

[Y] Start automated build  [R] Review details  [C] Cancel
```

User types `Y` to enter the automated phase. This is the **LAST prompt**.

---

## Stage 3: Automated Implementation (Phase 4)

After user confirms "Ready to Build", everything is hands-free and managed by the orchestrator.

### Auto-run Protocol

> **CHG-2026-006 (3.8.0):** The main loop `runAutoLoop()` now drives all four
> phases (1→2→3→4) without interactive prompts. See
> [docs/AUTO-RUN.md](../docs/AUTO-RUN.md) for the full pipeline, pause/resume
> semantics, and phase-detection resume. The Phase 4 protocol below remains the
> canonical sub-phase ordering.

1. **Phase 4.1 — Sprint Planning**: Generate sprint plan from story list
2. **BE Track (4.2-4.6)** + **FE Track (4.7-4.12)** — parallel dispatch with slot management
   - **BE**: 4.2 Scaffolding → 4.3 Database → 4.4 Endpoints (AUTO-CONTINUE) → 4.5 Testing → 4.6 Code Acceptance
   - **FE**: 4.7 Scaffolding → 4.8 Design System → 4.9 API Client → 4.10 Pages (AUTO-CONTINUE) → 4.11 Audit → 4.12 UI Acceptance
3. **Phase 4.13 — Integration**: auto-process merge queue
4. **Phase 4.14 — Acceptance Gates**: auto-run CODE → UI → FEATURE → E2E acceptance

### Parallel Track Execution Logic

The orchestrator manages concurrent story execution with:
- **Slot-based dispatch**: max_concurrent_stories from customize.toml (default: 5)
- **Dependency awareness**: stories with deps wait until upstream merges
- **Scope overlap detection**: stories with overlapping scope_write run serially
- **Protected path detection**: stories touching protected paths run singly (serial_only=true)
- **Signal-based pause**: `/wdf-pause` signals propagate to all running agents

### Progress Display (Live, No Interaction)

```
wdf-method: Building "team-task-dashboard" — Phase 4
────────────────────────────────────────────────────────
BE Track [████████░░░░] 4.4 Endpoints — 3/5 stories
FE Track [████████░░░░] 4.10 Pages — 1/4 stories

Merge Queue: 2 merged, 4 queued, 1 waiting dependency
Last merge: S-3.1 (commit a1b2c3d) — all checks passed

Auto-advancing... press /wdf-pause to halt at safe point
```

### Halt Conditions (Only These Stop the Automated Phase)

| Trigger | Recovery |
|---------|----------|
| Story agent returns FAILED | Present recovery dashboard: retry/skip/abort |
| Merge conflict | Auto-detect, present manual resolution steps |
| Acceptance check fails | Auto-generate fix story, retry |
| Blocking CR filed | Halt all execution, present CR resolution dashboard |
| User issues `/wdf-pause` | Graceful pause at next safe point |

### Acceptance Gates (Automated)

After all stories are CODE_ACCEPTED and merged:

1. **`/wdf-accept code`** — Verify all backend acceptance criteria met
2. **`/wdf-accept ui`** — Verify all frontend acceptance criteria met
3. **`/wdf-accept feature`** — Full-stack feature acceptance
4. **`/wdf-accept e2e`** — Cross-browser, responsive, network conditions

All 4 gates must pass for build to be considered complete.

### Done: Build Complete

```
═══════════════════════════════════════════
wdf-method: Build Complete
═══════════════════════════════════════════

Project:    team-task-dashboard
Stories:    15/15 delivered (9 BE + 6 FE)
Acceptance: ✓ code  ✓ ui  ✓ feature  ✓ e2e
Duration:   3h 42m

Working app: ./dist/ (or docker-compose up -d)
API Docs:    _wdf-output/acceptance/api-docs.html
Full Report: _wdf-output/acceptance/final-report.md

Commands:
/wdf-status  — Full dashboard
/wdf-report  — Metrics and build analysis

═══════════════════════════════════════════
```

---

## Flags & Options

| Flag | Effect |
|------|--------|
| `--party` | Use **Party Mode** (multi-agent meeting) for Phases 1-3 instead of sequential |
| `--expert {domain}` | Invite external domain expert(s) to the party (healthcare-compliance, security, performance) |
| `--complexity simple\|standard\|complex` | Skip classification prompt, force complexity tier |
| `--skip-analysis` | Skip Phase 1 entirely, start directly at Phase 2 |
| `--dev-mode separated\|fullstack` | Force dev mode (skip auto-detection) |
| `--triage-mode light\|serial\|parallel` | Force triage mode (auto selects based on complexity) |
| `--no-interaction` | **EXPERIMENTAL**: Skip ALL prompts, use defaults (caution!) |

## Mode Selection

After bootstrap, present the mode choice (unless `--party` flag forces it):

```
Planning mode for "team-task-dashboard":

[P] Party Mode — Multi-agent collaborative meeting
    Agents: Analyst + Product Manager + UX Designer + Architect + Story Planner
    Best for: new products, complex domains, stakeholder alignment

[S] Sequential — Step-by-step phase progression (single agent)
    Best for: well-defined projects, solo devs, quick iterations

Choice: [P/S]
```

If `--party` flag: auto-select Party Mode, skip prompt. If `--expert` flag also invite specified domain experts to party.

## Build Command Examples

```bash
# Basic usage
/wdf-build "a team task management dashboard with React + Express + PostgreSQL"

# Party Mode for complex domain
/wdf-build --party "a HIPAA-compliant patient portal" --expert "healthcare-compliance"

# Quick mode (simple project, skip analysis)
/wdf-build --complexity simple --skip-analysis "a URL shortener with Express + SQLite"

# Full-stack mode
/wdf-build --dev-mode fullstack "a real-time chat app with Next.js"
```

---

## Full Spec References

- Party Mode: `commands/wdf-party.md` and `references/party/*.md`
- Interactive planning: See `SKILL.md` "## On Activation Step 1-7" and Main Menu
- Automated implementation: See `SKILL.md` "## Auto-Run Mode" and slot management
- Story execution: See `commands/wdf-story.md`
- Merge queue: See `commands/wdf-queue.md`
- Acceptance: See `commands/wdf-accept.md`

## Orchestrator Implementation

The build command orchestrates:

1. **Project initialization** via init command
2. **Phase 1-3 execution** via phase commands (interactive or Party Mode)
3. **Freeze checkpoints** via freeze command
4. **Phase 4 story execution** via StoryRunner
5. **Merge queue processing** via queue command
6. **Acceptance gates** via accept command
7. **Final report** generation

See `orchestrator/src/orchestrator/index.ts` build command handler.
