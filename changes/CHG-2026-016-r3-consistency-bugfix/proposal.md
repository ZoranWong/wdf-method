# CHG-2026-016: R3 入口一致性修复（12 bugs + 文档漂移）

```
Change ID: CHG-2026-016
Proposed:  2026-06-21
Author:    AI Agent
Status:    IMPLEMENTED
Implemented: 2026-06-21
Priority:  P0
Target:    3.8.1
Roadmap:   R3 (Spec 范式升级) 前置门槛
```

## 1. 摘要

**问题**：在起草 [CHG-2026-015](../CHG-2026-015-specs-source-of-truth/proposal.md)（specs/ source-of-truth）时对 wdf-method V3.8 做了系统审计，发现 12 处实现 bug 与文档/宪法声明不一致。这些问题在 specs 升级前必须修复——否则 S1-S6 会在错误基础上建造，traceability graph 与 gate evaluator 会持续给出假阳性/假阴性。

**方案**：分波次修复，每条 bug 都附 minimized test 锁定行为。修复后 927 个测试全绿，`wdf lint` 零警告，`wdf cr verify` 通过，`wdf constitution` 通过。

**影响**：内部硬化，无 public API 变更。init 生成的 `phase-0[1-3].yaml` 与 `phase-04[-be|-fe].yaml` 字段精确化（auto_skip、sub_phase 键名）；旧项目升级后下游 consumer（status.ts / orchestrator.ts）能正确读取。

## 2. 背景与动机

CHG-2026-015 的 S1（specs/ 目录 + 双向同步）需要可靠的 traceability graph、严格的 gate evaluator、以及与 customize.toml 一致的 auto_skip 行为。审计发现：

- Bug #1: `init.ts` 硬编码 `autoSkip=false`，无视 customize.toml 的 `[auto_run.auto_skip]`
- Bug #2: `dispatchStoryAgent` 的 spawn 路径在生产环境仍可被触发，违反"CLI 不调度 Agent"宪法 §3.2
- Bug #3: `user_confirmation` gate 永远 FAIL，导致 auto 执行模式无法跨过任何交互式门禁
- Bug #4: traceability graph 只声明 `COMMIT` 节点类型，从未实际解析 git log
- Bug #5: pipeline manifest 的 `previous_output` 字段恒为 `undefined`，stage 间无上下文传递
- Bug #6: 状态文件无 single-writer 锁，并发 CLI 调用会互相覆盖
- Bug #7: phase_4_1 (Sprint Planning) 在 init 写入但 orchestrator 永不推进，且 BE/FE 子阶段编号错位
- Bug #8: `constitution-validator` 缺少独立 CLI 入口
- Bug #9-12: CLAUDE.md / SKILL.md / wdf-agent.md / 3-7-stories.md 文档与代码漂移

## 3. 修复明细

### Wave 1 — 状态机一致性

| Bug | 文件 | 修复要点 |
|-----|------|----------|
| #1 | `init.ts` | 新增 `loadAutoSkipMap(projectRoot)`，从 customize.toml `[auto_run.auto_skip]` 读取 `skip` 项；项目根无 customize.toml 时通过 `import.meta.url` 回退到 framework root。`getPhase1SubPhases` 改为 complexity-aware（simple/standard 跳过 1.2/1.3） |
| #7 | `init.ts`, `status.ts`, `orchestrator.ts` | 新增 `writePhase4SharedState`：phase-04.yaml 含 4.1/4.13/4.14；BE 文件改为 4.2-4.6；FE 文件改为 4.7-4.12；`executeImplementationPhase` 入口处 `advanceSubPhase(4, 'phase_4_1', ...)`；status.ts 读取 shared + BE + FE 三处 sub_phases |

### Wave 2 — Pipeline 闭环

| Bug | 文件 | 修复要点 |
|---|------|----------|
| #5 | `pipeline-runner.ts` | 新增 `collectPreviousOutput(storyId, stage, projectRoot)`：review 阶段转发 review notes；testing 阶段加 review_notes；qa 阶段加 test_files；dev fix-loop 转发触发重试的 FAIL report |
| #3 | `gate-evaluator.ts`, `types.ts`, `orchestrator.ts` | `GateCheck.allow_auto_degrade: boolean`；executionMode 通过 `evaluate(opts)` 第 3 参传入；4 处 evaluate 调用站点统一读取 `getExecutionMode()`。auto-mode 下 `allow_auto_degrade=true` 的 user_confirmation PASS，否则 fail-closed |

### Wave 3 — 宪法 + 安全

| Bug | 文件 | 修复要点 |
|---|------|----------|
| #2 | `agent-dispatcher.ts`, `story-runner.ts` | `dispatchStoryAgent` 加 `WDF_ALLOW_SPAWN` runtime guard（默认 throw）；移除 `@deprecated` 误导性 JSDoc；`StoryRunner` 删除未用的 `agentDispatcher` 字段 |
| #6 | `sprint-status.ts` | O_EXCL create 实现 `.wdf-status.lock`；5 分钟 stale reap；`save()` 包裹 `saveInner()` 在 try/finally 中释放锁 |
| #8 | `index.ts` | 新增 `wdf constitution [--json]` CLI 子命令，包装 `CONSTITUTION_THRESHOLDS` lint rule，专用于 CI 快速门禁 |

### Wave 4 — 文档对齐

| Bug | 文件 | 修复要点 |
|---|------|----------|
| #4 | `traceability-graph.ts` | 新增 `parseCommits(b, projectRoot)`：执行 `git log --no-merges --format="%H%x09%s"`，匹配 STORY ID 后插入 COMMIT 节点 + `references` 边 |
| #9 | `CLAUDE.md` | pipeline 图修正：testing-agent → code-reviewer agent (testing stage)；QA-agent → qa-verifier agent (QA stage) |
| #10 | `commands/wdf-agent.md` | 删除引用 SKILL.md 不存在小节的 "Full Spec" 段；dispatch 描述改为 "clean context window (no inherited conversation state)" |
| #11 | `references/sub-workflows/solutioning/3-7-stories.md` | 新增 Agent Templates 段：story-planner.md 用于深度设计，story-slicer.md 用于批量 stub |
| #12 | `SKILL.md` | "Step 5: Loop Termination" → Step 6；"Step 6: Error Handling" → Step 7 |

### Bonus — 测试套件一致性

- `traceability-graph.test.ts:274` 更新为期望新 `semantic` 字段
- `e2e.test.ts:363` 修正：`global_state.development_order` → `workflow.development_order`（schema 映射）
- `snapshot.test.ts:355` 修正：snapshot.ts 实际 emit `build-start-`（与函数名 `autoSnapshotBuildStart` 一致），而非 `pipeline-start-`
- `init.test.ts:166,171` 修正：BE 子阶段 5 个（4.2-4.6），FE 子阶段 6 个（4.7-4.12）
- `status.test.ts:215` 修正：phase 4 总子阶段 14 个（shared 3 + BE 5 + FE 6）
- `gate-evaluator.test.ts` 新增 3 case：default fail-closed / allow_auto_degrade + auto / critical 不降级
- `agent-dispatcher.test.ts` 新增 1 case：缺 `WDF_ALLOW_SPAWN` 时 throw；beforeEach/afterEach 设置/清理 env

### Lint 清理

- `references/phase-02-planning.md` / `phase-03-solutioning.md` / `phase-04-implementation.md`：7 处 `source: "{sprint_tracking}"` → `source: "{status_global_file}"`（dependency_status 实际只看 `field:`，source 仅是文档）
- `orchestrator/src/orchestrator/linter/rules/no-deprecated-terms.ts`：新增 `references/variables.md` 豁免（该文件职责就是枚举所有变量含 deprecated）+ 行级 `<!-- lint-ignore-deprecated -->` opt-out

## 4. 验收

- [x] 927 tests pass, 1 pre-existing skip（vitest 全套）
- [x] `wdf lint` 零警告
- [x] `wdf cr verify` 15/15 一致
- [x] `wdf constitution --root=$(pwd)` 0 errors
- [x] 新 init 项目 phase-02.yaml 中 phase_2_2/2_8/2_9.auto_skip = true
- [x] 新 init 项目 phase-03.yaml 中 phase_3_4.auto_skip = true
- [x] 新 init 项目 global.yaml 中 workflow.execution_mode = "auto"（当 --execution-mode auto 时）
- [x] `dispatchStoryAgent` 在缺 env var 时立即 throw，message 含 "disabled by default"
- [x] `user_confirmation` + `allow_auto_degrade: true` + executionMode=auto → PASS
- [x] traceability graph 在 git repo 中包含 COMMIT 节点（story 任意 commit message 含 STORY ID 即建边）

## 5. 回滚方案

每条修复都是孤立的，可独立 revert。最敏感的是 Bug #2（spawn guard）——若 production 误调 `dispatchStoryAgent`，临时回退方案是设 `WDF_ALLOW_SPAWN=1` 而非改代码。

## 6. 关联

- 前置：[CHG-2026-015](../CHG-2026-015-specs-source-of-truth/proposal.md)（specs source-of-truth）— 本 CR 是其门槛
- 后续：CHG-015 S1 可在干净基础上启动
- 部分覆盖：[CHG-2026-003](../CHG-2026-003-traceability-graph/proposal.md)（traceability graph COMMIT 解析本应在那批交付）
