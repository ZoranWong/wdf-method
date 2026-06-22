---
name: wdf
version: "3.9.0"
description: Full-stack web project development workflow. 4-phase FSM-driven process. Claude session executes planning phases; TypeScript CLI manages state, gates, and Phase 4 automated implementation.
allowed-tools: Read Write Bash Grep Glob Edit Agent Task Skill
on_activation: "Enter the WDF automation loop. Run `/wdf start` to detect current state. If auto-execute batch exists, consume it programmatically. Repeat until all phases LOCKED."
metadata:
  tags: web-dev, workflow, full-stack, development, automation
  platforms: Claude
  keyword: wdf, wdf-init, wdf-start, wdf-status, wdf-check, wdf-gate
  source: user-installed skill
---

# WDF Method V3.8 — Web Development Workflow

## 架构

```
┌─────────────────────────────────────────┐
│  Claude 会话 (主控)                      │
│  ├─ 控制循环: /wdf start → 检查状态     │
│  ├─ 写产物: Write 工具                  │
│  ├─ 读标准: references/agents/          │
│  └─ 分派子任务: Agent tool             │
└──────────────┬──────────────────────────┘
               │ wdf CLI (查询/校验)
               ▼
┌─────────────────────────────────────────┐
│  wdf CLI (状态机 + 质检员)              │
│  ├─ status    → 报告当前状态，缺什么      │
│  ├─ check     → 检查产物是否符合标准      │
│  ├─ gate      → 门禁是否通过             │
│  ├─ accept    → 验收是否合格             │
│  ├─ report    → 输出问题清单             │
│  ├─ pause     → 暂停                    │
│  └─ resume    → 恢复                    │
└─────────────────────────────────────────┘
```

**CLI 不调度 Agent，不执行 AI 工作。** 它只回答：到哪了、缺什么、合不合格。

## On Activation — Automation Loop Protocol

This is the core loop protocol. Follow these steps **every time** `/wdf` is invoked:

### Step 1: Run CLI Command
Execute the matched command's `scripts.sh` (defined in `commands/<command>.md`). This runs the TypeScript CLI engine which reads state, evaluates gates, and outputs current status plus an optional auto-execute batch.

### Step 2: Read CLI Output
The CLI outputs two things:
- **Human-readable text** explaining current state and next steps
- **Structured batch file** at `_wdf_output/.dispatch/auto-execute.json` (Phases 1-3) or `_wdf_output/.dispatch/phase-4-dispatch.json` (Phase 4)

### Step 3: Check for Auto-Execute Batch (Phases 1-3)
If `_wdf_output/.dispatch/auto-execute.json` exists with `status: "ready"`:
1. Read the JSON batch file
2. For each entry where `prompt` does NOT start with "Cannot execute yet":
   - Read the `prompt` field — it contains agent methodology, quality checklist, anti-patterns
   - Write the artifact to `_wdf_output/{outputPath}` with YAML frontmatter
   - **VERIFY**: Run `wdf check --artifact={outputPath}` — ALL checks must pass
   - **Gate**: If verification fails (exit != 0), fix the artifact quality issue, re-verify. Do NOT proceed to the next entry until the current artifact passes all quality checks.
3. After all entries in the current batch are written AND verified:
   - Run `/wdf start` to re-sync FSM state
4. Repeat from Step 2

### Step 4: Check for Phase 4 Dispatch Manifest
If `_wdf_output/.dispatch/phase-4-dispatch.json` exists:
1. Read the JSON manifest — it has `tracks.backend.stories` and `tracks.frontend.stories`
2. Each story has a `prompt_file` path
3. For stories in dependency order (no `depends_on` first):
   - Read the story prompt file
   - Implement the story using Agent tool within declared `scope_write` paths
   - **VERIFY**: Run acceptance checks defined in the story — ALL must pass
   - **Gate**: If any acceptance check fails, fix the code, re-verify. Do NOT mark the story as complete until all checks pass.
   - Commit the code with message format: `{story_id}: {title} — IMPLEMENTED`
4. After all ready stories are implemented AND verified:
   - Run `/wdf start` to re-sync state

### Step 5: Verification Gate for All Artifacts
**Every artifact** — whether from Phase 1-3 or Phase 4 — must pass quality verification before the loop advances:

```
Write artifact → `wdf check --artifact=<path>` → ALL pass? → `/wdf start` → next task
                                                ↓ NO
                                        Fix artifact ← re-check
```

**Status/config files also validated.** When the LLM writes or updates:
- `_wdf_output/status/skip-decisions.yaml` — validated for YAML structure, `skip_decisions.skipped` array format, phase key naming
- `_wdf_output/status/global.yaml` — validated for required workflow fields
- Any YAML file under `_wdf_output/status/` — validated via `wdf check`

Use `wdf check --artifact=status/<filename>` to run these validations.

The `wdf check` command enforces:
- YAML frontmatter existence and completeness
- Content length minimums (500+ chars for analysis artifacts)
- No placeholder text (TBD, TODO, etc.)
- Artifact-specific rules (PRD needs REQ entries, API spec needs endpoints, etc.)

Do NOT skip the verification step. If `wdf check` exits non-zero, the artifact has quality issues that will cause downstream problems.

### Step 6: Loop Termination
The loop terminates when:
- CLI returns no pending sub-phases (all Phase 1-3 LOCKED)
- CLI returns "All stories implemented" (Phase 4 complete)
- A gate check fails with `halt_on_gate_failure: true`
- An auto-execute batch has `status: "complete"`

### Step 7: Error Handling
- Gate failure: read the failure details, fix the artifact, run `/wdf start` again
- CLI error: report the error message, do NOT retry blindly
- Missing auto-execute.json: fall back to the human-readable prompt text

## 完整开发流程

```
/wdf init "Build a todo app"
  │
  ▼
/wdf start
  → CLI 返回: "Phase 1.1 Brainstorming 缺失, 需要 impact-map.md"
  → Claude 读取 references/agents/analyst.md
  → Claude Write 产物
  │
  ▼
/wdf start
  → CLI 返回: "Phase 1.1 LOCKED, Phase 2.1 Impact Mapping 缺失"
  → Claude Write 产物
  │
  ▼
...循环直到 Phase 4...
  │
  ▼
/wdf start
  → CLI 返回: "Story S-AUTH-01 未实现, scope: src/modules/auth/"
  → Claude 写代码
  │
  ▼
/wdf start
  → CLI 返回: "S-AUTH-01 CODE_EXISTS, S-TODO-01 未实现"
  → ...
```

## 命令

| 命令 | 做什么 |
|------|--------|
| `/wdf init` | 创建项目骨架 |
| `/wdf start` | **查询当前状态** — 返回进度、缺失产物、下一步 |
| `/wdf check` | **检查产物质量** — 格式、内容、标准符合度 |
| `/wdf gate` | **检查门禁** — 能不能进下一阶段 |
| `/wdf accept <type>` | **验收** — code/ui/feature/e2e 是否通过 |
| `/wdf report` | **问题报告** — 列出所有不合规项 |
| `/wdf pause` / `resume` | 流程控制 |
| `/wdf status` | 完整仪表盘 |

## CLI 命令

```bash
wdf start                  # 返回当前进度 + 下一步
wdf status [--json]        # 完整仪表盘
wdf check [--artifact=]    # 检查产物质量
wdf gate [--phase=N]       # 门禁检查
wdf accept <type>          # 验收 (code/ui/feature/e2e)
wdf report                 # 问题报告
wdf pause / resume         # 暂停/恢复
wdf doctor                 # 环境诊断
wdf trace <id>             # 追溯查询
wdf lint [--strict]        # 规范一致性
```
