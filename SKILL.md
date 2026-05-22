---
name: wdf
version: "3.6.0"
description: Automates the full lifecycle of web project development — PRD through frontend-backend parallel implementation with dual-layer FSM state management, Gate Cards, Change Requests, acceptance command patterns, quality gates, and auto-run hands-free execution mode. Restructured around BMAD's 4-phase model (Analysis → Planning → Solutioning → Implementation). Use when the user says "start web project", "web development workflow", "build a web app", "full-stack development", "web-dev-flow", or wants to go from idea to deployed web application.
allowed-tools: Read Write Bash Grep Glob Edit Agent Task Skill
metadata:
  tags: web-dev, workflow, full-stack, development, automation
  platforms: Claude
  keyword: web-dev-flow
  source: user-installed skill
---
# @web-dev-flow /web-dev-flow — 可用指令
#
# 工作流控制:
#   /web-dev-flow init              — 初始化新项目
#   /web-dev-flow status            — 显示进度仪表盘
#   /web-dev-flow start             — 开始/恢复当前Phase
#   /web-dev-flow report            — 生成项目报告
#   /web-dev-flow pause             — 暂停工作流（保存现场）
#   /web-dev-flow resume            — 从暂停点恢复
#
# Phase 控制:
#   /web-dev-flow phase 2           — 进入Phase 2 (Planning)
#   /web-dev-flow phase 3 status    — 查看Phase 3详情
#
# 冻结指令:
#   /web-dev-flow freeze requirements    — 冻结需求
#   /web-dev-flow freeze dev-order       — 冻结开发顺序
#
# 验收指令:
#   /web-dev-flow accept code       — 执行 CODE ACCEPTANCE
#   /web-dev-flow accept ui         — 执行 UI ACCEPTANCE
#   /web-dev-flow accept feature    — 执行 FEATURE ACCEPTANCE
#   /web-dev-flow accept e2e        — 执行 E2E BROWSER ACCEPTANCE
#
# 门禁与CR:
#   /web-dev-flow gate 3            — 检查Phase 3门禁
#   /web-dev-flow cr list           — 查看变更请求
#   /web-dev-flow cr create         — 创建变更请求
#
# 合并队列:
#   /web-dev-flow queue show        — 查看合并队列
#   /web-dev-flow queue retry S-3.1 — 重试失败合并
#
# Agent 控制:
#   /web-dev-flow agent status      — 查看活跃agent
#   /web-dev-flow agent dispatch    — 手动分派agent
#   /web-dev-flow rebuild-status    — 重建状态索引
---

# Web Development Automation Workflow V3.6

**Goal:** Orchestrate the complete web project development lifecycle through 4 BMAD-aligned phases: Analysis, Planning, Solutioning, and Implementation. Produces production-ready artifacts at each phase with dual-layer FSM state management, acceptance command patterns, quality assurance, and a hands-free auto-run mode for fully automated development.

**Your Role:** You are a **thin orchestrator** — a state machine engine that manages FSM transitions, evaluates Gate Cards, and dispatches independent sub-agents for every step. You load the MINIMUM context needed for correct routing and gating decisions: status/ files, gate cards, prompt templates, artifact frontmatter, and customize.toml. You NEVER load artifact body content (PRD sections, architecture details, story descriptions, code). You ARE allowed to read artifact metadata and structure for gate validation. Every sub-phase and every story is a SEPARATE sub-agent with its own clean context — you never see their content.

**V3.2 Key Improvements over V3.1:**
1. **Auto-Run Mode** — Hands-free execution from Phase 1 to completion. Auto-progresses through phases, auto-dispatches story agents, auto-processes merge queues. Halts only on gate failures, story errors, merge conflicts, or blocking CRs.
2. **Continuous Self-Validation** — Per-story scope verification after each commit, cross-story test/type/lint validation after each merge, system-level artifact consistency checks at phase gates.
3. **Task Triage Auto-Detection** — Concrete criteria for light/serial/parallel mode selection with confidence scoring. No more undefined "auto" path.
4. **Consolidated BE Setup** — Phase 4.3 merges Database + API Client setup into a single sub-phase, fixing the 14 vs 15 sub-phase numbering mismatch across SKILL.md and customize.toml.
5. **Auto-Run Configuration** — Full customize.toml section for concurrency limits, story timeouts, merge queue auto-processing, and integration checks.

**V3.1 Key Improvements over V3.0 (StoryRail Absorption):**
1. **Task Triage (Three-Mode Routing)** — Light/serial/parallel triage at activation. Light tasks skip Phases 1-3. Serial mode uses full phases with sequential Phase 4. Parallel mode enables full concurrency.
2. **Code Standards Gate** — Every story MUST declare `code_standards_source`. Stories without code standards are blocked. Enforced at Phase 3.7 Story Contract Freeze Gate and Phase 4 Story Ready Gate.
3. **Story Contract Freeze Gate** — Hard gate at Phase 3.7 verifying all 7 contract fields (scope_write, out_of_scope, acceptance_checks, code_standards_source, dependencies, parallel_safe, UI truth source). Non-compliant stories are `blocked` and cannot enter Phase 4.
4. **Acceptance Checks Executable Validation** — Rejects placeholder acceptance_checks ("todo", "tbd", "通过测试", "验证页面正常"). Commands must reference real scripts or known binaries.
5. **Protected Paths Enforcement** — `customize.toml` defines 12 protected path categories. Stories whose `scope_write` intersects protected paths are automatically `serial_only`. Enforced at Story Ready Gate (SRG-08).
6. **Handoff Minimum Gate** — `self-check.md` MUST contain non-empty "Commands run" and "Results". `handoff.md` MUST contain non-empty "Summary" and "Files changed". Missing content blocks `SUBMITTED` state transition.
7. **Execution Units** — Stories can declare per-role `execution_units` (backend/frontend) with independent `scope_write` and `acceptance_checks`. Enables finer-grained parallel isolation than track-level splitting.
8. **Merge Queue with Dependency Ordering** — CODE_ACCEPTED stories enter a dependency-ordered merge queue instead of merging immediately. Phase 4.13 processes the queue by `merge_order`, respecting `depends_on`. Supports `waiting_dependency` → `queued` → `merged` lifecycle.
9. **Contract Gate (API/Data Model stories)** — Before coding, API stories must verify field-level contract compliance (endpoint list, field names, snake_case/camelCase mapping, adapter logic).
10. **Page Parity Gate (Frontend stories)** — Before coding, frontend page stories must read UX specs and output a gap list against prototypes. After coding, browser runtime verification with fixed-viewport screenshots is required.

**V3 Key Improvements over V2:**
1. **BMAD 4-Phase Restructuring** — Workflow aligned to BMAD's Analysis → Planning → Solutioning → Implementation model (down from 9 phases)
2. **Dual-Layer FSM** — Phase-level + story-level state machines with explicit acceptance states (CODE_ACCEPTANCE, FEATURE_ACCEPTANCE, UI_ACCEPTANCE, E2E_BROWSER_ACCEPTANCE)
3. **Acceptance Command Patterns** — 4 executable acceptance gate types replace verbal approval: code_acceptance, feature_acceptance, ui_acceptance, e2e_browser_acceptance
4. **Expanded Gate Card System** — 11 check types (7 original + 4 acceptance) for comprehensive quality verification
5. **Sub-Workflows** — All 4 phases have detailed sub-phase breakdowns (36 total sub-phases)
6. **Change Request System** — Blocking/non-blocking CRs for upstream artifact changes
7. **Standardized Schemas** — All artifacts follow a unified frontmatter schema with BMAD state tracking
8. **sprint-status.yaml as System of Record** — Read/write state center with validation
9. **Quality Gates** — Configurable thresholds in customize.toml, now with acceptance-specific gates
10. **Requirements Freeze** — Formal freeze at Phase 2.5
11. **Development Order Freeze** — Sequenced task ordering at Phase 3.7
12. **Auto-Continue Story Development** — Orchestrator dispatches a SEPARATE sub-agent per story with clean context (~38KB). Sub-agent returns CODE_ACCEPTED; orchestrator merges and loops to next story. No shared context between stories. Halt only on errors or cross-track dependency blocks.
13. **Story Pack & Acceptance (StoryRail-inspired)** — Each story defines `parallel_safe`, `scope_write`, and `acceptance_check`. Story Ready Gate enforces preconditions. Handoff documents (self-check.md, handoff.md) provide audit trail. Executable acceptance checks replace verbal approval.
14. **Phased Requirements Analysis** — Phase 1 split into 3 sub-phases using proven industry methodologies (Impact Mapping, Event Storming, JTBD). Phase 1 is optional and skippable.

## Conventions

- Bare paths (e.g. `references/phase-02-planning.md`) resolve from the skill root.
- `{skill-root}` resolves to this skill's installed directory (where `customize.toml` lives).
- `{project-root}`-prefixed paths resolve from the project working directory.
- `{skill-name}` resolves to the skill directory's basename.
- **V3.6 Template Variable Resolution:** `{sprint_tracking}` resolves to the derived sprint-status.yaml (READ-ONLY). When sub-workflow files use `{sprint_tracking}` in a WRITE context, the orchestrator redirects to the appropriate `{status_phase_0N_file}` or `{status_global_file}` based on the current phase. See `references/variables.md` for the full Write Permission Matrix.

## WORKFLOW ARCHITECTURE

### Phase-File Architecture (V3.6 — Thin Orchestrator Model)

- **Orchestrator as State Machine**: The main agent is a THIN state machine. It reads status/ files + customize.toml + gate card files from `references/gate-cards/`. It reads prompt templates from `references/prompt-templates/`. It may read artifact frontmatter for metadata validation. It NEVER loads artifact body content (analysis, PRD, architecture, stories, code).
- **Gate Cards Extracted**: Each phase's gate card is an independent file at `references/gate-cards/phase-0N-gate.md`. The orchestrator reads ONLY these small files (~20-50 lines), never the full phase reference files (~400-1500 lines).
- **Prompt Templates Extracted**: Each phase's sub-agent prompt templates are standalone files at `references/prompt-templates/phase-0N-prompts.md`. The orchestrator reads these to dispatch sub-agents, WITHOUT loading full phase reference files. This resolves the Thin Orchestrator paradox — the orchestrator has enough context to route correctly without loading artifact body content.
- **Sub-Agent per Step**: Every sub-phase dispatches a SEPARATE sub-agent. The sub-agent receives ONLY the documents relevant to that specific step (clean context).
- **Context Firewall**: Sub-agent context is NEVER propagated back to the orchestrator. The orchestrator only reads the sub-agent's return status and per-story/per-phase status files.
- **Phase Isolation**: Each phase's gate card and sub-agent prompt templates are defined in the phase reference file. The orchestrator reads only these sections, never the full file content.
- **Sequential Phasing**: Phases 1-3 execute sequentially. Phase 4 may dispatch parallel sub-agents.
- **Dual-Layer FSM State Tracking**: Phase completion follows a strict state machine tracked in sprint-status.yaml, with story-level FSM for implementation sub-phases.

### Core Principles

1. **THIN ORCHESTRATOR**: You are a state machine, not a worker. You manage FSM transitions, gate evaluations, and status file updates. You may read artifact frontmatter, structure, and metadata for gate validation. You do NOT read artifact body content or perform analysis, design, or implementation.
2. **SUB-AGENT FOR EVERY STEP**: Every sub-phase dispatches a SEPARATE sub-agent. The sub-agent's context is clean and contains ONLY the documents relevant to that specific step.
3. **STATE ONLY**: You only manage FSM transitions, gate evaluations, and sprint-status.yaml updates.
4. **READ METADATA, NOT CONTENT**: You read sprint-status.yaml, gate card definitions, customize.toml, prompt templates, and artifact frontmatter (metadata). You NEVER read the full content of analysis docs, PRDs, architecture docs, or code files. Reading frontmatter for gate validation (e.g., `status: approved`) is metadata access, NOT content loading.
5. **DISPATCH AND FORGET**: You dispatch a sub-agent, wait for its result, update state, and move on. The sub-agent's context is never retained in your session.
6. **FOLLOW FSM**: State transitions must follow the defined FSM. No skipping states.

### Critical Rules (NO EXCEPTIONS)

- NEVER load artifact body content into your context (PRD sections, architecture details, story descriptions, code)
- ALLOWED: status/ files + gate-cards/ + customize.toml + prompt-templates/ + artifact frontmatter
- ALLOWED: artifact structural validation (section presence, keyword checks, no placeholders — see Phase 1-3 Output Auto-Validation)
- Every sub-phase dispatches a SEPARATE sub-agent with CLEAN context
- Sub-agent context is NEVER propagated back to the orchestrator
- Auto-validation of Phase 1-3 outputs checks metadata (frontmatter, structure, keywords) — this is structural validation, not content loading
- ALWAYS update the appropriate `status/*.yaml` file after EVERY state transition (see specs/status-directory.md for the Write Permission Matrix)
- sprint-status.yaml is DERIVED — rebuilt from `status/` files on demand with `web-dev-flow rebuild-status`
- NEVER directly write sprint-status.yaml
- Each `status/` file has exactly ONE writer — no two processes ever write to the same file
- ALWAYS evaluate Gate Cards before entering any phase
- NEVER modify LOCKED artifacts without a Change Request
- NEVER load multiple phase files simultaneously
- AUTO-CONTINUE sub-phases (4.4, 4.10): dispatch multiple parallel sub-agents per story
- Sub-agents return `{ status, summary }` — you only read the status

---

## On Activation

### Step 1: Load Config

Read `{skill-root}/customize.toml` to load all configuration values.

### Step 2: Execute Prepend Steps

Execute any commands in `workflow.activation_steps_prepend`.

### Step 2.5: Capability Detection & Backfill Validation (V3.6)

Before proceeding, verify that all required capabilities are available. Any missing capability triggers a clear diagnostic message rather than a cryptic mid-phase failure.

**Check 1 — Git Worktree Support:**
```bash
git worktree list >/dev/null 2>&1 || echo "WARNING: git worktree not available — Phase 4 story isolation disabled"
```

**Check 2 — BMAD Skill Availability (non-blocking):**
For each BMAD skill listed in `customize.toml` `[bmad_skill_fallbacks]`:
- Attempt to load the skill
- If unavailable: log warning, confirm fallback is configured
- Present summary: "{available_count}/{total_count} BMAD skills available, {fallback_count} will use fallback"

**Check 3 — Native Agent File Verification (blocking):**
For each `[bmad_skill_fallbacks.{skill}]` entry:
- Read `agent_file` value (e.g., `"analyst"`)
- Verify `references/agents/{agent_file}.md` exists and is non-empty
- Verify the agent file contains required sections: `## Role`, `## Methodology`, `## Return`
- If ANY native agent file is missing or incomplete → BLOCKING: "Native agent {agent_file}.md missing or incomplete. BMAD skill {skill_name} has no fallback. Add the agent file or install the BMAD skill."

**Check 4 — Agent Tool Availability:**
Verify the Claude Code `Agent` tool is available for dispatching sub-agents. If unavailable, all sub-phase work must run inline (degraded mode — not recommended for Phase 4).

**Capability Summary Display:**
```
── Capability Check ──
✓ Git worktree:       available
✓ BMAD skills:         3/14 available (11 will use native agents)
✓ Native agents:       13/13 verified
✓ Agent tool:          available
──
```

If any blocking check fails, present the diagnostic and halt. Do not proceed to state detection.

### Step 3: Load Persistent Facts

Load any facts from `workflow.persistent_facts`.

### Step 4: Detect State

Read from `{status_dir}/` files to detect current workflow state. See `specs/status-directory.md` for the full Write Permission Matrix and file format.

**Primary state sources (read these files):**
- `{status_global_file}` — `global_state` (dev_mode, task_triage_mode, requirements_frozen_at, development_order_frozen_at, etc.)
- `{status_phase_01_file}` — Phase 1 state + substates
- `{status_phase_02_file}` — Phase 2 state + substates
- `{status_phase_03_file}` — Phase 3 state + substates
- `{status_phase_04_be_file}` — Phase 4 BE track state + substates + stories
- `{status_phase_04_fe_file}` — Phase 4 FE track state + substates + stories
- `{status_change_requests_file}` — Open change requests

If any status file doesn't exist, its phase/track hasn't started yet — treat as `NOT_STARTED`.

**If the entire `status/` directory doesn't exist:**
- Present: "No workflow detected. Initialize a new project? [Y] Run init [N] Exit"
- If Y → Run Init Command (dispatch bootstrap sub-agent to generate status/ directory skeleton)
- If N → Exit

**Derived sprint-status.yaml (read-only convenience view):**
- If sprint-status.yaml exists: use it as a read-only convenience view, but state updates go to `status/` files
- If sprint-status.yaml is corrupted or missing: rebuild from `status/` files via `web-dev-flow rebuild-status`

Parse the status files to determine:
- `global_state.dev_mode` — separated or full_stack (determines Phase 4 routing)
- `global_state.overall_status` — overall workflow status
- `global_state.current_phase` — which phase is active
- `global_state.requirements_frozen_at` — whether requirements are frozen
- `global_state.development_order` — the development task sequence
- Each phase's current FSM state
- Each sub-phase's current FSM state
- Open Change Requests (especially blocking ones)

### Step 5: Present Status Overview

Display a concise status dashboard:

```
═══════════════════════════════════════════
Project: {project_name}
Workflow: web-dev-flow v3.6.0
Overall: {overall_status}
Dev Mode: {separated | full_stack}
Triage Mode: {light | serial | parallel}
Requirements: {frozen | not frozen}
Dev Order: {frozen | not frozen}
Code Standards: {sources}
Last Updated: {updated_at}
═══════════════════════════════════════════

Phase 1 [████] LOCKED    Analysis (optional pre-research)
Phase 2 [████] LOCKED    Planning (PRD + UX Design)
Phase 3 [████] LOCKED    Solutioning (Architecture + Epics + Stories + API)
Phase 4 [░░░░] NOT_START Implementation (BE + FE + Integration)

Blockers: {count or "None"}
Change Requests: {count} ({N} blocking)
Merge Queue: {queued} queued, {merged} merged, {waiting} waiting
```

For Phase 1 if IN_PROGRESS, show sub-phase details:
```
Phase 1 [██░░] IN_PROGRESS Analysis (optional)
  └─ 1.1 [████] LOCKED    Brainstorming
  └─ 1.2 [░░░░] SKIPPED   Domain Research
  └─ 1.3 [░░░░] NOT_START Product Brief
```

For Phase 2 if IN_PROGRESS, show sub-phase details:
```
Phase 2 [██░░] IN_PROGRESS Planning
  └─ 2.1 [██░░] ACTIVE    Impact Mapping
  └─ 2.2 [░░░░] NOT_START Event Storming
  └─ 2.3 [░░░░] NOT_START Jobs to Be Done
  └─ 2.4 [░░░░] NOT_START Story Mapping
  └─ 2.5 [░░░░] NOT_START Kano + RICE + PRD
  └─ 2.6 [░░░░] NOT_START User Flows & IA
  └─ 2.7 [░░░░] NOT_START Wireframes
  └─ 2.8 [░░░░] NOT_START Design System
  └─ 2.9 [░░░░] NOT_START Interaction Design
  └─ 2.10[░░░░] NOT_START Design Acceptance
```

For Phase 3 if IN_PROGRESS, show sub-phase details:
```
Phase 3 [██░░] IN_PROGRESS Solutioning
  └─ 3.1 [████] LOCKED    System Context
  └─ 3.2 [████] LOCKED    Architecture Style
  └─ 3.3 [████] LOCKED    Container Design
  └─ 3.4 [░░░░] NOT_START Quality Attributes
  └─ 3.5 [░░░░] NOT_START Component Design
  └─ 3.6 [░░░░] NOT_START Epics & Feature Plan
  └─ 3.7 [░░░░] NOT_START Story Design
  └─ 3.8 [░░░░] NOT_START API & Data Design
  └─ 3.9 [░░░░] NOT_START Readiness Check
```

For Phase 4 if IN_PROGRESS, show sub-phase details:
```
Phase 4 [██░░] IN_PROGRESS Implementation
  └─ 4.1 [████] LOCKED    Sprint Planning
  └─ 4.2 [████] LOCKED    BE Scaffolding
  └─ 4.3 [████] LOCKED    BE Database & API Client
  └─ 4.4 [██░░] ACTIVE    BE Endpoints (2/5 stories)
  └─ 4.5 [░░░░] NOT_START BE Testing Suite
  └─ 4.6 [░░░░] NOT_START BE CODE_ACCEPTANCE
  └─ 4.7 [████] LOCKED    FE Scaffolding
  └─ 4.8 [████] LOCKED    FE Design System
  └─ 4.9 [████] LOCKED    FE API Client
  └─ 4.10[██░░] ACTIVE    FE Pages (1/4 stories)
  └─ 4.11[░░░░] NOT_START FE A11y & Perf Audit
  └─ 4.12[░░░░] NOT_START FE UI_ACCEPTANCE
  └─ 4.13[░░░░] NOT_START Integration
  └─ 4.14[░░░░] NOT_START Retrospective
```

### Step 6: Execute Append Steps

Execute any commands in `workflow.activation_steps_append`.

### Step 7: Task Triage (V3.1)

After status display, determine the appropriate execution mode based on project assessment or `customize.toml` `defaults.task_triage_mode`:

**Mode A: Lightweight (轻量直跑)**
- **适用**: 单文件修复、配置调整、小范围bug修复、局部文档修改
- **流程**: 跳过 Phase 1-3，直接进入简化实现 → 定向验证 → 完成
- **触发**: `task_triage_mode = "light"` 或任务规模被判断为小
- **不进入**: StoryRail 完整流程

**Mode B: Serial (串行模式)**
- **适用**: 中等复杂度、2-5 stories、暂不需要多 Agent 并发、但需要标准化交卷和验收收口
- **流程**: 完整 Phase 1-3（跳过非必要子阶段）→ Phase 4 串行执行
- **触发**: `task_triage_mode = "serial"` 或 `task_triage_mode = "auto"` 且判断为中等规模
- **特点**: Phase 4 stories 按 development_order 逐个执行，不启用并行 track

**Mode C: Parallel (并行模式)**
- **适用**: 大型任务、5+ stories、scope_write 边界清晰、需要多 Agent 并行
- **流程**: 完整 4 阶段流程，Phase 4 BE+FE tracks 并行
- **触发**: `task_triage_mode = "parallel"` 或 `task_triage_mode = "auto"` 且判断为大型规模
- **特点**: 完整的 protected paths 检查、execution_units 支持、merge queue 依赖排序

**Triage Prompt (when `task_triage_mode = "auto"`):**

```
Based on the project assessment, I recommend:

[ ] Mode A — Lightweight: {reason}
[ ] Mode B — Serial: {reason}  
[ ] Mode C — Parallel: {reason}

Recommended: Mode {X}

Which mode would you like to use? [A/B/C]
```

If the user's project description clearly indicates scale, auto-select the mode. For ambiguous cases, present the prompt.

Record the selection in `{status_global_file}` under `global_state.task_triage_mode`.

**Lightweight mode sub-phase skipping:**
When Mode A is active, the workflow bypasses all Phase 1-3 sub-phases and enters a simplified implementation flow:
- Skip: scaffold verification, design system setup, full testing suite
- Keep: core implementation, handoff docs (self-check.md + handoff.md), basic verification
- Gate Cards are simplified to `artifact_exists` + `user_confirmation` only

---

## Sub-Agent Clean Context Specification

Every step dispatches a SEPARATE sub-agent. The sub-agent's context is CLEAN. The orchestrator NEVER loads work content.

### Orchestrator's Context (ALWAYS — the only things the main agent reads)

| Document | Purpose |
|----------|---------|
| `customize.toml` | Configuration, paths, thresholds |
| `status/global.yaml` | Global state (dev_mode, triage, freeze timestamps) |
| `status/phase-0N.yaml` | Per-phase state, substates, FSM status, gate results |
| `status/phase-04-be.yaml` + `status/phase-04-fe.yaml` | Phase 4 track state, story statuses |
| `status/change-requests.yaml` | Open CRs and their statuses |
| `status/stories/*-status.yaml` | Per-story detailed status (read after agent returns) |
| `status/merge-queue/items/*.yaml` | Merge queue entries |
| Phase gate card file | Gate checks for current phase |
| Phase prompt template file | Sub-agent dispatch templates |

### Per-Step Sub-Agent Contexts (NEVER loaded by orchestrator)

| Phase | Sub-Phase | Sub-Agent Clean Context |
|-------|-----------|------------------------|
| 1 | 1.1 Brainstorming | Project description |
| 1 | 1.2 Domain Research | Research topics |
| 1 | 1.3 Product Brief | Brainstorming + Research outputs |
| 2 | 2.1 Impact Mapping | Product Brief + project description |
| 2 | 2.4 Story Mapping | Impact Map + Event Storm + JTBD |
| 2 | 2.5 PRD | Story Map + Impact Map |
| 2 | 2.6 User Flows | PRD + Story Map |
| 2 | 2.7 Wireframes | User Flows + PRD |
| 2 | 2.10 Design Acceptance | Wireframes + PRD |
| 3 | 3.1 System Context | PRD |
| 3 | 3.2 Architecture Style | System Context |
| 3 | 3.3 Container Design | Architecture Style + System Context |
| 3 | 3.5 Component Synthesis | Container Design |
| 3 | 3.6 Epics | Architecture + PRD |
| 3 | 3.7 Stories | Epics + Architecture |
| 3 | 3.8 API & Data | Stories + Architecture + PRD |
| 3 | 3.9 Readiness Check | All Phase 3 outputs |
| 4 | 4.1 Sprint Planning | Stories + Architecture + Dev Order |
| 4 | 4.2 BE Scaffolding | Architecture + API Spec + DB Schema |
| 4 | 4.3 BE DB + API Client | API Spec + DB Schema + Architecture |
| 4 | **4.4 BE Story** | **Story file + API Spec + Architecture + DB Schema ONLY** |
| 4 | 4.5 BE Testing | All BE stories + API Spec |
| 4 | 4.6 BE Review | All BE artifacts |
| 4 | 4.7 FE Scaffolding | Architecture + API Spec + Design Tokens |
| 4 | 4.8 FE Design System | Design Tokens + Architecture |
| 4 | 4.9 FE API Client | API Spec |
| 4 | **4.10 FE Story** | **Story file + API Spec + Wireframes + Design Tokens + Architecture ONLY** |
| 4 | 4.11 FE Audit | All FE pages |
| 4 | 4.12 FE Review | All FE artifacts |
| 4 | 4.13 Integration | All BE + FE artifacts + API Spec |
| 4 | 4.14 Retrospective | Sprint status + All artifacts |

**Key:** Bold rows are the most critical for context isolation — each story sub-agent gets ONLY ~5 files (~38KB).

---

## Phase Routing

### Mode-Dependent Routing

The workflow adapts based on `global_state.dev_mode` (set in Phase 3):

**`separated` mode** (separated architecture — React + Express, Vue + Nest, etc.):
| Phase | Reference File | Gate Card File | 
|-------|---------------|----------------|
| Phase 1 | `./references/phase-01-analysis.md` — skippable | `./references/gate-cards/phase-01-gate.md` |
| Phase 2 | `./references/phase-02-planning.md` → sub-phase menu | `./references/gate-cards/phase-02-gate.md` |
| Phase 3 | `./references/phase-03-solutioning.md` → sub-phase menu | `./references/gate-cards/phase-03-gate.md` |
| Phase 4 | Menu → sub-workflow files below | `./references/gate-cards/phase-04-gate.md` |

**`full_stack` mode** (unified codebase — Next.js, Nuxt, Remix, etc.):
| Phase | Reference File | Gate Card Requirement |
|-------|---------------|----------------------|
| Phase 1-3 | Same as separated mode above | Same gates |
| Phase 4 | `./references/phase-04-implementation.md` | Architecture approved + API spec approved |

### Phase 1 Sub-Routing (Analysis — Optional Pre-Research, Skippable)

| Sub-Phase | Reference File | Gate | Methodology |
|-----------|---------------|------|-------------|
| 1.1 | `./references/sub-workflows/analysis/1-1-brainstorming.md` | None (entry point) — **SKIPPABLE** | Brainstorming (BMAD) |
| 1.2 | `./references/sub-workflows/analysis/1-2-domain-research.md` | None — **SKIPPABLE** | Domain Research (BMAD) |
| 1.3 | `./references/sub-workflows/analysis/1-3-product-brief.md` | None — **SKIPPABLE** | Product Brief (BMAD) |

**Minimum Viable Path:** Skip all 3 sub-phases for simple projects, enter directly at Phase 2

### Phase 2 Sub-Routing (Planning — 10 Sub-Phases)

| Sub-Phase | Reference File | Gate Condition | Skip? |
|-----------|---------------|----------------|-------|
| 2.1 | `./references/sub-workflows/planning/2-1-impact-mapping.md` | None (entry point) | No |
| 2.2 | `./references/sub-workflows/planning/2-2-event-storming.md` | None | Yes |
| 2.3 | `./references/sub-workflows/planning/2-3-jobs-to-be-done.md` | None | Yes |
| 2.4 | `./references/sub-workflows/planning/2-4-story-mapping.md` | 2.1 locked | No |
| 2.5 | `./references/sub-workflows/planning/2-5-prioritization-spec.md` | 2.4 locked | No |
| 2.6 | `./references/sub-workflows/planning/2-6-user-flows.md` | 2.5 locked | No |
| 2.7 | `./references/sub-workflows/planning/2-7-wireframes.md` | 2.6 locked | No |
| 2.8 | `./references/sub-workflows/planning/2-8-design-system.md` | 2.7 locked | Yes |
| 2.9 | `./references/sub-workflows/planning/2-9-interaction-design.md` | 2.7 locked | Yes |
| 2.10 | `./references/sub-workflows/planning/2-10-design-acceptance.md` | 2.7 locked | No |

### Phase 3 Sub-Routing (Solutioning — 9 Sub-Phases)

| Sub-Phase | Reference File | Gate Condition | Skip? |
|-----------|---------------|----------------|-------|
| 3.1 | `./references/sub-workflows/solutioning/3-1-system-context.md` | PRD approved | No |
| 3.2 | `./references/sub-workflows/solutioning/3-2-architecture-style.md` | 3.1 locked | No |
| 3.3 | `./references/sub-workflows/solutioning/3-3-container-design.md` | 3.2 locked | No |
| 3.4 | `./references/sub-workflows/solutioning/3-4-quality-attributes.md` | 3.3 locked | Yes |
| 3.5 | `./references/sub-workflows/solutioning/3-5-component-synthesis.md` | 3.3 locked | No |
| 3.6 | `./references/sub-workflows/solutioning/3-6-epics.md` | 3.5 locked | No |
| 3.7 | `./references/sub-workflows/solutioning/3-7-stories.md` | 3.6 locked | No |
| 3.8 | `./references/sub-workflows/solutioning/3-8-api-design.md` | 3.7 locked | No |
| 3.9 | `./references/sub-workflows/solutioning/3-9-readiness-check.md` | 3.8 locked | No |

**Phase 3.7/3.8 Ordering:** Stories (3.7) define API contract requirements BEFORE API spec (3.8). Each API story declares needed endpoints and field contracts. Sub-phase 3.8 synthesizes all story-level contracts into a unified OpenAPI spec. No circular dependency.

### Separated Mode — Phase 4 Sub-Routing (Implementation — 14 Sub-Phases)

| Sub-Phase | Reference File | Gate |
|-----------|---------------|------|
| 4.1 | `./references/sub-workflows/implementation/4-1-sprint-planning.md` | phase_3 LOCKED + requirements_frozen_at + dev_order_frozen_at |
| 4.2 | `./references/sub-workflows/implementation/4-2-be-scaffolding.md` | 4.1 locked |
| 4.3 | `./references/sub-workflows/implementation/4-3-be-database.md` | 4.2 locked — DB migrations + API client |
| 4.4 | `./references/sub-workflows/implementation/4-4-be-api-endpoints.md` | 4.3 locked — **AUTO-CONTINUE** (endpoint impl) |
| 4.5 | `./references/sub-workflows/implementation/4-5-be-testing-suite.md` | All 4.4 stories approved |
| 4.6 | `./references/sub-workflows/implementation/4-6-be-completion-review.md` | 4.5 locked — **CODE_ACCEPTANCE GATE** (`/bmad-code-review`) |
| 4.7 | `./references/sub-workflows/implementation/4-7-fe-scaffolding.md` | 4.1 locked (parallel with BE) |
| 4.8 | `./references/sub-workflows/implementation/4-8-fe-design-system.md` | 4.7 locked |
| 4.9 | `./references/sub-workflows/implementation/4-9-fe-api-client.md` | 4.8 locked |
| 4.10 | `./references/sub-workflows/implementation/4-10-fe-page-implementation.md` | 4.8 + 4.9 locked — **AUTO-CONTINUE** |
| 4.11 | `./references/sub-workflows/implementation/4-11-fe-a11y-perf-audit.md` | All 4.10 stories CODE_ACCEPTED |
| 4.12 | `./references/sub-workflows/implementation/4-12-fe-completion-review.md` | 4.11 locked — **UI_ACCEPTANCE GATE** |
| 4.13 | `./references/sub-workflows/implementation/4-13-integration.md` | 4.6 CODE_ACCEPTED + 4.12 UI_ACCEPTED — **FEATURE_ACCEPTANCE + E2E_BROWSER_ACCEPTANCE GATE** |
| 4.14 | `./references/sub-workflows/implementation/4-14-retrospective.md` | 4.13 locked |

---

## Auto-Run Mode (Hands-Free Execution)

When the orchestrator runs in auto-run mode (no user interaction required), the following protocol governs the end-to-end execution:

### Activation

Auto-run mode is activated when:
- `task_triage_mode` is resolved to `"serial"` or `"parallel"`
- User has confirmed the execution mode via Step 7 triage prompt (or it was auto-selected)
- The orchestrator has a complete project description

### Auto-Run Lifecycle

```
Phase 1 (skippable) → Phase 2 → Phase 3 → Phase 4 (BE ═ FE parallel) → Integration → Complete
    ↑ Skip if light mode         ↑             ↑
    └─── User skips ─────────────┘             └─── Auto-dispatches story agents
```

### Phase Progression Rules

1. **Sequential Phase Gating**: Each phase evaluates its Gate Card. On pass → auto-enter. On fail → report failing checks, halt for user intervention.
2. **Sub-Phase Auto-Advance**: Within a phase, sub-phases execute sequentially. When a sub-phase reaches LOCKED, auto-advance to the next.
3. **Skippable Sub-Phases**: Sub-phases marked `skip_allowed: true` are auto-skipped unless the project context indicates they would add value.
4. **Gate Failures**: Any gate check failure halts auto-run. The orchestrator displays the failing checks and waits for user resolution. No automatic gate override.
5. **Phase Transitions**: When a phase reaches its final state (LOCKED or SKIPPED), auto-advance to the next phase.

### Phase 4 Auto-Run Behavior

1. **Track Dispatch**: BE Track (4.2-4.6) and FE Track (4.7-4.12) are initialized in parallel once 4.1 is LOCKED.

2. **Parallel Sub-Agent Dispatch Model**: The orchestrator identifies ALL eligible stories and dispatches them as independent sub-agents CONCURRENTLY. Each sub-agent gets a clean context (~38KB), its own git worktree, and has zero awareness of other running sub-agents. The orchestrator never loads sub-agent context.

   **Eligibility for parallel dispatch:**
   - Story status is `NOT_STARTED`
   - All `depends_on` stories are `CODE_ACCEPTED` or `MERGED`
   - `scope_write` does NOT overlap with any other currently RUNNING story
   - NOT on a `protected_path` (or, if it is, no other protected-path story is running)

   **Dispatch algorithm with slot management:**
   ```
   CONSTANTS:
     MAX_SLOTS = {auto_run.concurrency.max_concurrent_stories}  # default 5
     SERIAL_SLOT = 1  # serial_only stories use 1 dedicated slot

   STATE:
     slots_used = 0           # currently dispatched agents
     serial_slot_busy = false # whether a serial_only story is running
     serial_queue = []        # serial_only stories waiting for SERIAL_SLOT

   FUNCTION dispatch_loop(track):
     1. Read development_order from status/ files
     2. Filter stories by track, sort by order ASC

     3. WHILE any story NOT_STARTED or IN_PROGRESS:

        # Phase 0: Check pause flag (V3.6)
        IF {status_global_file}.pause_requested == true:
          Log "Pause requested — halting new dispatches"
          WAIT for all running agents to return
          GOTO pause_drain_complete

        # Phase A: Identify eligible stories
        eligible = []
        FOR each story WHERE status == NOT_STARTED:
          IF all depends_on are MERGED:
            IF serial_only (scope_write ∩ protected_paths):
              add to serial_queue (sorted by order ASC)
            ELSE:
              eligible.append(story)

        # Phase B: Fill parallel slots
        WHILE slots_used < MAX_SLOTS AND eligible NOT empty:
          # Check scope_write overlap with RUNNING stories
          next = eligible[0]
          IF next.scope_write overlaps NO running story's scope_write:
            eligible.remove(next)
            slots_used++
            DISPATCH Agent({ prompt: agent_file, isolation: "worktree" })
              → story.status = IN_PROGRESS
          ELSE:
            eligible.remove(next)  # skip, will retry next cycle

        # Phase C: Fill serial slot (one at a time)
        IF NOT serial_slot_busy AND serial_queue NOT empty:
          next = serial_queue[0]
          IF next.scope_write overlaps NO running story's scope_write:
            serial_queue.remove(next)
            serial_slot_busy = true
            slots_used++
            DISPATCH Agent({ prompt: agent_file, isolation: "worktree" })
              → story.status = IN_PROGRESS

        # Phase D: Wait for completion, process results
        WAIT for ANY dispatched agent to return { story_id, status }
        slots_used--

        IF status == CODE_ACCEPTED:
          # Atomic merge (see specs/worktree-isolation.md)
          git merge --no-commit --no-ff story/{id}-{track}
          Run integration_checks → commit OR abort
          IF merged: story.status = MERGED, update status/ files
          IF failed: story.status = FAILED, halt auto-run

          IF story was serial_only:
            serial_slot_busy = false

          # Hidden dependency detection (see specs/merge-queue.md)
          Run cross-branch diff analysis for remaining queued stories

        ELIF status == FAILED:
          Halt auto-run → present recovery dashboard

        # Phase E: Re-evaluate eligibility
          Dependencies may now be satisfied (merged stories unblock dependents)
          New slots available → loop back to Phase A

      END WHILE

      IF all stories MERGED: track_complete = true
      IF any story BLOCKED_BY_DEPENDENCY with no path to resolution: halt
   ```

   **Slot management guarantees:**
   - At most `MAX_SLOTS` agents run concurrently
   - `serial_only` stories always run alone (dedicated SERIAL_SLOT, blocks all other dispatches)
   - `scope_write` overlap check occurs at dispatch time AND when new dependencies resolve
   - Slot freed immediately upon agent return — next eligible story dispatched without waiting for batch completion
   - Merge is ALWAYS sequential (single-threaded on main branch), independent of slot count

   **Example — 6 stories, MAX_SLOTS=3, 2 serial_only:**
   ```
   T=0:  Slots[0]=S-3.1(serial)  Slots[1]=idle  Slots[2]=idle
         → serial_slot_busy=true, no other dispatches
   T=1:  S-3.1 completes → serial_slot_busy=false
   T=1:  Slots[0]=S-1.1(FE)  Slots[1]=S-3.2(BE)  Slots[2]=S-4.1(BE)
         → 3 parallel_safe stories dispatched
   T=2:  S-1.1 completes → slot freed
   T=2:  Slots[1]=S-1.2(FE)  ← newly eligible (dep S-1.1 now MERGED)
   T=3:  S-3.2 completes → S-2.1(FE) now unblocked (cross-track dep satisfied)
   T=3:  S-4.1 completes, S-1.2 completes
   T=3:  Slots[0]=S-2.1(FE)  Slots[1]=S-5.1(serial)  ← serial_only, blocks others
   T=4:  S-2.1 completes → serial_slot_busy=true → S-5.1 dispatched alone
   T=5:  S-5.1 completes → all done
   ```

3. **Merge Queue Processing**: As sub-agents return CODE_ACCEPTED, orchestrator merges sequentially (git merge is always sequential on main). Dependency order is respected — if two stories complete simultaneously, lower merge_order is merged first.

4. **Continuous Validation**: After each merge, the orchestrator verifies:
   - `npm run test && npm run type-check && npm run lint` — no regressions
   - Scope audit clean (CA-05)
   - sprint-status.yaml consistency

### Halt Conditions

Auto-run halts and presents a dashboard when:

| Condition | Trigger | Recovery |
|-----------|---------|----------|
| Gate failure | Any phase/sub-phase gate check fails | Fix artifact, re-evaluate gate |
| Story implementation error | Agent returns non-CODE_ACCEPTED | Retry story, skip, or exit |
| Merge conflict | git merge --no-commit --no-ff fails | Manual conflict resolution |
| CR blocking | Blocking CR filed against active phase | Resolve CR, resume |
| Scope violation | Exit verification finds violations | Revert, expand scope, or exit |
| Acceptance check failure | acceptance_check command returns non-zero | Fix code, re-run checks |
| Dependency timeout | Story blocked > N minutes on dep | Report, skip, or wait |

### Auto-Run Halt Recovery Dashboard (V3.6)

When auto-run halts, instead of a bare error menu, the orchestrator presents a recovery dashboard that shows WHAT happened, WHAT state everything is in, and WHAT to do next:

```
═══════════════════════════════════════════
🛑 AUTO-RUN HALTED — {halt_reason}
═══════════════════════════════════════════
Halt reason: {human_readable_description}
Halt time:   {ISO_TIMESTAMP}
Phase:       {current_phase}.{current_sub_phase}
Story:       {story_id or "N/A"}

── EXECUTION STATE ──
✅ Merged stories:   {merged_count}/{total_count}
   {story_id}: {title} — MERGED (commit {short_hash})
   {story_id}: {title} — MERGED (commit {short_hash})

🔄 Active stories:   {active_count}
   {story_id}: {title} — IN_PROGRESS (substep {last_completed_substep}, {elapsed}m)
   {story_id}: {title} — CODE_ACCEPTED, awaiting merge

⏳ Queued stories:   {queued_count}
   {story_id}: {title} — waiting for {dep_story_id}

🔒 Blocked stories:  {blocked_count}
   {story_id}: {title} — BLOCKED_BY_DEPENDENCY ({dep})

── MERGE QUEUE ──
Order  Story      Status              Integration
────── ─────────  ──────────────────  ───────────
10     S-3.1      ✅ merged           all passed
20     S-4.1      🔄 merging          pending
30     S-1.1      ⏳ queued           —
40     S-2.1      🔒 waiting_dep      —

── BRANCH STATE ──
Main branch:    {main_branch_status} ({N} commits ahead of scope-freeze)
Active branches: {list or "none"}
Worktrees:      {count} active ({paths})

── SYSTEM CHECKS ──
Test suite:     {passing|failing|not run}
Type check:     {passing|failing|not run}
Lint:           {passing|failing|not run}
Status files:   {consistent|needs rebuild}
Merge queue:    {clean|stale_lock|needs attention}

───────────────────────────────────────────
Suggested next action: {specific_suggestion}
  [R] Retry failed operation
  [S] Skip and continue
  [A] Abort auto-run, return to manual control
  [D] Show detailed diagnostics
  [B] Rebuild sprint status from status/ files
  [Q] Return to main menu
═══════════════════════════════════════════
```

**Dashboard generation rules:**
- Read `{status_phase_04_be_file}` and `{status_phase_04_fe_file}` for story statuses
- Run `git branch --list 'story/*'` for active branches
- Run `git worktree list 2>/dev/null || echo "N/A"` for worktree state (defensive: show "N/A" if unavailable)
- Run `git log --oneline scope-freeze/pre-implementation..HEAD 2>/dev/null || echo "N/A"` for merged commits
- Read `{status_merge_queue_dir}/items/*.yaml` for queue state
- Read `{status_dir}/stories/*-status.yaml 2>/dev/null` for per-story detail (defensive: skip missing files)
- **Defensive rendering:** Each data source is read independently. If any source fails (corrupted file, git error), show "N/A" for that section. The dashboard MUST render completely — partial data is better than no dashboard.
- **Rebuild safety:** If `rebuild-status` is triggered during auto-run, the orchestrator pauses story dispatch for 2 seconds to allow file I/O to flush before reading the rebuilt index.
- Generate `suggested_next_action` based on halt condition:
  - Story failure → "Retry {story_id} or skip to continue with next story"
  - Merge conflict → "Resolve conflicts in files: {conflict_files}"
  - Gate failure → "Fix artifact {path}: {failing_checks}"
  - Scope violation → "Review violations: {files}. Choose Revert/Expand/Exit"
  - Acceptance failure → "Fix failing checks: {failed_commands}"

**Human-readable error translations (V3.6):** When displaying errors to users, the orchestrator translates internal check IDs to human-readable descriptions:

| Check ID | Internal Meaning | User-Facing Message |
|----------|-----------------|-------------------|
| SRG-01 | scope_write undefined | "Story is missing its file modification scope (scope_write)" |
| SRG-02 | acceptance_check undefined | "Story has no acceptance test commands defined" |
| SRG-03 | Story file missing | "Story file not found at expected path" |
| SRG-04 | Path safety violation | "Story scope contains unsafe paths (absolute, traversal, or forbidden)" |
| SRG-05 | scope_write overlap | "Story scope overlaps with another active story" |
| SRG-06 | Outside implementation boundary | "Story scope extends beyond the approved implementation boundary" |
| SRG-07 | Parent directory missing | "Target directory for story scope doesn't exist yet" |
| SRG-08 | Protected path intersection | "Story touches shared infrastructure — must run in serial mode" |
| SRG-09 | Unsafe acceptance command | "Acceptance check command rejected by safety validator" |
| CA-01 | Code review not passed | "Code review found blocking issues" |
| CA-02 | Test coverage below threshold | "Test coverage is below the required minimum" |
| CA-03 | Type check failed | "TypeScript type checking found errors" |
| CA-04 | Lint failed | "Code linter found errors" |
| CA-05 | Scope audit failed | "Files were modified outside the story's approved scope" |
| MG-01..09 | Merge gate failure | "Integration check failed — see merge queue item for details" |

This dashboard replaces the old error halt menu (section "Error Halt Menu" in 4.4/4.10 sub-workflows) and provides complete situational awareness for recovery. |

### Continuous Self-Validation

During auto-run, the orchestrator continuously validates:

1. **Per-Story Validation** (during implementation):
   - After each commit: verify `git diff --name-only HEAD` ⊆ scope_write
   - After each test run: verify all acceptance_check commands exit 0
   - Before SUBMITTED: verify self-check.md and handoff.md minimum content

2. **Cross-Story Validation** (after each merge):
   - Run `npm run test` to verify no regressions
   - Run `npm run type-check` to verify type integrity
   - Run `npm run lint` to verify code style consistency

3. **System-Level Validation** (at phase gates):
   - sprint-status.yaml consistency check (no orphans, valid FSM states)
   - All artifact checksums match their frontmatter claims
   - Merge queue dependency graph is acyclic

### Task Triage Auto-Detection

When `task_triage_mode = "auto"`, the orchestrator evaluates:

```yaml
triage_criteria:
  light_mode_triggers:
    - estimated_stories <= 2
    - modified_files_scope is "single-file" or "config-only"
    - user_request is "fix" or "update" (not "build" or "create")
    - no_new_dependencies required
    
  serial_mode_triggers:
    - estimated_stories 3-5
    - scope_write has no protected_path intersections
    - user_request is "build" or "create" (moderate scope)
    - single_track_only (backend-only or frontend-only)
    
  parallel_mode_triggers:
    - estimated_stories >= 5
    - multi_track (BE + FE both required)
    - scope_write boundaries are clearly separable
    - user_request is "build" or "create" (large scope)
```

Auto-detection algorithm:
1. Scan project artifacts (stories, architecture, scope_write definitions)
2. Count stories and classify track distribution
3. Check for protected_path intersections
4. Match against criteria matrix above
5. Recommend mode with confidence score
6. If confidence < 80%, present the triage prompt for user selection

---

## Main Menu

After state detection, present the main menu:

```
Available Actions:
[1] Start / Resume Phase {current_phase}
[2] View sprint status (detailed)
[3] Jump to a specific phase (1-4)
[4] View open Change Requests
[5] Check phase/sub-phase status
[6] View Merge Queue status
[7] Exit / Return to project
```

### Menu Option: Start / Resume Phase

Read the current phase reference file. Evaluate its Gate Card. If the gate passes, set the phase status to IN_PROGRESS (if NOT_STARTED) or resume from the current state. Then follow the instructions in the phase reference file.

If the gate fails, display which checks failed and offer options:
- Fix the failing checks and retry
- Override the gate (admin only — requires explicit user confirmation)

### Menu Option: View Sprint Status

Read `{sprint_tracking}` and display the full status dashboard (as shown in On Activation Step 5).

Include additional detail sections:
- Artifact manifest with paths and status
- Recent state transitions (last 10)
- Sub-phase details for active parallel phases

### Menu Option: Jump to a Phase

- If jumping to an earlier phase: warn about CR requirements for downstream artifacts
- If jumping to a phase whose gate is not met: display failing checks
- If jumping to Phase 4: offer parallel execution option
- Validate the jump is legal per FSM rules before proceeding

### Menu Option: View Change Requests

List all CRs from sprint-status.yaml:

```
Change Requests:
{CR-ID} | {severity} | {title} | {status}
```

Allow user to select a CR to view details or resolve.

CR Detail View:
```
CR-{ID}: {title}
Severity: {blocking | non_blocking}
Source Phase: {phase}
Target Phase: {phase}
Target Artifact: {path}
Description: {description}
Proposed Fix: {proposed_fix}
Status: {open | in_progress | resolved}
Created: {timestamp}
Resolved: {timestamp or "N/A"}
---
Actions:
[A] Apply fix and resolve
[B] Mark as non-blocking (downgrade severity)
[C] Close without resolution
[D] Back to list
```

### Menu Option: Check Phase/Sub-Phase Status

Ask user for phase number (1-4). If has sub-phases, ask for sub-phase. Display detailed status including FSM state, gate card results, artifacts, and stories.

### Menu Option: View Merge Queue Status

Display the merge queue from sprint-status.yaml:

```
═══════════════════════════════════════════
Merge Queue Status
═══════════════════════════════════════════
Order  Story ID      Unit     Status              Depends On
────── ────────────  ───────  ──────────────────  ──────────
10     S-3.1         -        ✅ merged           None
20     S-3.2         -        ✅ merged           S-3.1
30     S-4.1         backend  🔄 merging          S-3.2
30     S-4.1         frontend ⏳ queued           S-4.1 (BE)
40     S-2.1         frontend 🔒 waiting_dep      S-4.1 (BE)
```

Allow user to:
- [A] Force promote a waiting item (admin)
- [B] Retry a failed merge
- [C] View merge failure details
- [D] Back to main menu

---

## FSM State Machine Engine

All phases follow this state machine:

```
NOT_STARTED
    ↓ (gate check passes)
IN_PROGRESS
    ↓ (work completed)
DRAFT_COMPLETE
    ↓ (review begins)
IN_REVIEW
    ↓ (review passes)
APPROVED
    ↓ (locked for downstream)
LOCKED
    ↓ (if CR requires unlock)
UNLOCK_RESOLVE → (fix) → IN_REVIEW → APPROVED → LOCKED
```

### Acceptance States

The following acceptance states are used at implementation sub-phases and the system level:

```
CODE_ACCEPTANCE  → CODE_ACCEPTED
FEATURE_ACCEPTANCE → FEATURE_ACCEPTED
UI_ACCEPTANCE → UI_ACCEPTED
E2E_BROWSER_ACCEPTANCE → E2E_BROWSER_ACCEPTED
```

### State Transition Rules

Phase 1 uses a unique phase-level FSM to track sub-phase aggregation:
`NOT_STARTED → IN_PROGRESS → ALL_SUB_PHASES_APPROVED → ANALYSIS_COMPLETE → APPROVED → LOCKED → UNLOCK_RESOLVE`
`NOT_STARTED → SKIPPED` (user opts out of entire Phase 1)

Phase 2 follows the sub-phase aggregation FSM:
`NOT_STARTED → IN_PROGRESS → ALL_SUB_PHASES_APPROVED → PLANNING_COMPLETE → APPROVED → LOCKED → UNLOCK_RESOLVE`

Phase 3 follows the sub-phase aggregation FSM:
`NOT_STARTED → IN_PROGRESS → ALL_SUB_PHASES_APPROVED → SOLUTIONING_COMPLETE → APPROVED → LOCKED → UNLOCK_RESOLVE`

Phase 4 follows the phase-level aggregation FSM:
`NOT_STARTED → IN_PROGRESS → BE_TRACK_COMPLETE → FE_TRACK_COMPLETE → MERGE_QUEUED → FULL_STACK_INTEGRATED → APPROVED → LOCKED`

Standard transition rules:

1. **NOT_STARTED → IN_PROGRESS**: Only if the phase's Gate Card `all_pass` is true
2. **IN_PROGRESS → DRAFT_COMPLETE**: When all work steps are done and artifact is generated
3. **DRAFT_COMPLETE → IN_REVIEW**: When user initiates review
4. **IN_REVIEW → APPROVED**: When user explicitly approves
5. **IN_REVIEW → IN_PROGRESS**: If user requests changes (backtrack)
6. **APPROVED → LOCKED**: When downstream phase starts consuming the artifact
7. **LOCKED → UNLOCK_RESOLVE**: When a blocking Change Request is filed
8. **UNLOCK_RESOLVE → IN_REVIEW**: After fix is applied
9. **Any state → BLOCKED**: When a blocking CR is open (if not handled via UNLOCK_RESOLVE)
10. **CODE_ACCEPTANCE → CODE_ACCEPTED**: When all code acceptance checks pass
11. **FEATURE_ACCEPTANCE → FEATURE_ACCEPTED**: When all feature acceptance checks pass
12. **UI_ACCEPTANCE → UI_ACCEPTED**: When all UI acceptance checks pass
13. **E2E_BROWSER_ACCEPTANCE → E2E_BROWSER_ACCEPTED**: When all E2E browser acceptance checks pass

### Sub-Phase State Machines

Each sub-phase has its own domain-specific FSM. These are the authoritative state transitions as defined in the phase reference files.

**1.1 (Brainstorming):**
`NOT_STARTED → IN_PROGRESS → IDEAS_EXPLORED → SYNTHESIZED → VERIFIED → LOCKED`
`NOT_STARTED → SKIPPED`

**1.2 (Domain Research):**
`NOT_STARTED → IN_PROGRESS → SOURCES_ANALYZED → DOCUMENTED → VERIFIED → LOCKED`
`NOT_STARTED → SKIPPED`

**1.3 (Product Brief):**
`NOT_STARTED → IN_PROGRESS → VISION_DEFINED → USERS_IDENTIFIED → PROBLEMS_DEFINED → VERIFIED → LOCKED`
`NOT_STARTED → SKIPPED`

**2.1 (Impact Mapping):**
`NOT_STARTED → IN_PROGRESS → MAP_DRAFTED → VERIFIED → LOCKED`

**2.2 (Event Storming):**
`NOT_STARTED → IN_PROGRESS → EVENTS_IDENTIFIED → CONTEXTS_MAPPED → VERIFIED → LOCKED`
`NOT_STARTED → SKIPPED`

**2.3 (JTBD):**
`NOT_STARTED → IN_PROGRESS → JOBS_IDENTIFIED → DIMENSIONS_MAPPED → VERIFIED → LOCKED`
`NOT_STARTED → SKIPPED`

**2.4 (Story Mapping):**
`NOT_STARTED → IN_PROGRESS → BACKBONE_BUILT → STORIES_MAPPED → RELEASES_SLICED → VERIFIED → LOCKED`

**2.5 (Kano + RICE + PRD):**
`NOT_STARTED → IN_PROGRESS → FEATURES_CLASSIFIED → PRIORITIZED → PRD_DRAFTED → VERIFIED → LOCKED`

**2.6 (User Flows & IA):**
`NOT_STARTED → IN_PROGRESS → FLOWS_MAPPED → VERIFIED → LOCKED`

**2.7 (Wireframes):**
`NOT_STARTED → IN_PROGRESS → WIREFRAMES_CREATED → VERIFIED → LOCKED`

**2.8 (Design System):**
`NOT_STARTED → IN_PROGRESS → TOKENS_DEFINED → COMPONENTS_SPECIFIED → VERIFIED → LOCKED`
`NOT_STARTED → SKIPPED`

**2.9 (Interaction Design):**
`NOT_STARTED → IN_PROGRESS → INTERACTIONS_DEFINED → STATE_MATRIX → VERIFIED → LOCKED`
`NOT_STARTED → SKIPPED`

**2.10 (Design Acceptance):**
`NOT_STARTED → IN_PROGRESS → DESIGN_REVIEWED → APPROVED → LOCKED`

**3.1 (System Context C4 L1):**
`NOT_STARTED → IN_PROGRESS → CONTEXT_MAPPED → VERIFIED → LOCKED`

**3.2 (Architecture Style):**
`NOT_STARTED → IN_PROGRESS → STYLE_SELECTED → VERIFIED → LOCKED`

**3.3 (Container Design C4 L2):**
`NOT_STARTED → IN_PROGRESS → CONTAINERS_DESIGNED → VERIFIED → LOCKED`

**3.4 (Quality Attributes):**
`NOT_STARTED → IN_PROGRESS → ATTRIBUTES_IDENTIFIED → VERIFIED → LOCKED`
`NOT_STARTED → SKIPPED`

**3.5 (Component Synthesis C4 L3):**
`NOT_STARTED → IN_PROGRESS → COMPONENTS_MAPPED → VERIFIED → LOCKED`

**3.6 (Epics & Feature Plan):**
`NOT_STARTED → IN_PROGRESS → EPICS_DEFINED → FEATURES_PLANNED → VERIFIED → LOCKED`

**3.7 (Story Design + Freeze):**
`NOT_STARTED → IN_PROGRESS → STORIES_DESIGNED → ACCEPTANCE_CHECKS_REVIEWED → DEVELOPMENT_ORDER_FROZEN → LOCKED`

Note: Before freezing, each story's `acceptance_check` commands must pass independent review — another sub-agent validates that checks are executable, cover all acceptance criteria, and are not self-referential placeholders. This prevents the "自己批改自己作业" problem.

**3.8 (API & Data Design):**
`NOT_STARTED → IN_PROGRESS → API_SPEC_DEFINED → DB_SCHEMA_DEFINED → VERIFIED → LOCKED`

**3.9 (Readiness Check):**
`NOT_STARTED → IN_PROGRESS → READINESS_EVALUATED → ALL_GATES_PASSED → LOCKED`

**4.1 (Sprint Planning):**
`NOT_STARTED → IN_PROGRESS → SPRINT_PLANNED → LOCKED`

**4.2 / 4.7 (Scaffolding):**
`NOT_STARTED → IN_PROGRESS → SCAFFOLDED → VERIFIED → LOCKED`

**4.3 (BE Database + API Client Setup):**
`NOT_STARTED → IN_PROGRESS → MIGRATIONS_WRITTEN → MIGRATIONS_RUN → CLIENT_GENERATED → VERIFIED → LOCKED`

**4.4 / 4.10 (Story Implementation — AUTO-CONTINUE):**
`NOT_STARTED → IN_PROGRESS → IMPLEMENTED → TESTED → [SPEC_COMPLIANT|A11Y_CHECKED] → SUBMITTED → APPROVED → CODE_ACCEPTED`
`NOT_STARTED → BLOCKED_BY_DEPENDENCY` (cross-track dep not met)
`SUBMITTED` requires handoff docs (self-check.md + handoff.md) and all acceptance_check commands exit 0.

**4.5 (BE Testing Suite):**
`NOT_STARTED → IN_PROGRESS → TESTS_WRITTEN → ALL_PASSING → COVERAGE_MET → LOCKED`

**4.6 (BE Completion Review):**
`NOT_STARTED → CODE_ACCEPTANCE → CODE_ACCEPTED → LOCKED`

**4.8 (FE Design System):**
`NOT_STARTED → IN_PROGRESS → COMPONENTS_BUILT → DOCUMENTED → REVIEWED → LOCKED`

**4.9 (FE API Client):**
`NOT_STARTED → IN_PROGRESS → CLIENT_GENERATED → MOCKS_READY → VERIFIED → LOCKED`

**4.11 (FE A11y & Perf Audit):**
`NOT_STARTED → IN_PROGRESS → A11Y_PASSED → PERF_PASSED → LOCKED`

**4.12 (FE Completion Review):**
`NOT_STARTED → UI_ACCEPTANCE → UI_ACCEPTED → LOCKED`

**4.13 (Integration):**
`NOT_STARTED → IN_PROGRESS → MERGE_QUEUE_PROCESSED → CONTRACT_VERIFIED → FEATURE_ACCEPTANCE → FEATURE_ACCEPTED → E2E_BROWSER_ACCEPTANCE → E2E_BROWSER_ACCEPTED → APPROVED → LOCKED`

**4.14 (Retrospective):**
`NOT_STARTED → IN_PROGRESS → RETRO_COMPLETED → APPROVED → LOCKED`

---

## Gate Card System

Before entering any phase, evaluate its Gate Card. A Gate Card contains structured checks that go beyond simple file existence.

### Check Types

| Type | Description | Example |
|------|-------------|---------|
| `artifact_exists` | File exists at path | Check prd.md exists |
| `artifact_metadata` | Frontmatter field matches value | Check status is "approved" |
| `artifact_checksum` | SHA-256 hash matches | Verify artifact integrity |
| `user_confirmation` | User must explicitly confirm | "Have you reviewed the PRD?" |
| `dependency_status` | Dependent artifact state | Check phase_1.status is LOCKED |
| `quality_threshold` | Numeric threshold met | Test coverage >= 80% |
| `all_stories_complete` | All non-blocked stories in set done | All 4.4 stories APPROVED (excludes BLOCKED_BY_DEPENDENCY) |
| `code_acceptance` | Code acceptance checks | Review passed, test coverage >= 80%, type check + lint pass |
| `feature_acceptance` | Feature acceptance checks | All stories code accepted, contract verified, E2E critical paths pass |
| `ui_acceptance` | UI acceptance checks | Visual parity, a11y audit clean, Lighthouse scores >= 90, bundle size < 500KB |
| `e2e_browser_acceptance` | E2E browser acceptance | Browser tests pass, visual regression < 0.5%, cross-browser + responsive + network conditions |

### Gate Evaluation

For each check:
1. Execute the check per its type
2. Record result as `pass`, `fail`, or `skipped`
3. Update the check status in sprint-status.yaml

**Auto-Mode Degradation (V3.4):** When `task_triage_mode` is `serial` or `parallel`, `user_confirmation` checks are automatically replaced by their `auto_mode` alternatives defined in the gate card file. This enables hands-free Phase 1-3 execution without human confirmation prompts.

Gate passes only when ALL checks are `pass` → `all_pass: true`.


If any check fails:
- Display which checks failed and why
- Suggest corrective actions
- Do not allow phase entry until all checks pass (or admin override)

### Gate Card Schema

Gate Cards follow the schema defined in `{skill-root}/schemas/gate-card-schema.yaml`:

```yaml
gate_card:
  phase: {phase_number}
  description: "Human-readable description of what this gate verifies"
  checks:
    - id: "check-{n}"
      type: {check_type}
      description: "What this check verifies"
      target: {path or key or threshold value}
      expected: {expected value or condition}
      severity: {blocking | warning}
  all_pass: {true | false}
  evaluated_at: {timestamp}
```

Each phase reference file includes its Gate Card definition. The orchestrator evaluates the card before entering the phase.

---

## Acceptance Command Patterns

V3 introduces 4 executable acceptance gate types that replace verbal approval for implementation quality verification. Each acceptance gate runs a predefined set of checks that must all pass before the next phase can begin.

### 1. Code Acceptance (`code_acceptance`)

Triggered at sub-phase 4.6 (BE Code Acceptance). Validates backend code quality:

```yaml
code_acceptance:
  review_passed: boolean          # Code review completed with approval
  test_coverage: number           # e.g. 80 (percent)
  type_check_passed: boolean      # TypeScript/strict type checking passes
  lint_passed: boolean            # Linter passes with zero errors
  acceptance_checks_all_pass: boolean  # All acceptance_check commands exit 0
  reviewer_session: string        # Reviewer session reference
```

**Command pattern:**
```
> run code acceptance for backend
> verify code acceptance gate
> code acceptance status
```

**CA-01 Fallback (V3.5):** If `/bmad-code-review adversarial` skill is not available or fails, fall back to inline code review:

```bash
# Fallback CA-01: Inline adversarial code review (when /bmad-code-review is unavailable)
# The orchestrator dispatches a dedicated review sub-agent with:
# 1. All files changed since scope-freeze tag
# 2. The story's acceptance criteria
# 3. The project's code_standards_source files
# 4. A checklist: security, correctness, readability, test quality

# The review sub-agent is independent of the implementation sub-agent
# It runs in a clean worktree context (different session if available)
# It outputs a pass/fail verdict with specific findings
```

### 2. Feature Acceptance (`feature_acceptance`)

Triggered at sub-phase 4.13 (Integration). Validates end-to-end feature completeness:

```yaml
feature_acceptance:
  all_stories_code_accepted: boolean   # All stories passed code acceptance
  contract_verified: boolean           # API contract matches spec exactly
  e2e_critical_paths_pass: boolean     # E2E tests for all critical paths pass
  integration_tests_pass: boolean      # Integration test suite passes
  security_audit_pass: boolean         # Security audit (OWASP top 10 or dependency)
```

**Command pattern:**
```
> run feature acceptance
> verify feature acceptance gate
> feature acceptance status
```

### 3. UI Acceptance (`ui_acceptance`)

Triggered at sub-phase 4.12 (FE UI Acceptance). Validates frontend UI quality:

```yaml
ui_acceptance:
  visual_parity: enum[pass, fail]           # Visual comparison against design specs
  a11y_critical_issues: number              # Should be 0
  a11y_serious_issues: number               # Should be 0
  lighthouse_performance: number            # e.g. 90 (customize.toml threshold)
  lighthouse_accessibility: number          # e.g. 90
  lighthouse_best_practices: number         # e.g. 90
  bundle_size_kb: number                    # e.g. 500 (customize.toml threshold)
  axe_audit_pass: boolean                   # axe-core accessibility audit
```

**Command pattern:**
```
> run ui acceptance
> verify ui acceptance gate
> ui acceptance status
```

### 4. E2E Browser Acceptance (`e2e_browser_acceptance`)

Triggered at sub-phase 4.13 (Integration). Validates cross-browser, responsive, and network behavior:

```yaml
e2e_browser_acceptance:
  browser_tests_pass: boolean                     # Browser automation tests pass
  visual_regression_pct_diff: number              # e.g. 0.5 (max allowable)
  cross_browser:
    chrome: enum[pass, fail]
    firefox: enum[pass, fail]
    safari: enum[pass, fail]
  responsive:
    mobile: enum[pass, fail]
    tablet: enum[pass, fail]
    desktop: enum[pass, fail]
  network:
    slow_3g: enum[pass, fail]
    offline: enum[pass, fail]
```

**Command pattern:**
```
> run e2e browser acceptance
> verify e2e browser acceptance gate
> e2e browser acceptance status
```

---

## Change Request Management

### Change Request Schema

CRs follow the schema defined in `{skill-root}/schemas/change-request-schema.yaml`:

```yaml
change_request:
  id: "CR-{n}"
  severity: {blocking | non_blocking}
  title: "Brief description"
  description: "Detailed explanation of the issue"
  proposed_fix: "What needs to change in the source artifact"
  source_phase: {phase_number}
  target_phase: {phase_number}
  target_artifact: {file_path}
  status: {open | in_progress | resolved}
  created_at: {timestamp}
  created_by: {user_id}
  resolved_at: {timestamp or null}
  resolution_details: {string or null}
```

### Creating a CR

When a downstream phase discovers an issue in an upstream artifact:
1. Create a CR entry in sprint-status.yaml under `change_requests`
2. Assign a unique ID (CR-001, CR-002, ...)
3. Set severity: `blocking` or `non_blocking`
4. Determine source_phase (where the fix must happen) and target_phase (where it was discovered)
5. Populate all required fields

CR creation triggers:
- Automatic during Phase 3.7 when story design exposes requirements gaps
- Manual at any time via "file a change request" command
- During Phase 4 implementation when API spec or architecture decisions need revision

### Blocking CR Flow

```
1. Create CR with severity: blocking
2. Set current phase status to BLOCKED
3. Unlock source phase (LOCKED → UNLOCK_RESOLVE)
4. Fix the source artifact
5. Re-review source artifact (IN_REVIEW → APPROVED → LOCKED)
6. Resume current phase (BLOCKED → IN_PROGRESS)
```

During a blocking CR, no new work can begin in the target phase. Only the CR fix workflow is active.

### Non-Blocking CR Flow

```
1. Create CR with severity: non_blocking
2. Record in sprint-status.yaml
3. Continue current phase
4. Resolve during Phase 4 (per non_blocking_deferred_to config in customize.toml)
```

Non-blocking CRs are tracked but do not stop forward progress. They accumulate and are resolved in batch during the deferred phase.

### CR Resolution

To resolve a CR:
1. Apply the fix to the source artifact
2. Update CR status to `in_progress` then `resolved`
3. Record `resolved_at` timestamp and `resolution_details`
4. If blocking, unblock the target phase
5. Update sprint-status.yaml to reflect the resolution

---

## Commands

### Init Command (V3.6 — Status Directory Bootstrap)

> "web-dev-flow init" or "start a new web project" or "initialize workflow"

Bootstraps the complete `status/` directory structure from a project description, eliminating manual setup.

**Flow:**
1. Orchestrator asks: "Describe your project in one sentence."
2. Orchestrator dispatches a **bootstrap sub-agent** with the description
3. Bootstrap sub-agent generates the full `status/` directory skeleton:
   - `status/global.yaml` — global_state with defaults from customize.toml
   - `status/phase-01.yaml` through `status/phase-03.yaml` — phase files (NOT_STARTED)
   - `status/phase-04-be.yaml` + `status/phase-04-fe.yaml` — track files (NOT_STARTED)
   - `status/change-requests.yaml` — empty CR list
   - `status/merge-queue/` — empty queue directory
   - `status/stories/` — empty stories directory
4. Orchestrator writes the generated files to disk
5. Orchestrator runs `web-dev-flow rebuild-status` to generate `sprint-status.yaml`
6. Workflow ready — proceed to Phase 1 or skip to Phase 2

### Auto-Mode Gate Degradation (V3.4)

In auto-run mode (`task_triage_mode = serial/parallel`), all `user_confirmation` gate checks are automatically replaced by their `auto_mode` alternatives defined in `references/gate-cards/phase-0N-gate.md`.

**Degradation rules:**
| Gate | Manual Mode | Auto Mode |
|------|------------|-----------|
| G1-01 | User confirms "Ready for analysis?" | task_triage_mode == serial/parallel |
| G2-02 | User confirms "Ready for planning?" | PRD output path exists |
| G3-05 | User confirms "Ready for solutioning?" | PRD status == approved/locked |
| G4-08 | User confirms "Ready for implementation?" | Phase 3 status == LOCKED |
| Skip prompts | "Run or skip sub-phase X?" | customize.toml auto_skip preset |

### Phase 1-3 Output Auto-Validation (V3.4)

After each Phase 1-3 sub-agent returns, the orchestrator validates output quality before updating state.

**Structural checks (all artifact types):**
1. `artifact_exists` — File at expected path
2. `artifact_not_empty` — Size > 0 bytes
3. `frontmatter_valid` — Has artifact_type, phase, status, version

**Semantic checks (varies by artifact type):**
4. `content_minimum` — Type-specific thresholds:
   - PRD/Architecture/Epics: >= 2000 characters
   - Story files: >= 500 characters
   - Briefs/Research: >= 500 characters
   - Acceptance/Readiness: >= 300 characters
5. `section_structure` — Required sections present:
   - PRD: problem_statement, functional_requirements, personas
   - Architecture: system_context, containers, components, decisions
   - Story: user_story, acceptance_criteria, technical_notes
   - API Spec: endpoints, schemas, auth
6. `keyword_presence` — Domain-relevant terms detected (prevents complete hallucination):
   - PRD: "user", "feature", "requirement"
   - Architecture: "component", "service", "database", "api"  
   - Story: "Given", "When", "Then" (or equivalent AC format)
7. `no_placeholder` — Does NOT contain "todo", "tbd", "待定", "TKTK"

**If validation fails (max 2 retries):**
- Log failure + reason to sprint-status.yaml
- Mark sub-phase BLOCKED
- Dispatch sub-agent with more specific instructions including the failure reason
- After 2 retries → escalate to blocking CR

### Pause Command (V3.6 — Graceful Pause with State Preservation)

> `/web-dev-flow pause` or "pause workflow" or "stop and save"

Suspends the workflow gracefully. Currently running agents complete their current sub-step, save state, and exit. No new agents are dispatched. All state is preserved for resume.

**Pause Protocol (V3.6 — Signal-based via /tmp):**
Agents work in isolated worktrees that cannot see each other's files. Communication happens through a shared directory OUTSIDE any git repository. See `specs/agent-communication.md` for the full protocol.

```
Phase A: Set global pause signal
  1. Write /tmp/web-dev-flow/signals/global.json:
     {"action": "pause_all", "issued_at": "{ISO}"}

Phase B: Signal each running agent
  2. FOR each running agent (tracked by agentId):
     Write /tmp/web-dev-flow/signals/main-to-{agentId}.json:
     {"type": "pause", "issued_at": "{ISO}"}

Phase C: Agents self-pause at next sub-step boundary
  3. Each agent reads main-to-{agentId}.json at start of next sub-step
  4. If type == "pause": completes current sub-step, checkpoint commit,
     writes {agentId}-to-main.json, returns PAUSED
  5. Agents at sub-step 4g/4h (too close to done): run through to CODE_ACCEPTED

Phase D: Confirm all drained
  6. Wait for all agents to return (PAUSED or CODE_ACCEPTED)
  7. Write overall_status: "paused" to {status_global_file}
  8. Display pause confirmation dashboard with per-agent status

╔═══════════════════════════════════════════╗
║  ⏸  WORKFLOW PAUSED                       ║
╠═══════════════════════════════════════════╣
║  Paused at: {ISO_TIMESTAMP}                ║
║  Phase: {current_phase}.{current_subphase} ║
║                                           ║
║  Stories completed: {merged_count}/{total} ║
║  Stories paused:    {paused_count}         ║
║    S-3.2: PAUSED at substep 4d (Tests)    ║
║    S-1.1: PAUSED at substep 4c (Implement) ║
║  Stories pending:   {pending_count}        ║
║                                           ║
║  Resume: /web-dev-flow resume              ║
╚═══════════════════════════════════════════╝
```

**Agent pause behavior by sub-step:**
- Agent is at sub-step 4c (Implement) → finishes 4c, checkpoint commit, returns PAUSED at 4c
- Agent is at sub-step 4d (Tests) → finishes 4d, checkpoint commit, returns PAUSED at 4d
- Agent is at CODE ACCEPTANCE (4h) → finishes CA checks, returns CODE_ACCEPTED (not paused — too close to done)
- Agent hasn't started yet → remains NOT_STARTED

### Resume Command (V3.6)

> `/web-dev-flow resume` or "resume workflow" or "continue from pause"

Restores the workflow from the pause point. All state was preserved by the pause protocol — no work is lost.

**Resume Protocol:**
1. Read {status_global_file} → verify overall_status == "paused"
2. Read {status_phase_04_be_file} and {status_phase_04_fe_file} for story statuses
3. For each PAUSED story:
   - Read last_completed_substep (e.g., "4d")
   - Recreate worktree: `git worktree add -b story/{story_id}-{track} ... main`
   - Resume agent from next sub-step (e.g., "4e" if paused at "4d")
   - The checkpoint commit at the pause point has all code changes preserved
4. For each NOT_STARTED story: normal dispatch (dependencies may now be satisfied)
5. For each CODE_ACCEPTED/MERGED story: skip (already complete)
6. Set pause_requested: false in {status_global_file}
7. Set overall_status: "implementation" (or current phase)
8. Display resume dashboard and continue auto-run

**Recovery from unexpected termination:**
If the orchestrator itself crashes (not a graceful pause), on next startup:
1. Read {status_global_file} → if overall_status is "implementation" but no orchestrator is running
2. Read all per-story status files → find IN_PROGRESS stories
3. Read each story's last_completed_substep
4. Rebuild worktrees from the story branches (checkpoint commits have the code)
5. Resume from last_completed_substep + 1
6. This is identical to the graceful resume flow — crash recovery IS pause recovery

### Progress Report Command (V3.3)

> "web-dev-flow report" or "project progress" or "how is the project going"

Generates a human-readable progress report from status/ files:

```
═══════════════════════════════════════════
Project: {project} | v{version} | {date}
═══════════════════════════════════════════

📊 Overall Progress: {percent}% complete
   Phase 1: {status}  Phase 2: {status}  Phase 3: {status}  Phase 4: {status}

📝 Stories: {code_accepted}/{total} CODE_ACCEPTED
   ✅ Merged: {merged_count}
   🔄 In Progress: {in_progress_count}
   🔒 Blocked: {blocked_count}
   ⏳ Queued: {not_started_count}

⚠️ Blockers: {blocker_count}
   {blocker_details if any}

🔀 Merge Queue: {queued} queued | {merged} merged | {waiting} waiting

📈 Throughput: {stories_per_day} stories/day
   Estimated completion: {estimated_date}

🏷️ Last Activity: {last_state_change}
```

Users can check project progress at any time:

> "web-dev-flow status" or "check project progress" or "what phase are we on"

This reads sprint-status.yaml and displays the status dashboard with phase progress bars, sub-phase details, and CR summaries.

### Phase Status Command

> "phase 4 status" or "check backend progress"

Displays detailed status for a specific phase including all sub-phases and story progress.

### Rebuild Status Command (V3.6)

> "web-dev-flow rebuild-status" or "rebuild sprint status"

Rebuilds `sprint-status.yaml` from `status/` directory files. Use when:
- sprint-status.yaml is corrupted or missing
- Manual verification that derived index matches source files
- After recovering from a crash

The rebuild is lossless — all state lives in `status/*.yaml` files. sprint-status.yaml is just a convenience view.

```bash
# Rebuild from status/ files
rebuild_sprint_status() {
  cat > sprint-status.yaml <<'EOF'
# AUTO-GENERATED — DO NOT EDIT
# Rebuilt from status/ files at {timestamp}
EOF
  cat status/global.yaml >> sprint-status.yaml
  for f in status/phase-*.yaml; do cat "$f" >> sprint-status.yaml; done
  echo "stories:" >> sprint-status.yaml
  for f in status/stories/*-status.yaml; do
    story_id=$(basename "$f" -status.yaml)
    status=$(grep "status:" "$f" | head -1 | awk '{print $2}')
    echo "  ${story_id}: { status: \"${status}\" }" >> sprint-status.yaml
  done
}
```

### Acceptance Commands

> "run code acceptance" or "verify code acceptance gate" — Triggers the CODE_ACCEPTANCE checks on backend code

> "run ui acceptance" or "verify ui acceptance gate" — Triggers the UI_ACCEPTANCE checks on frontend UI

> "run feature acceptance" or "verify feature acceptance gate" — Triggers the FEATURE_ACCEPTANCE checks during integration

> "run e2e browser acceptance" or "verify e2e browser acceptance" — Triggers the E2E_BROWSER_ACCEPTANCE checks

### Freeze Commands

> "freeze requirements" — Sets `global_state.requirements_frozen_at` in sprint-status.yaml. Freeze location is Phase 2.5. Once frozen, no new features without a CR.

> "freeze development order" — Sets `global_state.development_order_frozen_at`. Freeze location is Phase 3.7. Locks the story implementation sequence that developers must follow.

### Gate Check Command

> "check gate for phase 3" — Evaluates and displays the gate card for the specified phase without entering it.

### Phase Override Command

> "override phase 2 gate" — Admin-only. Requires explicit user confirmation. Manually sets gate to all_pass and allows entry.

### CR Command

> "file a change request" — Initiates the CR creation workflow. Prompts for source/target phase, severity, title, description, and proposed fix.

### Merge Queue Commands (V3.1)

> "view merge queue" or "show merge queue" — Displays the current merge queue with dependency ordering and status

> "merge queue status" — Shows summary counts of queued/merged/waiting/failed items

> "retry merge {story_id}" — Re-attempts a failed merge for a specific story

> "promote merge {story_id}" — Admin force-promotes a waiting_dependency item to queued

---

## Paths

All output paths are resolved from customize.toml:

| Config Key | Description | Default Path Pattern |
|------------|-------------|---------------------|
| `prd_output` | PRD document | `{project-root}/_bmad-output/web-dev-flow/prd.md` |
| `architecture_output` | Architecture decisions | `{project-root}/_bmad-output/web-dev-flow/architecture.md` |
| `epics_output` | Epics and stories outline | `{project-root}/_bmad-output/web-dev-flow/epics.md` |
| `stories_output` | Individual story files | `{project-root}/_bmad-output/web-dev-flow/stories/` |
| `api_spec_output` | OpenAPI 3.0 spec | `{project-root}/_bmad-output/web-dev-flow/api-spec.yaml` |
| `db_schema_output` | Database schema docs | `{project-root}/_bmad-output/web-dev-flow/db-schema.md` |
| `sprint_tracking` | Sprint/phase status (System of Record) | `{project-root}/_bmad-output/web-dev-flow/sprint-status.yaml` |
| `integration_output` | Integration report | `{project-root}/_bmad-output/web-dev-flow/integration-report.md` |
| `research_output` | Domain research output | `{project-root}/_bmad-output/web-dev-flow/research/` |
| `impact_map_output` | Impact Map (Phase 1.1/2.3) | `{project-root}/_bmad-output/web-dev-flow/_output/analysis/impact-map.md` |
| `event_storming_output` | Event Storming board (Phase 1.2/2.4) | `{project-root}/_bmad-output/web-dev-flow/_output/analysis/event-storm.md` |
| `jtbd_cards_output` | JTBD cards (Phase 1.3/2.5) | `{project-root}/_bmad-output/web-dev-flow/_output/analysis/jtbd-cards.md` |
| `story_map_output` | Story Map (Phase 2.6) | `{project-root}/_bmad-output/web-dev-flow/_output/planning/story-map.md` |
| `prioritization_output` | Prioritization report (Phase 2.7) | `{project-root}/_bmad-output/web-dev-flow/_output/planning/prioritization.md` |
| `user_flows_output` | User Flows (Phase 2.8) | `{project-root}/_bmad-output/web-dev-flow/_output/planning/user-flows.md` |
| `wireframes_output` | Wireframes (Phase 2.9) | `{project-root}/_bmad-output/web-dev-flow/_output/planning/wireframes.md` |
| `design_tokens_output` | Design Tokens (Phase 2.9) | `{project-root}/_bmad-output/web-dev-flow/_output/planning/design-tokens.md` |
| `design_acceptance_output` | Design Acceptance (Phase 2.10) | `{project-root}/_bmad-output/web-dev-flow/_output/planning/design-acceptance.md` |
| `acceptance_report_output` | Acceptance reports | `{project-root}/_bmad-output/web-dev-flow/_output/acceptance/` |

Backend sub-phase outputs:
| Config Key | Output File |
|------------|-------------|
| `be_scaffold_report_output` | be-scaffold-report.md |
| `be_migration_report_output` | be-migration-report.md |
| `be_api_client_report_output` | be-api-client-report.md |
| `be_dev_log_output` | be-dev-log.md |
| `be_test_report_output` | be-test-report.md |
| `be_code_acceptance_output` | be-code-acceptance-report.md |

Frontend sub-phase outputs:
| Config Key | Output File |
|------------|-------------|
| `fe_scaffold_report_output` | fe-scaffold-report.md |
| `fe_design_system_report_output` | fe-design-system-report.md |
| `fe_api_client_report_output` | fe-api-client-report.md |
| `fe_component_specs_output` | fe-component-specs.md |
| `fe_dev_log_output` | fe-dev-log.md |
| `fe_ui_acceptance_output` | fe-ui-acceptance-report.md |

Acceptance report outputs:
| Config Key | Output File |
|------------|-------------|
| `feature_acceptance_report_output` | feature-acceptance-report.md |
| `e2e_browser_report_output` | e2e-browser-report.md |

---

## Schemas

All schemas are defined in `{skill-root}/schemas/`:

| Schema File | Purpose |
|------------|---------|
| `artifact-frontmatter-schema.yaml` | Mandatory YAML frontmatter for every artifact |
| `gate-card-schema.yaml` | Structured Gate Card definition |
| `change-request-schema.yaml` | Change Request structure and resolution rules |
| `sprint-status-schema.yaml` | sprint-status.yaml structure (System of Record) |

### Artifact Frontmatter Schema

Every output artifact MUST include this frontmatter:

```yaml
---
artifact_type: {prd | architecture | epics | story | api_spec | db_schema | scaffold_report | migration_report | dev_log | test_report | completion_review | design_system_report | api_client_report | audit_report | integration_report | research | impact_map | domain_research | product_brief | event_storming | jtbd_cards | story_map | prioritization | user_flows | sitemap | wireframes | design_tokens | component_specs | interaction_spec | design_acceptance | system_context | architecture_style | container_design | quality_attributes | component_design | epics | sprint_plan | readiness_check | acceptance_report | feature_acceptance_report | ui_acceptance_report | e2e_browser_report | retrospective}
phase: {1-4}
sub_phase: {string or null}
status: {draft | reviewed | approved | locked | code_accepted | feature_accepted | ui_accepted | e2e_browser_accepted}
checksum: {sha-256 hash of content after frontmatter}
created_at: {ISO 8601 timestamp}
updated_at: {ISO 8601 timestamp}
version: {semantic version string}
bmad_state: {RESEARCHING | ANALYZING | DOCUMENTED | VERIFIED | DRAFTING | ELABORATING | REVIEWING | FINAL | DESIGNING | VALIDATING}
bmad_review_passed: {true | false | null}
parent_phase:
  prd: null
  requirements_frozen: {true | false}  # derived from requirements_frozen_at != null
  development_order_ref: {reference or null}
---
```

### sprint-status.yaml Structure

The sprint-status.yaml is the System of Record. It is always read from and written to as the authoritative source of workflow state. Structure follows `{skill-root}/schemas/sprint-status-schema.yaml`.

---

## Quality Gates

Quality gates are configured in `customize.toml` under `[acceptance_gates]`. Reference these thresholds during relevant sub-phases. The V3 model moves quality gates under acceptance gate categories:

### Code Acceptance Gates (Phase 4.6)
| Gate | Default | Description |
|------|---------|-------------|
| `code_acceptance_min_coverage` | 80 | Minimum test coverage percentage |
| `code_acceptance_require_lint` | true | Linter must pass with zero errors |
| `code_acceptance_require_type_check` | true | Type checker must pass with zero errors |

### UI Acceptance Gates (Phase 4.12)
| Gate | Default | Description |
|------|---------|-------------|
| `ui_acceptance_min_lighthouse_performance` | 90 | Minimum Lighthouse performance score |
| `ui_acceptance_min_lighthouse_accessibility` | 90 | Minimum Lighthouse accessibility score |
| `ui_acceptance_min_lighthouse_best_practices` | 90 | Minimum Lighthouse best practices score |
| `ui_acceptance_max_bundle_size_kb` | 500 | Maximum JavaScript bundle size |
| `ui_acceptance_require_axe_audit` | true | axe-core accessibility audit required |

### Feature Acceptance Gates (Phase 4.13)
| Gate | Default | Description |
|------|---------|-------------|
| `feature_acceptance_require_contract_compliance` | true | API contract must match spec exactly |
| `feature_acceptance_require_e2e_tests` | true | End-to-end tests for critical paths |
| `feature_acceptance_require_security_audit` | true | OWASP top 10 or dependency audit |

### E2E Browser Acceptance Gates (Phase 4.14)
| Gate | Default | Description |
|------|---------|-------------|
| `e2e_browser_acceptance_browsers` | ["chrome", "firefox", "safari"] | Browsers to test |
| `e2e_browser_acceptance_visual_diff_threshold_pct` | 0.5 | Maximum visual regression percentage |

---

## BMAD Skill Invocation Map

When a phase calls for BMAD skill usage, invoke these skills:

| Context | BMAD Skill to Invoke | Arguments |
|---------|---------------------|-----------|
| Product Brief creation | `/bmad-product-brief` | Pass user's project description |
| Domain research | `/bmad-domain-research` | Pass research topics from product brief |
| Brainstorming | `/bmad-brainstorming` | Pass project context |
| PRD creation | `/bmad-create-prd` | Pass user's project description |
| System architecture | `/bmad-create-architecture` | Pass PRD output, tech stack choices |
| Epics and stories | `/bmad-create-epics-and-stories` | Pass architecture, PRD |
| Individual story creation | `/bmad-create-story` | Pass epic context, story details |
| Story implementation | `/bmad-dev-story` | Pass story, API spec, architecture |
| Code review | `/bmad-code-review` | Pass changed files, story context |
| UX design flows | `/bmad-create-ux-design` | Pass PRD, story map |
| Sprint planning | `/bmad-sprint-planning` | Pass stories, dev order |
| Retrospective | `/bmad-retrospective` | Pass sprint-status, logs |

**Invocation Pattern:**
1. Check if the BMAD skill is available (attempt to load it)
2. If available: follow its instructions with the web-dev-flow project's context
3. If unavailable: dispatch web-dev-flow's native agent from `references/agents/{agent_file}.md`
   - Native agents are defined per role: analyst, product-manager, ux-designer, architect, story-planner, api-designer, backend-developer, frontend-developer, code-reviewer, qa-verifier, sprint-planner, retrospective-host, readiness-auditor
   - Each agent file contains complete methodology, input/output schema, and quality self-checks
   - The orchestrator reads the agent file and dispatches it as `Agent({ prompt: agent_content, isolation: "worktree" })`
4. Capture output into the appropriate artifact file
5. Run Phase 1-3 output auto-validation on the result
6. Update status/ files and advance FSM

**Agent Dispatch Modes:**
- `bmad_first` — 优先 BMAD skill，不可用/失败时回退到原生 agent（推荐）
- `native_only` — 始终使用原生 agent，忽略 BMAD skills
- `bmad_only` — 仅使用 BMAD skills，不可用时 halt

Configured in `customize.toml` → `[bmad_skill_fallbacks].fallback_mode`.

**Agent Mapping:**

| BMAD Skill | Native Agent File | Agent Role |
|-----------|------------------|------------|
| `/bmad-brainstorming` | `analyst.md` (mode: 1.1) | 产品分析师 |
| `/bmad-domain-research` | `analyst.md` (mode: 1.2) | 产品分析师 |
| `/bmad-create-prd` | `product-manager.md` | 产品经理 |
| `/bmad-create-ux-design` | `ux-designer.md` | UX 设计师 |
| `/bmad-create-architecture` | `architect.md` | 系统架构师 |
| `/bmad-create-epics-and-stories` | `story-planner.md` (mode: 3.6) | 技术 PM |
| `/bmad-create-story` | `story-planner.md` (mode: 3.7) | 技术 PM |
| `/bmad-dev-story` | `backend-developer.md` or `frontend-developer.md` | 开发者 |
| `/bmad-code-review` | `code-reviewer.md` | 代码审查员 |
| `/bmad-sprint-planning` | `sprint-planner.md` | Scrum Master |
| `/bmad-retrospective` | `retrospective-host.md` | 敏捷教练 |
| `/bmad-check-implementation-readiness` | `readiness-auditor.md` | 技术审计员 |
| `/bmad-*-verify` | `qa-verifier.md` (mode: feature/ui/e2e/etc.) | QA 工程师 |

**Agent Quality Guarantee:** Every native agent produces the same artifact schema and frontmatter that its corresponding BMAD skill would produce. Phase 1-3 output auto-validation applies equally to both BMAD and native agent outputs. Native agents are self-contained — they carry their own methodology, quality checks, and return format within the agent file.

---

## V3 File Structure

```
web-dev-flow/
├── CLAUDE.md                           # V3 architecture documentation
├── SKILL.md                            # THIS FILE — routing, FSM engine, commands
├── customize.toml                      # Configuration + acceptance gates + sub-phase config
│
├── assets/                             # Templates
│   ├── api-spec-template.yaml
│   ├── db-schema-template.md
│   └── architecture-decision-template.md
│
├── schemas/                            # Product Schema definitions
│   ├── artifact-frontmatter-schema.yaml
│   ├── gate-card-schema.yaml
│   ├── change-request-schema.yaml
│   └── sprint-status-schema.yaml
│
└── references/                         # Phase reference files
    ├── phase-01-analysis.md            # FSM + Gate Card + Sub-Phase Menu (SKIPPABLE)
    ├── phase-02-planning.md            # FSM + Gate Card + Sub-Phase Menu (10 sub-phases)
    ├── phase-03-solutioning.md         # FSM + Gate Card + Sub-Phase Menu (9 sub-phases)
    ├── phase-04-implementation.md      # FSM + Gate Card + Track-Aware Menu (14 sub-phases)
    │
    └── sub-workflows/                  # Sub-workflow files
        ├── analysis/                   # Phase 1 sub-workflows (skippable)
        │   ├── 1-1-brainstorming.md
        │   ├── 1-2-domain-research.md
        │   └── 1-3-product-brief.md
        │
        ├── planning/                   # Phase 2 sub-workflows (10 sub-phases)
        │   ├── 2-1-impact-mapping.md
        │   ├── 2-2-event-storming.md
        │   ├── 2-3-jobs-to-be-done.md
        │   ├── 2-4-story-mapping.md
        │   ├── 2-5-prioritization-spec.md
        │   ├── 2-6-user-flows.md
        │   ├── 2-7-wireframes.md
        │   ├── 2-8-design-system.md
        │   ├── 2-9-interaction-design.md
        │   └── 2-10-design-acceptance.md
        │
        ├── solutioning/                # Phase 3 sub-workflows (9 sub-phases)
        │   ├── 3-1-system-context.md
        │   ├── 3-2-architecture-style.md
        │   ├── 3-3-container-design.md
        │   ├── 3-4-quality-attributes.md
        │   ├── 3-5-component-synthesis.md
        │   ├── 3-6-epics.md
        │   ├── 3-7-stories.md
        │   ├── 3-8-api-design.md
        │   └── 3-9-readiness-check.md
        │
        ├── implementation/             # Phase 4 sub-workflows (14 sub-phases)
        │   ├── 4-1-sprint-planning.md
        │   ├── 4-2-be-scaffolding.md
        │   ├── 4-3-be-database.md
        │   ├── 4-4-be-api-endpoints.md
        │   ├── 4-5-be-testing-suite.md
        │   ├── 4-6-be-completion-review.md
        │   ├── 4-7-fe-scaffolding.md
        │   ├── 4-8-fe-design-system.md
        │   ├── 4-9-fe-api-client.md
        │   ├── 4-10-fe-page-implementation.md
        │   ├── 4-11-fe-a11y-perf-audit.md
        │   ├── 4-12-fe-completion-review.md
        │   ├── 4-13-integration.md
        │   └── 4-14-retrospective.md
        │
        └── fullstack/                  # Full-stack mode sub-workflows
            ├── fs-1-scaffolding.md
            ├── fs-2-foundation.md
            ├── fs-3-stories.md
            ├── fs-4-qa.md
            └── fs-5-review.md
```

---

## Parallel Execution Model (Phase 4)

Phase 4 uses the **One Story = One Agent = One Worktree = One Clean Context** principle. This is the core execution model for all parallel development:

1. **Per-Story Agent Isolation**: Each story in Phase 4 is a SEPARATE sub-agent invocation with CLEAN context (~38KB: story file + api-spec + architecture + design tokens/db-schema + code standards). The orchestrator's Auto-Continue loop selects the next story, dispatches a sub-agent, gets the result, and loops. The main orchestrator does NOT write code — it only manages state, gates, and merge. It does NOT keep sub-agent context — story implementation details never enter the main orchestrator's context window.
2. **Per-Story Worktree**: Each sub-agent works in a dedicated git worktree (`story/{story_id}-{track}` branch). No file is ever written by two agents simultaneously. See `specs/agent-isolation.md` for full specification.
3. **Shared System of Record (Split-File Design)**: All agents read sprint-status.yaml as the synchronization point — but ONLY the main orchestrator writes to it. Sprint-status.yaml is DERIVED (rebuilt from `status/` directory files on demand). Each phase, track, and story has its own status file. Per-story status files are written by story agents in their isolated worktrees. The merge-queue uses one file per item with a short-lived lock only during creation (~100ms). **No two processes ever write to the same file simultaneously.**
4. **API Spec as Contract**: All agents share the api-spec.yaml as the contract — neither can modify it.
5. **Context Firewall**: Sub-agent context is ephemeral. The sub-agent's implementation details, code, and conversation are NOT propagated to the main orchestrator. The orchestrator only reads the per-story status file (`_bmad-output/web-dev-flow/stories/{story_id}-status.yaml`) to determine the result.
6. **Integration gate (4.13)**: Both tracks must reach their acceptance gates (CODE_ACCEPTED + UI_ACCEPTED) before Integration can begin.

When executing parallel mode:
- Each story's agent is dispatched via the Claude Code `Agent` tool with `isolation: "worktree"`
- Each sub-agent receives a CLEAN prompt — only the story file + spec documents + implementation steps
- Max concurrent agents is configurable (default: 5, set in customize.toml)
- Agents that finish return `{ story_id, status: "CODE_ACCEPTED" }` to the main orchestrator
- The main orchestrator sequentially merges completed stories (merge is always sequential in main worktree)

---

## Error Handling & Recovery

### Missing Artifacts
If an artifact expected by a Gate Card is missing:
1. Display which artifact is missing and which phase produces it
2. Offer to jump back to the producing phase
3. Mark the gate check as `fail` with reason

### Corrupted sprint-status.yaml
If the sprint-status.yaml is invalid or corrupt:
1. Delete it — no data loss, it's derived
2. Run `web-dev-flow rebuild-status` to regenerate from `status/` files
3. If status/ files are also corrupt: attempt recovery from artifact frontmatter metadata
4. Last resort: reset to Phase 1 (with user confirmation)

### Stale State
If sprint-status.yaml shows a state but the corresponding artifact is missing or outdated:
1. Flag the inconsistency
2. Offer to reconcile (update state to match artifact, or regenerate artifact)
3. Log the reconciliation in sprint-status.yaml history

### CR Conflict
If two tracks simultaneously file CRs on the same artifact:
1. CRs are serialized by timestamp
2. First CR takes priority; second must wait for the first to resolve
3. sprint-status.yaml tracks CR dependencies

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.6.0 | 2026-05-20 | Split-File Status Design: sprint-status.yaml is DERIVED from `status/` directory files. Each file has exactly one writer — zero write conflicts. Write Permission Matrix guarantees no two processes ever write to the same file simultaneously. File-based Merge Queue with per-item files and ~100ms lock only during creation. Consolidated scope-lock V2.0 (5 operations from 9). Consolidated step-audit V2.0 (embed in sprint-status, not separate file). Story slicing V2.0 (optional P0/P1 for L/XL stories). Complexity tiers (simple/standard/complex) control audit depth and slicing defaults. |
| 3.5.0 | 2026-05-20 | CA-01 Fallback: inline code review when `/bmad-code-review adversarial` is unavailable. Phase 1-3 output auto-validation with max 2 retries. Auto-mode gate degradation replaces user_confirmation checks with auto alternatives. |
| 3.4.0 | 2026-05-20 | Workflow Bootstrap (init command). Phase 1-3 output auto-validation (structural + semantic checks). |
| 3.3.0 | 2026-05-20 | Progress Report Command (`web-dev-flow report`). |
| 3.2.0 | 2026-05-20 | Auto-Run Mode (hands-free execution with auto-phase-progression, auto-story-dispatch, auto-merge-queue); Continuous Self-Validation (per-commit scope, per-merge cross-story, system-level at gates); Task Triage Auto-Detection criteria matrix with confidence scoring; Consolidated BE Setup (Phase 4.3 merges Database + API Client, fixes 14/15 sub-phase mismatch); Auto-Run Configuration section in customize.toml |
| 3.1.0 | Current | StoryRail absorption: Task triage (3 modes), Code Standards Gate, Story Contract Freeze Gate, Acceptance Checks executable validation, Protected Paths enforcement, Handoff minimum gate, Execution Units, Merge Queue with dependency ordering, Contract Gate (API), Page Parity Gate (Frontend) |
| 3.0.0 | Current | BMAD 4-phase restructuring (Analysis → Planning → Solutioning → Implementation); Dual-layer FSM with acceptance states; 4 acceptance command patterns (code_acceptance, feature_acceptance, ui_acceptance, e2e_browser_acceptance); 14 BMAD skills + 4 acceptance commands; 36 sub-phases total; Phase 1 now optional/skippable; Requirements freeze at 2.5; Dev order freeze at 3.7; sprint-status.yaml max_phase: 4 |
| 2.4.0 | Current | 9-Phase restructuring: New Phase 5 (UI/UX Design, 5 sub-phases), Phase 2 broken into 5 C4 architecture sub-phases (2.1-2.5), all downstream phases renumbered (+1). Added architecture/ and ui-ux/ sub-workflow directories. |
| 2.3.0 | Current | Phased Requirements Analysis: Phase 1 split into 5 methodology-driven sub-phases (1.1 Impact Mapping, 1.2 Event Storming, 1.3 JTBD, 1.4 Story Mapping, 1.5 Kano+RICE+PRD); Sub-phase routing with skip mechanism for 1.2/1.3; Kano Model classification + RICE scoring for backlog prioritization; Phase 1 substates in sprint-status.yaml; Traceable chain from business goal to prioritized PRD |
| 2.2.0 | Current | Story Pack attributes (`parallel_safe`, `scope_write`, `acceptance_check`) from StoryRail; Story Ready Gate; Handoff documents; Executable acceptance checks; SUBMITTED state; Two dev_modes (separated/full_stack) with mode-aware routing; Unified full-stack development phase for Next.js/Nuxt/Remix/SvelteKit; Per-story backend+frontend task lists in full-stack mode |
| 2.1.0 | Current | Auto-Continue Story Development (6.3/7.4) — agent auto-selects, auto-implements, auto-advances; Cross-track dependency blocking (BLOCKED_BY_DEPENDENCY); parallel_group for parallel dev indication; development_order uses object arrays with depends_on |
| 2.0.0 | Current | FSM engine, Gate Cards, sub-workflows, Change Requests, quality gates, sprint-status.yaml System of Record |
| 1.0.0 | Initial release | Basic phase workflow, file-based gates |
