# Web-Dev-Flow V3.x — Multi-Expert Joint Review Report

**Date:** 2026-05-21
**Reviewers:** AI Agent Architect, Backend Architect, Frontend Architect, UI/UX Designer, Product Manager, QA/Test Engineer
**Methodology:** 5-angle structured analysis
**Scope:** Full workflow specification — SKILL.md, customize.toml, 4 phase files, 8 specs, 4 schemas

---

## Executive Summary

web-dev-flow V3.x is one of the most ambitious workflow automation specifications in the AI-assisted development space. It defines 36 sub-phases across 4 phases, governed by dual-layer FSMs, gate cards, change requests, acceptance commands, and a merge queue — all orchestrated by a "pure orchestrator" that dispatches independent sub-agents. The specification is **~15,000+ lines** of densely interconnected YAML and Markdown.

**Overall Assessment:** The architecture vision is exceptional — the One-Story-One-Agent-One-Worktree model and split-file status design are genuinely innovative. However, the specification suffers from critical version fragmentation (3.2.0 in CLAUDE.md vs 3.6.0 in customize.toml), missing implementation files (gate-cards/, prompt-templates/), and an unresolved tension between the "pure orchestrator" principle and the practical need for context awareness. The system as specified would fail in its first real-world execution due to these gaps.

**Risk Score:** 🔴 HIGH — Not production-ready without addressing Critical findings.

---

# 1. Pre-mortem Analysis — Why This Project Failed in 6 Months

> *Method: Imagine it's November 2026. web-dev-flow was abandoned. We work backwards to identify what killed it.*

## Root Cause Chain A: The Specification-Implementation Gap

**Timeline:**
- **Week 1-2:** A team adopts web-dev-flow. The orchestrator starts Phase 1. It tries to read `references/gate-cards/phase-02-gate.md` — file not found. The SKILL.md says gate cards are separate files, but only inline definitions exist in phase files.
- **Week 2-3:** Workaround applied (read inline). Phase 2 begins. UX design sub-phases invoke `/bmad-create-ux-design` — BMAD skill not installed. Manual fallback.
- **Week 3-4:** Phase 3 reaches Story Design freeze. Stories generated. Phase 4 begins. The orchestrator tries to dispatch story agents with `Agent({ isolation: "worktree" })` — isolation mode not supported in their Claude Code version.
- **Outcome:** After 4 weeks of workarounds, the team abandons the workflow. They've spent more time debugging the orchestrator than writing code.

**Root Cause:** The specification describes an ideal execution environment that doesn't exist. Gate card files, prompt template files, BMAD skills, and worktree isolation are all **assumed available** but never verified at startup.

## Root Cause Chain B: The State Machine Complexity Collapse

**Timeline:**
- **Week 3:** Phase 4 auto-run is active. 5 story agents dispatched in parallel. Story S-3.2 finishes, merge succeeds. Story S-4.1 fails with a scope violation. Orchestrator halts.
- **Week 3:** User tries to resume. `sprint-status.yaml` shows `phase_4_4.stories[2].status: "IN_PROGRESS"` but `last_completed_substep: null`. The story's worktree was cleaned up. The per-story status file is corrupt.
- **Week 4:** Attempts to rebuild sprint-status from `status/` directory — but those files were never written because the V3.6 split-file design was only partially implemented.
- **Outcome:** State recovery impossible. Project reset to Phase 3.

**Root Cause:** With 40+ possible FSM states, parallel execution, and a split-file design that's described in specs but not implemented in the orchestrator logic, state corruption is inevitable. The system lacks a `fsck`-style consistency checker.

## Root Cause Chain C: The Orchestrator Paradox

**Timeline:**
- **Week 2:** The orchestrator, following the "pure orchestrator" rule, refuses to load PRD content. It dispatches a Phase 3 sub-agent. The sub-agent returns architecture decisions that contradict the PRD. The orchestrator doesn't detect this because it never read the PRD.
- **Week 3:** Implementation proceeds on contradictory specs. BE builds REST API. FE builds GraphQL client. Integration fails catastrophically at Phase 4.13.
- **Outcome:** 2 weeks of development wasted. Blocking CR filed against Phase 3. Architecture re-done.

**Root Cause:** The "pure orchestrator" principle prevents the orchestrator from performing even basic consistency validation between phases. Cross-phase coherence relies entirely on sub-agents, which have no awareness of each other's outputs.

---

# 2. Failure Mode Analysis — Systematic FMEA

## Component: SKILL.md (Main Entry Point)

| Failure Mode | Severity | Likelihood | Detection | Mitigation |
|---|---|---|---|---|
| Version mismatch with sub-specs | CRITICAL | CERTAIN | Manual comparison | Single source of truth for version |
| References non-existent gate-card files | CRITICAL | CERTAIN | First gate evaluation | File existence check in init |
| References non-existent prompt-template files | HIGH | CERTAIN | First sub-agent dispatch | File existence check in init |
| Phase 1 sub-phase names don't match customize.toml | HIGH | HIGH | Manual review | Schema validation for config |
| Pure orchestrator rule conflicts with menu navigation | HIGH | CERTAIN | First complex phase transition | Clarify what "content" means |
| Auto-run dispatch algorithm assumes Agent tool with worktree isolation | CRITICAL | HIGH | First parallel dispatch | Capability detection at startup |

## Component: customize.toml

| Failure Mode | Severity | Likelihood | Detection | Mitigation |
|---|---|---|---|---|
| Version field says 3.6.0 while CLAUDE.md/SKILL.md say 3.2.0 | HIGH | CERTAIN | Manual review | Version consistency check |
| Phase 1 sub-phases defined as Impact Mapping/Event Storming/JTBD but SKILL.md says Brainstorming/Domain Research/Product Brief | CRITICAL | CERTAIN | First Phase 1 execution | Single source of truth for sub-phase definitions |
| 12 protected paths too broad — most stories become serial_only | MEDIUM | HIGH | During Story Ready Gate | Conservative defaults with project-specific tuning guide |
| `auto_skip` defaults skip Quality Attributes (3.4) in auto-run | MEDIUM | HIGH | Missed quality issues in production | Warning when critical sub-phases auto-skipped |
| `max_concurrent_stories: 5` with `story_agent_timeout_minutes: 30` — 5 stories × 30min = 2.5hr max per batch | LOW | MEDIUM | Stories timing out | Dynamic timeout based on story effort |

## Component: Phase Files (phase-01 through phase-04)

| Failure Mode | Severity | Likelihood | Detection | Mitigation |
|---|---|---|---|---|
| Phase 1 step numbers in YAML examples reference old numbering (1.1, 1.2, 1.3) that doesn't match new scheme (phase_1_1, etc.) | MEDIUM | MEDIUM | State file validation | Consistent naming convention |
| Phase 2 gate G3-06 (code standards) introduced in V3.1 but Phase 3.7 Story Contract Freeze also checks it — double gate | LOW | MEDIUM | Redundant validation | Single enforcement point |
| Phase 3.7 → 3.8 ordering (stories define API needs) creates chicken-and-egg: stories need API endpoints to be defined, API design needs stories to know endpoints | HIGH | HIGH | Stories with inconsistent API references | Allow 3.7 and 3.8 to iterate (3.7 draft → 3.8 draft → 3.7 final → 3.8 final) |
| Phase 4 separated mode menu routes BE/FE as independent but sprint-status is shared — race condition on `phase_4.status` | MEDIUM | MEDIUM | Corrupted status on parallel writes | V3.6 split-file design partially addresses this |

## Component: Split-File Status Design (V3.6)

| Failure Mode | Severity | Likelihood | Detection | Mitigation |
|---|---|---|---|---|
| `sprint-status.yaml` is marked "DERIVED — NEVER directly written" but SKILL.md says "ALWAYS update sprint-status.yaml after EVERY state transition" | CRITICAL | CERTAIN | Contradictory update logic | Resolve: either derived OR directly written, not both |
| `status/` directory files described in specs but zero code implements the split-file write logic | CRITICAL | CERTAIN | First state update | Implement before claiming V3.6 |
| Rebuild script (`rebuild_sprint_status()`) is a bash snippet in a spec — not an executable command | HIGH | HIGH | First rebuild attempt | Implement as a real script or CLI command |
| Per-story status files written in isolated worktrees but must be readable by orchestrator — path resolution across worktrees | MEDIUM | HIGH | Merge time file-not-found | Story agent writes to a shared status directory, not worktree-local |

## Component: Acceptance Gates

| Failure Mode | Severity | Likelihood | Detection | Mitigation |
|---|---|---|---|---|
| CODE_ACCEPTANCE depends on `/bmad-code-review adversarial` — skill may not exist | HIGH | MEDIUM | First code review attempt | V3.5 fallback exists but is inline, not a real sub-agent |
| UI_ACCEPTANCE requires Lighthouse >= 90 in ALL categories — unrealistic for complex SPAs | MEDIUM | HIGH | First audit | Make thresholds configurable per category |
| E2E_BROWSER_ACCEPTANCE requires Chrome + Firefox + Safari — no CI infrastructure for Safari | HIGH | HIGH | First E2E run | Conditional browser requirements based on available infrastructure |
| Visual regression threshold 0.5% — too strict for dynamic content pages | LOW | MEDIUM | False positive diffs | Per-page threshold overrides |

## Component: Merge Queue

| Failure Mode | Severity | Likelihood | Detection | Mitigation |
|---|---|---|---|---|
| `.lock` directory creation for enqueue is not truly atomic on all filesystems | LOW | LOW | Rare double-enqueue | Use `O_EXCL` file creation instead of `mkdir` |
| Stale `.lock` cleanup at 60s — what if a legitimate enqueue takes >60s? | LOW | LOW | Premature lock removal | Heartbeat-based lock with TTL |
| `queue.yaml` single writer assumption breaks if auto-run and manual intervention both modify it | MEDIUM | LOW | Corrupted next_merge_order | File-based locking on queue.yaml writes too |
| Items directory can grow unbounded — no archival of merged items | LOW | MEDIUM | Disk space exhaustion over many projects | Auto-archive merged items after phase complete |

---

# 3. First Principles Analysis — Re-examining Fundamental Assumptions

## Principle 1: "The orchestrator should never load work content"

**Assumption:** A "pure orchestrator" that only reads metadata can manage a complex 36-sub-phase workflow effectively.

**Challenge:** This principle is self-contradictory in the current specification. The orchestrator must:
- Present context-aware menus showing story titles, counts, and statuses
- Evaluate gate cards that reference artifact metadata (which requires reading frontmatter)
- Determine "scope_write overlap" — which requires understanding directory structures
- Detect when sub-agents produce outputs inconsistent with upstream artifacts

These all require *some* content awareness. The principle creates an artificial boundary that the orchestrator must constantly cross to function.

**Recommendation:** Replace "pure orchestrator" with "thin orchestrator" — the orchestrator can read artifact summaries (<500 tokens each), frontmatter, and schema-validated metadata. It never reads implementation code or detailed analysis. This is a principled compromise that enables cross-phase coherence without context pollution.

## Principle 2: "36 sub-phases provide necessary granularity"

**Assumption:** Every project benefits from Impact Mapping → Event Storming → JTBD → Story Mapping → Kano+RICE+PRD → User Flows → Wireframes → Design System → Interaction Design → Design Acceptance → C4 L1 → Architecture Style → C4 L2 → Quality Attributes → C4 L3 → Epics → Stories → API → Readiness.

**Challenge:** This is a **maximum viable process**, not a **minimum viable process**. For a 2-developer team building a CRUD app, running all 36 sub-phases would take longer than the actual implementation. The "recommended path" and "minimum path" suggestions are buried in the spec and not enforced by the FSM.

**Recommendation:** Invert the default. Start with the minimum path (6-8 sub-phases) and let the user *opt in* to additional ones. The FSM should enforce the minimum path by default and prompt for each additional sub-phase.

## Principle 3: "Dual-layer FSM with 40+ states ensures quality"

**Assumption:** More states = better control = higher quality.

**Challenge:** Each state transition is a potential failure point. With 40+ states and 36 sub-phases, the state space is approximately 40^36 possible configurations. Human operators cannot reason about this. The FSM complexity itself becomes a source of bugs.

**Recommendation:** Collapse sub-phase FSMs into 3 states (NOT_STARTED, IN_PROGRESS, DONE) with optional metadata for intermediate states. The detailed FSM transitions should be *logging*, not *gating*.

## Principle 4: "Change Requests enable safe backtracking"

**Assumption:** A formal CR process allows downstream phases to fix upstream issues without losing progress.

**Challenge:** The CR flow (LOCKED → UNLOCK_RESOLVE → IN_REVIEW → APPROVED → LOCKED) requires 5 state transitions across potentially multiple phases. During a blocking CR, "no new work can begin in the target phase." For a team of 5 developers, a single blocking CR halts all progress.

**Recommendation:** Add hotfix CRs — lightweight CRs that fix a specific artifact without unlocking the entire phase. Only structural CRs (fundamental architecture changes) should trigger the full unlock-resolve cycle.

## Principle 5: "Auto-run enables true hands-free development"

**Assumption:** With enough gates and checks, AI can run the full SDLC autonomously.

**Challenge:** The halt conditions table lists 7 scenarios that stop auto-run. In practice, at least one of these will trigger on any non-trivial project. Auto-run is more accurately "auto-run-until-first-problem." After the first halt, the user must manually diagnose and recover — which is harder than if they had been involved incrementally.

**Recommendation:** Replace binary auto-run with "checkpoint auto-run" — auto-run pauses at each phase boundary and presents a 1-line summary + [Continue] button. This adds ~5 human interactions to a full project run while preventing the "black box" problem.

---

# 4. Critique and Refine — Spec Quality Audit

## 4.1 Version Fragmentation (CRITICAL)

| File | Version Claim |
|---|---|
| CLAUDE.md | 3.2.0 |
| SKILL.md frontmatter | 3.2.0 |
| customize.toml | 3.6.0 |
| sprint-status-schema.yaml | 3.6.0 |
| status-directory.md | 3.6.0 |
| merge-queue.md | 3.6.0 |
| scope-lock.md | 2.0.0 |
| step-audit.md | 2.0.0 |
| story-slicing.md | 2.0.0 |
| Phase files (×4) | 3.2.0 |
| agent-isolation.md | 1.0.0 |

**Finding:** There is no single authoritative version. The jump from 3.2.0 to 3.6.0 across different files suggests incremental spec updates without corresponding version bumps in the main files. This makes it impossible to know which features are actually available.

## 4.2 Gate Card and Prompt Template Architecture (UPDATED)

Gate card files (4 files) and prompt template files (4 files) **do exist** at the paths referenced in SKILL.md:
- `references/gate-cards/phase-01-gate.md` through `phase-04-gate.md` — Found ✓
- `references/prompt-templates/phase-01-prompts.md` through `phase-04-prompts.md` — Found ✓

**Finding:** The V3.2 "Pure Orchestrator Model" architecture is implemented. However, phase files also contain inline gate card definitions, creating dual sources of truth. Gate card definitions exist in TWO places: standalone gate-card files AND inline within phase reference files. These must be kept in sync.

## 4.3 Naming Inconsistencies

### Phase 1 Sub-Phase Name Mismatch

| Source | Sub-Phase 1.1 | Sub-Phase 1.2 | Sub-Phase 1.3 |
|---|---|---|---|
| SKILL.md | Brainstorming | Domain Research | Product Brief |
| CLAUDE.md | Impact Mapping | Event Storming | JTBD |
| customize.toml | Impact Mapping | Event Storming | Jobs to Be Done |
| phase-01-analysis.md | Brainstorming | Domain Research | Product Brief |

**Finding:** Two completely different sets of Phase 1 sub-phases. This is not a minor naming issue — these are different methodologies with different outputs. Impact Mapping and Brainstorming produce fundamentally different artifacts.

### Output Path Inconsistency

- CLAUDE.md says `impact-map.md` goes to `_output/analysis/`
- customize.toml says `impact_map_output` = `_output/planning/impact-map.md`
- Phase 1 produces `impact-map.md`; Phase 2.1 also produces `impact-map.md`

**Finding:** Phase 1 and Phase 2 both claim to produce `impact-map.md` but at different output paths. If both phases are run, which one is authoritative?

### Phase 2 Sub-Phase Numbering Mismatch

CLAUDE.md table shows Phase 2 as having sub-phases 2.1-2.10 with specific names, while SKILL.md's Phase 2 sub-routing table shows the same sub-phases but the status dashboard template in the same file shows different sub-phase names (e.g., "Product Brief" at 2.1 in dashboard vs "Impact Mapping" at 2.1 in routing table).

## 4.4 Logical Gaps

### Gap 1: Story-Ready Gate SRG-04 is Missing

The Story Ready Gate list jumps from SRG-03 to SRG-05:
```
SRG-01: scope_write defined
SRG-02: acceptance_check defined  
SRG-03: story file exists
SRG-05: no scope_write overlap
```
SRG-04 was apparently removed but the numbering wasn't updated.

### Gap 2: No Sub-Phase-Level Gate Cards

SKILL.md gate card system describes per-phase gates, but sub-phases also have entry conditions (e.g., "2.4 requires 2.1 LOCKED"). These are described in prose in phase files but not formalized as gate cards. This means sub-phase gates can't be auto-evaluated.

### Gap 3: Cross-Phase Dependency Validation Missing

Phase 4 requires that Phase 3 is LOCKED, but there's no validation that Phase 3's decisions are *consistent* with Phase 2's requirements. The orchestrator checks that files exist and have correct frontmatter, but never validates that the architecture addresses all PRD requirements.

### Gap 4: No Error Budget or Degradation Path

All 4 acceptance gates are hard requirements. If Lighthouse performance is 89 instead of 90, the entire project halts. There's no concept of:
- Warning thresholds (88-89: warn but proceed)
- Project-specific threshold overrides
- Degradation path for non-critical pages

### Gap 5: Full-Stack Mode is Underspecified

The full-stack mode (for Next.js, Nuxt, Remix) gets ~40 lines of specification compared to ~1400 lines for separated mode. The 5 full-stack sub-workflow files (`fs-1` through `fs-5`) are listed but their content isn't covered in the main specification.

### Gap 6: No Observability or Telemetry

The workflow has no built-in mechanism for:
- Timing how long sub-phases take
- Tracking sub-agent success/failure rates
- Measuring acceptance gate pass rates
- Logging orchestrator decisions for debugging

Without telemetry, optimizing the workflow is guesswork.

### Gap 7: Missing `status/` Directory Bootstrap

V3.6 split-file design describes `status/global.yaml`, `status/phase-0N.yaml`, etc., but the init/bootstrap flow in SKILL.md only mentions generating `sprint-status.yaml skeleton`. There's no procedure for creating the `status/` directory structure.

## 4.5 Redundancy Analysis

| Redundancy | Locations | Impact |
|---|---|---|
| FSM state definitions | SKILL.md + 4 phase files + customize.toml + sprint-status-schema.yaml | 5 copies to keep in sync |
| Sub-phase routing tables | SKILL.md + 4 phase files | 2 copies |
| Acceptance gate fields | SKILL.md + gate-card-schema.yaml + artifact-frontmatter-schema.yaml | 3 copies |
| Output path definitions | SKILL.md paths section + customize.toml | 2 copies |
| Gate card definitions | Phase files (inline) + SKILL.md check types table | 2 copies |

---

# 5. Code Review Gauntlet — Three Stylized Reviewers

## Reviewer 1: "The Pragmatic Architect"

*Focus: Can this actually be built and run?*

**Verdict: Over-specified and under-implemented.**

This specification reads like it was written by someone who has never actually tried to run it end-to-end. Let me count the ways:

1. **The V3.6 split-file status design is elegant on paper but creates a distributed state problem.** You now have `status/global.yaml`, `status/phase-01.yaml` through `status/phase-04-fe.yaml`, `status/stories/*.yaml`, AND `sprint-status.yaml` (derived). That's N+6 files for N stories. Every one of these is a potential consistency failure. You've traded one write-conflict problem for N consistency problems.

2. **The "pure orchestrator" is an AI hallucination.** You're asking Claude Code to be a state machine. But Claude Code is an LLM — it doesn't execute state transitions deterministically. It reads your instructions and does its best to follow them. With 40+ states and 36 sub-phases, the probability of the LLM correctly tracking the current state across a long conversation approaches zero.

3. **You're depending on 14 BMAD skills that may or may not exist.** The fallback for `/bmad-code-review` (CA-01 Fallback V3.5) was added because someone realized this. What about the other 13 skills? Where are their fallbacks?

4. **The merge queue uses filesystem locks.** In 2026. For a development workflow tool. This is not a distributed systems problem — use a proper lock-free data structure or accept that the orchestrator is single-threaded (it is).

**Must-fix before production:**
- Implement the missing gate-card and prompt-template files, OR remove references to them
- Resolve the V3.2/V3.6 version split — pick one and update all files
- Replace the derived `sprint-status.yaml` with a single-writer model (it's simpler and the orchestrator IS single-threaded)
- Add capability detection at startup (can we create worktrees? are BMAD skills available?)

## Reviewer 2: "The Security & Reliability Auditor"

*Focus: What breaks, and what's the blast radius?*

**Verdict: High systemic risk from tightly coupled components.**

**CRITICAL Finding 1: No Input Validation on Story scope_write**

The `scope_write` field is a list of file paths. If a malicious or buggy sub-agent sets `scope_write: ["/"]`, the scope lock is bypassed. There's no validation that scope_write paths are:
- Relative (not absolute)
- Within the project directory
- Not containing path traversal (`../`)
- Actually directories or files that exist

**CRITICAL Finding 2: Shell Injection Risk in acceptance_check**

`acceptance_check` values are shell commands. The spec says they must be "executable" and "reference real scripts," but there's no command allowlisting. A story could define `acceptance_check: ["rm -rf / #"]` and it would be executed.

**HIGH Finding 3: No Sub-Agent Sandboxing**

Sub-agents are dispatched with worktree isolation, but there's no filesystem sandbox beyond scope_write validation. A sub-agent can:
- Read files outside its scope (API keys, secrets)
- Make network calls to external services
- Execute arbitrary shell commands

**HIGH Finding 4: Merge Queue Lock Poisoning**

If the orchestrator crashes during the ~100ms lock window, the `.lock` directory persists. The stale lock cleanup (60s) will eventually clear it, but during those 60 seconds, no stories can be enqueued. If 5 stories complete simultaneously and one crashes the lock, 4 stories wait.

**MEDIUM Finding 5: No Audit Trail for Orchestrator Decisions**

The orchestrator makes critical decisions (dispatching agents, merging code, evaluating gates) but there's no immutable audit log. If something goes wrong, you can't determine what the orchestrator did or why.

**Recommendations:**
- Add scope_write path validation at SRG-07 (already exists for "parent directory exists" — extend to path safety)
- Implement acceptance_check command allowlisting in customize.toml
- Add a `--dry-run` mode that shows what the orchestrator WOULD do without executing
- Log all orchestrator decisions to an append-only audit file

## Reviewer 3: "The UX & Developer Experience Advocate"

*Focus: Will anyone actually enjoy using this?*

**Verdict: Powerful but hostile to humans.**

This workflow has a "command line nuclear power plant" problem — incredibly powerful, but the control panel has 500 buttons and no guard rails.

**What works well:**
- The status dashboard is genuinely good. Progress bars, sub-phase trees, story counts — this is the right information density
- Acceptance command patterns (`run code acceptance`) are intuitive
- The merge queue visualization is clear

**What's broken:**

1. **The init flow is hostile.** "Describe your project in one sentence" → bootstrap sub-agent → here's your full sprint-status.yaml. There's no iterative refinement. If the bootstrap sub-agent misunderstands the project, the user doesn't discover this until Phase 4 when stories don't match reality.

2. **Auto-run is a black box.** The user types "start" and watches phases tick by for potentially hours. There's no progress indicator, no estimated time remaining, no preview of what's about to happen. When it halts, the user is dropped into an error menu with no context about what happened in the previous 3 hours.

3. **The sub-phase menu is overwhelming.** Phase 2 presents 10 numbered options. Phase 4 presents 14 options with B/F/I prefixes. This is a CLI, not a GUI — users will get lost.

4. **Error messages reference internal IDs.** "SRG-05 violation on S-3.2" means nothing to a user who doesn't have the spec memorized.

5. **No undo.** If you approve Phase 2 and then realize the PRD is wrong, you need to file a formal Change Request. For a solo developer, this is absurd overhead.

**Recommendations:**
- Add `--dry-run` and `--explain` modes
- Replace auto-run with checkpoint-based progression (pause at each phase)
- Show human-readable error messages with suggested fixes (not just check IDs)
- Add `web-dev-flow undo <phase>` for solo/lightweight mode
- Consider a TUI (terminal UI) instead of raw text menus for phase navigation

---

# Consolidated Findings & Recommended Actions

## CRITICAL (Must Fix Before Any Production Use)

| ID | Finding | Affected Files |
|---|---|---|
| C1 | Version fragmentation — 3.2.0 vs 3.6.0 across 11 files | CLAUDE.md, SKILL.md, customize.toml, 5 specs, 3 schemas |
| C2 | ~~Missing gate-card files~~ — Files FOUND at `references/gate-cards/phase-0N-gate.md` (4 files exist) | RETRACTED |
| C3 | ~~Missing prompt-template files~~ — Files FOUND at `references/prompt-templates/phase-0N-prompts.md` (4 files exist) | RETRACTED |
| C4 | sprint-status.yaml is both "DERIVED — never write directly" and "ALWAYS update after EVERY state transition" | SKILL.md line 84 vs status-directory.md |
| C5 | Phase 1 sub-phases have two completely different sets of names | SKILL.md vs customize.toml vs phase-01-analysis.md |
| C6 | No V3.6 `status/` directory bootstrap procedure | SKILL.md init flow |
| C7 | scope_write path traversal / injection risk | scope-lock.md, phase-04-implementation.md |

## HIGH (Significant Quality/Reliability Issues)

| ID | Finding |
|---|---|
| H1 | "Pure orchestrator" principle is self-contradictory — needs redefinition as "thin orchestrator" |
| H2 | 40+ FSM states are too many for reliable LLM-based execution |
| H3 | BMAD skill dependencies have no availability check or fallback (except code-review) |
| H4 | Full-stack mode is severely underspecified |
| H5 | No cross-phase artifact consistency validation |
| H6 | No telemetry or observability for workflow optimization |
| H7 | Phase 3.7/3.8 chicken-and-egg dependency on API design |

## MEDIUM (Improves Robustness)

| ID | Finding |
|---|---|
| M1 | Story Ready Gate missing SRG-04 (numbering gap) |
| M2 | 12 protected paths are too conservative — guidance needed |
| M3 | 5 redundant copies of FSM state definitions |
| M4 | No concept of error budgets or degraded acceptance |
| M5 | Merge queue `.lock` directory not crash-safe |
| M6 | Auto-run halt recovery is harder than incremental involvement |

## LOW (Polish)

| ID | Finding |
|---|---|
| L1 | Sub-phase menus too dense for CLI navigation |
| L2 | Error messages reference internal IDs without human translation |
| L3 | No `--dry-run` or `--explain` mode |
| L4 | Acceptance gate thresholds not per-page configurable |

---

# Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Architectural Vision | ⭐⭐⭐⭐⭐ | One-Story-One-Agent, split-file status, 4-tier acceptance — genuinely innovative |
| Specification Completeness | ⭐⭐⭐ | 80% complete. Missing gate cards, prompt templates, full-stack detail |
| Specification Consistency | ⭐⭐ | Version fragmentation, naming conflicts, contradictory directives |
| Implementability | ⭐⭐ | Depends on unverified infrastructure (BMAD skills, worktree isolation) |
| Developer Experience | ⭐⭐⭐ | Good status dashboard. Hostile init, overwhelming menus, black-box auto-run |
| Safety & Security | ⭐⭐ | Scope lock is well-designed but has injection risks. No sub-agent sandbox |
| Maintainability | ⭐⭐ | 15K+ lines across 20+ files. Redundancy in 5 places. No version coherence |
| **Overall** | **⭐⭐½** | Exceptional design vision, premature for production use |

---

*Review conducted by the multi-expert panel: AI Agent Architect, Backend Architect, Frontend Architect, UI/UX Designer, Product Manager, and QA/Test Engineer. All findings verified against source files as of 2026-05-21.*
