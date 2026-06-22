# CLAUDE.md — wdf-method V3.8

## 完整工作流

```
wdf init "project description"     ← 初始化项目，创建状态文件
         │
         ▼
┌────────────────────────────────────────────────────┐
│  Phase 1: Analysis (可选)                           │
│  1.1 Brainstorming → impact-map.md                 │
│  1.2 Domain Research (auto-skip)                   │
│  1.3 Product Brief (auto-skip)                     │
├────────────────────────────────────────────────────┤
│  Phase 2: Planning (PRD + UX)                      │
│  2.1 Impact Mapping → 2.4 Story Mapping            │
│  2.5 PRD → 2.6 User Flows → 2.7 Wireframes        │
│  2.8 Design System (auto-skip)                     │
│  2.9 Interaction Design (auto-skip)                │
│  2.10 Design Acceptance                            │
├────────────────────────────────────────────────────┤
│  Phase 3: Solutioning (架构 + Stories)              │
│  3.1-3.5 C4 Architecture (L1→L2→L3)               │
│  3.6 Epics → 3.7 Stories → 3.8 API+DB             │
│  3.4 Quality Attributes (auto-skip)                │
│  3.9 Readiness Check → READY TO BUILD              │
├────────────────────────────────────────────────────┤
│  Phase 4: Implementation (自动化)                   │
│  BE Track (4.2-4.6) ∥ FE Track (4.7-4.12)        │
│  → Integration (4.13) → Retrospective (4.14)      │
└────────────────────────────────────────────────────┘
         │
         ▼
    部署就绪的应用
```

## 执行模型

wdf-method 严格分两层。**CLI 不调度 Agent，不执行 AI 工作**——它只回答"到哪了、缺什么、合不合格"。

| 层 | 负责 | 怎么工作 |
|----|------|----------|
| **Claude 会话（主控）** | 全部 AI 工作：Phase 1-3 写产物 / Phase 4 读 pipeline manifest，用 Agent tool 调度 dev/review/testing/QA agent，最大 5 次重试 | 调 `wdf start` 拿 dispatch manifest → 用 Agent 工具 dispatch 子 agent（dev→review→testing→QA） → 再次 `wdf start` 让 CLI 读取阶段 report 决定推进/重试/升级 |
| **TypeScript CLI（状态机 + 质检员）** | FSM 状态管理 + 产物校验 + pipeline manifest 构建 + escalation 通知 | 读状态、扫产物、写 manifest、读 review/test/QA report 决策推进或升级；从不 spawn 子进程，从不直接调 AI |

这是与 BMAD / SpecKit / OpenSpec 一致的"Spec 驱动"模式：Claude 是大脑，CLI 是黑板。

### 关键命令

```bash
wdf init <path>              # 初始化项目
wdf start                    # 查询当前状态，输出下一步提示词（驱动主循环）
wdf loop [--json]            # 自动调度：评估所有 story pipeline，返回下一步动作
wdf loop --post-dispatch     # agent 完成后清理权限 + 获取下一步
wdf check [--artifact=...]   # 检查产物质量是否合规
wdf gate                     # 检查门禁是否通过
wdf accept <type>            # 验收 code/ui/feature/e2e
wdf status                   # 查看完整仪表盘
wdf doctor                   # 环境诊断
wdf trace <id>               # 追溯需求链路 (JTBD→REQ→Story→Test→Commit)
wdf snapshot list|create     # 状态快照管理
wdf lint --strict            # 规范一致性检查 (含宪法校验)
wdf cr list|create|apply     # 变更请求管理
wdf permissions list|apply   # V3 权限注入管理
```

### 主循环（Claude 视角）

```
1. /wdf start                          # CLI: 判断当前阶段，生成 dispatch manifest
                                        #
2. ┌ Phase 1-3: CLI 输出提示词          #
   │ Claude 写产物                      #
   │ /wdf start → sync → LOCKED → 推进  #
   │                                    #
3. └ Phase 4: CLI 写 pipeline manifest  #
             主 Agent 读 manifest       #
             ├→ Agent tool: dev-agent (backend/frontend-developer.md)  #
             ├→ 读 review-report.json    #
             │   ├ PASS → 推进            #
             │   └ FAIL → Agent tool: dev-agent (带 feedback, 最多 5 次)  #
             ├→ Agent tool: code-reviewer agent (testing stage)  #
             ├→ Agent tool: qa-verifier agent (QA stage)  #
             └→ 任一环节 5 次失败 → PIPELINE_ESCALATED → 通知主 Agent      #
```

Phase 4 每条 story 独立走完 dev→review→testing→QA 流水线。Agent 角色模板见 `references/agents/`：
- dev → `backend-developer.md` / `frontend-developer.md`
- review/testing → `code-reviewer.md`（review 阶段做 adversarial review，testing 阶段聚焦测试覆盖）
- QA → `qa-verifier.md`

每个环节是独立的 sub-agent（通过 Agent tool 隔离）。

## 项目结构

```
wdf-method/
├── SKILL.md                    # Claude 技能入口 (命令路由)
├── CLAUDE.md                   # 本文件
├── customize.toml              # 可配置默认值
├── constitution.yaml           # 机器可读宪法 (CI 校验)
├── commands/                   # 技能命令文件 (wdf-init, wdf-start, ...)
│   ├── wdf-init.md
│   ├── wdf-start.md
│   ├── wdf-pause.md
│   ├── wdf-resume.md
│   └── ...
├── references/
│   ├── agents/                 # Agent 角色模板 (analyst, architect, pm, ...)
│   ├── phase-01-analysis.md
│   ├── phase-02-planning.md
│   ├── phase-03-solutioning.md
│   ├── phase-04-implementation.md
│   └── sub-workflows/          # 子阶段详细参考
├── orchestrator/               # TypeScript 执行引擎
│   └── src/orchestrator/
│       ├── index.ts            # CLI 入口
│       ├── orchestrator.ts     # PhaseOrchestrator (FSM + auto-run)
│       ├── fsm-engine.ts       # 状态转换引擎
│       ├── gate-evaluator.ts   # Gate Card 评估
│       ├── sprint-status.ts    # Split-file 状态管理
│       ├── agent-dispatcher.ts # Phase 4 story agent 分派
│       ├── pipeline-engine.ts  # dev→review→testing→QA 流水线引擎
│       ├── pipeline-runner.ts  # 流水线调度器 + 升级通知
│       ├── dispatch-loop-engine.ts # 自动调度协议引擎 (wdf loop)
│       ├── signal-manager.ts   # Agent 通信 (heartbeat/checkpoint)
│       ├── snapshot.ts         # 状态快照/时间旅行
│       ├── story-slicing.ts    # Story P0/P1 切片引擎
│       ├── error-handling.ts   # L1/L2/L3 错误恢复
│       ├── permission-injector.ts # V3 三层权限注入
│       ├── converge-engine.ts  # brownfield gap 分析引擎
│       ├── subphase-executor.ts # Phase 1-3 提示词构建
│       └── trace-cmd.ts        # 追溯查询 CLI
├── specs/                      # 设计规范文档
├── templates/todo-app/         # 项目模板
├── examples/todo-app/          # E2E 验证项目
└── tests/e2e/                  # Playwright E2E 测试
```

## 目标项目结构 (wdf init 创建)

```
my-project/
├── wdf.toml                    # 项目配置
└── _wdf_output/
    ├── status/                  # FSM 状态 (真相源)
    │   ├── global.yaml
    │   ├── phase-01.yaml ~ phase-04-{be,fe}.yaml
    │   ├── stories/
    │   ├── merge-queue/
    │   └── snapshots/
    ├── .prompts/                # 生成的提示词 (可重放)
    ├── prd.md                   # Phase 2.5 产物
    ├── epics.md                 # Phase 3.6 产物
    ├── api-spec.yaml            # Phase 3.8 产物
    ├── db-schema.md             # Phase 3.8 产物
    ├── stories/                 # Phase 3.7 产物
    └── _output/{analysis,planning,solutioning}/
```

## 关键设计决策

1. **Claude 会话主控，TypeScript 只做状态/质检** — CLI 从不 spawn 子进程，从不调 AI
2. **产物驱动 FSM** — `wdf start` 检测产物存在 → 同步 substate → LOCKED → 输出下一步提示词
3. **失败闭合** — 未知 Gate Check = FAIL（不是静默通过）
4. **单写者** — 每个状态文件只有一个写入者，零竞态
5. **文件契约** — Agent 间通过结构化文件（提示词 / 产物 / dispatch 清单）通信，不用 IPC
6. **追溯强一致** — 进入 Phase 4 前所有 Story 必须反向追溯到 PRD REQ（traceability gate）
