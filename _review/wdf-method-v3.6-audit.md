# wdf-method V3.6 — 全方位审核报告

**审核日期：** 2026-05-22
**项目规模：** 179 文件 / 39,354 行
**审核维度：** 稳定性、一致性、可跟踪性、易维护性、可扩展性、自动化程度、执行顺序一致性

---

## 一、稳定性

### 版本一致性 ✅

| 检查项 | 结果 |
|--------|------|
| 主规格版本 | 全部 3.6.0，0 漂移 |
| 子工作流版本 | 41/41 为 3.6.0 |
| Schema 版本 | 全部 3.6.0 |
| 门禁卡片版本 | 全部 3.6.0 |
| 提示模板版本 | 全部 3.6.0 |
| Agent 文件版本 | 全部 3.6.0 |

### 文件完整性 ✅

| 检查项 | 结果 |
|--------|------|
| 空文件 | 0 个 |
| 孤儿文件（无引用） | 0 个 |
| 损坏 YAML | 未检测到 |

### 状态设计稳定性 ✅

- 拆分文件设计消除了并行写入冲突（每文件一个写入者）
- sprint-status.yaml 是派生索引，损坏后零数据丢失
- 原子合并协议（--no-commit → 检查 → 提交|中止）

### 风险点 🟡

| 风险 | 说明 |
|------|------|
| `engine/` 目录为空 | 可能未提交 |
| `orchestrator/src/` 仅 1 个源文件 | 编排器引擎实现不完整 |
| `_test-project/` 含 17 个测试残留文件 | 未清理，可能混淆 |
| `_bmad-output/` 目录为空 | 结构就绪但无内容，正常 |

---

## 二、一致性

### 命名一致性 ✅

| 实体 | 名称 | 一致性 |
|------|------|--------|
| 项目目录 | `wdf-method` | ✅ |
| npm 包 | `wdf-method` | ✅ |
| CLI 命令 | `npx wdf-method install` | ✅ |
| BMAD 模块 code | `wdf` | ✅ |
| SKILL.md name | `wdf` | ✅ |
| 用户触发词 | `/web-dev-flow` | ⚠️ 与 wdf-method 不一致 |
| 输出目录 | `_bmad-output/web-dev-flow` | ⚠️ 仍用旧名 web-dev-flow |

**发现：** 用户触发词 `/web-dev-flow` 和输出目录 `web-dev-flow` 保留了旧项目名。这是有意设计（向后兼容），但新用户可能困惑。

### FSM 状态一致性 ✅

| 来源 | 状态数 |
|------|--------|
| SKILL.md | 101 处状态引用 |
| customize.toml | 46 个 sub-phase 含 fsm_states |
| sprint-status-schema.yaml | 33 个 enum 条目 |

三处定义一致——schema 是最严格的枚举，SKILL.md 是最宽松的文档。不存在矛盾的状态名。

### 子阶段定义一致性 ✅

| Phase | customize.toml | Phase 文件 | 子工作流文件 |
|-------|---------------|-----------|------------|
| Phase 1 | 3 sub-phases | 3 sub-phases | 3 文件 |
| Phase 2 | 10 sub-phases | 10 sub-phases | 10 文件 |
| Phase 3 | 9 sub-phases | 9 sub-phases | 9 文件 |
| Phase 4 | 14 sub-phases | 14 sub-phases | 14 + 5 full-stack |

**完全一致。**

### 交叉引用一致性 ✅

| 被引用资源 | SKILL.md 引用次数 | 文件是否存在 |
|-----------|------------------|------------|
| `references/sub-workflows/` | 36 | ✅ 41 文件 |
| `customize.toml` | 24 | ✅ |
| `references/gate-cards/` | 7 | ✅ 4 文件 |
| `specs/` | 6 | ✅ 8 文件 |
| `references/phase-0*` | 5 | ✅ 4 文件 |
| `schemas/` | 5 | ✅ 4 文件 |
| `references/agents/` | 2 | ✅ 13 文件 |
| `references/prompt-templates/` | 2 | ✅ 4 文件 |
| `references/variables.md` | 1 | ✅ |
| `assets/` | 1 | ✅ 3 文件 |

**零断裂引用。**

---

## 三、可跟踪性

### 状态跟踪 ✅

```
status/global.yaml          ← 全局状态（dev_mode, freeze timestamps）
status/phase-01.yaml        ← Phase 1 每个子阶段状态
status/phase-02.yaml        ← Phase 2 每个子阶段状态
status/phase-03.yaml        ← Phase 3 每个子阶段状态
status/phase-04-be.yaml     ← BE track 每个 story 状态
status/phase-04-fe.yaml     ← FE track 每个 story 状态
status/stories/{id}.yaml    ← 每个 story 的详细步骤历史
status/change-requests.yaml ← CR 列表
sprint-status.yaml          ← 派生索引（重建用）
```

每一步状态转换都有时间戳和 `state_history`。

### Agent 跟踪 ✅

```
/tmp/web-dev-flow/signals/
├── main-to-{agentId}.json   ← 编排器→agent 指令
├── {agentId}-to-main.json   ← agent→编排器 心跳+进度
└── agents/{agentId}/
    └── heartbeat.txt         ← 存活检查
```

### 检查点跟踪 ✅

每个 story 最少 3 次 git commit：
```
feat(S-3.2): implement Auth Endpoints — IMPLEMENTED
test(S-3.2): tests passing — TESTED
accept(S-3.2): CODE_ACCEPTED — MERGED
```

`last_completed_substep` 字段精确定位恢复点。

### 差距 🟡

| 差距 | 影响 |
|------|------|
| 无编排器决策审计日志 | 无法回溯编排器为什么分派/拒绝某个 story |
| 无 Phase 计时 | 无法分析瓶颈 |
| 无 agent 成功率统计 | 无法评估 agent 质量 |

---

## 四、易维护性

### 优势 ✅

- **14 个 SKILL.md** 文件作为入口点，方法论分离到 `references/agents/`
- **拆分文件状态** 让每个 Phase 独立演化
- **4 个 Phase 文件 + 41 个子工作流** 清晰的分层
- **8 个 specs/** 协议独立文档
- **customize.toml** 集中配置（700+ 行）

### 技术债务 🟡

| 债务 | 位置 | 建议 |
|------|------|------|
| FSM 状态定义有 3 处冗余副本 | SKILL.md + customize.toml + schema | 提取到 `references/fsm-states.md` |
| `/web-dev-flow` 与 `wdf-method` 命名不一致 | 用户触发词 vs 项目名 | 统一或文档说明 |
| `_test-project/` 测试残留 | 测试目录 | gitignore 或清理 |
| `engine/` 空目录 | engine/ | 清理或实现 |
| `_bmad-output/` 空结构 | 运行残留 | gitignore |

---

## 五、可扩展性

### 扩展点 ✅

| 扩展点 | 机制 | 示例 |
|--------|------|------|
| 新 Agent | `skills/wdf-*/SKILL.md` + `references/agents/*.md` | 添加 wdf-security-auditor |
| 新验收门禁 | `customize.toml` `[acceptance_gates]` | 添加 LOAD_TEST 门禁 |
| 新子阶段 | `references/sub-workflows/` + `customize.toml` fsm_states | Phase 4.15 部署门禁 |
| 新安全规则 | `[acceptance_check_safety]` allowlist/forbidden | 添加新命令前缀 |
| 新受保护路径 | `[scope_lock]` protected_paths | 项目特定路径 |
| 新通信协议 | `specs/agent-communication.md` 扩展 | 双向消息传递 |

### 局限性 🟡

| 局限 | 说明 |
|------|------|
| Agent() 是单向分派 | 无法中途发消息给正在运行的 agent |
| 仅支持 Claude Code | 无 Gemini CLI / Codex 适配器 |
| 不支持 GitLab/Bitbucket | merge queue 假设 GitHub 工作流 |

---

## 六、自动化程度

### 已自动化 ✅

| 层级 | 能力 |
|------|------|
| 工作流激活 | `/web-dev-flow init` → status/ 目录 + 状态文件 |
| Phase 路由 | Gate Card 自动评估 → 自动推进 |
| Story 分派 | 自动继续：符合条件的 story 自动并行分派 |
| 门禁检查 | SRG-01~09 每 story 自动验证 |
| 代码验收 | CA-01~05 自动审查 + 覆盖 + 类型 + lint + scope |
| 状态管理 | 每次状态转换自动写入 status/ 文件 |
| 合并队列 | 依赖排序的自动合并 |
| 暂停/恢复 | 信号驱动的优雅暂停 + 精确恢复 |
| 安装 | `npx wdf-method install` 一键安装 |

### 半自动化 🟡

| 层级 | 当前状态 |
|------|---------|
| Phase 1-3 输出验证 | 结构检查自动，语义检查依赖人工 |
| BMAD 技能回退 | 配置就绪，13 个原生 agent 覆盖 |
| 跨 Phase 一致性 | Phase 3.9 子 agent 执行，需编排器触发 |

### 未自动化 🟡

| 层级 | 说明 |
|------|------|
| 部署 | Phase 4 后无自动部署步骤 |
| 监控/告警 | 无运行时监控 |
| 回滚 | Story revert 需手动 git revert |
| 备份 | 无自动备份 status/ 文件 |

---

## 七、分步执行顺序一致性

### Phase 1 → Phase 4 完整链路验证

```
Phase 1 (Analysis — Optional)
  1.1 Brainstorming          ──→ output: brainstorming.md
  1.2 Domain Research (skip) ──→ output: domain-research.md
  1.3 Product Brief (skip)   ──→ output: product-brief.md
  Gate: G1-01 (user confirmation)
  ↓
Phase 2 (Planning)
  2.1 Impact Mapping         ──→ output: impact-map.md         [required]
  2.2 Event Storming         ──→ output: event-storm.md       [skip]
  2.3 JTBD Cards             ──→ output: jtbd-cards.md        [skip]
  2.4 Story Mapping          ──→ output: story-map.md         [required: gate 2.1]
  2.5 Kano+RICE+PRD          ──→ output: prd.md ★FREEZE      [required: gate 2.4]
  2.6 User Flows & IA        ──→ output: user-flows.md        [required: gate 2.5]
  2.7 Wireframes             ──→ output: wireframes.md        [required: gate 2.6]
  2.8 Design System          ──→ output: design-tokens.md     [skip]
  2.9 Interaction Design     ──→ output: interaction-spec.md  [skip]
  2.10 Design Acceptance     ──→ output: design-acceptance.md [required: gate 2.7]
  Gate: G2-01 (Phase 1 LOCKED/SKIPPED), G2-02 (user)
  ↓
Phase 3 (Solutioning)
  3.1 System Context (C4 L1) ──→ output: system-context.md    [required]
  3.2 Architecture Style     ──→ output: architecture-style.md [required: gate 3.1]
  3.3 Container Design (L2)  ──→ output: container-design.md  [required: gate 3.2]
  3.4 Quality Attributes     ──→ output: quality-attrs.md     [skip]
  3.5 Component Design (L3)  ──→ output: component-design.md  [required: gate 3.3]
  3.6 Epics & Feature Plan   ──→ output: epics.md             [required: gate 3.5]
  3.7 Story Design           ──→ output: stories/*.md ★FREEZE [required: gate 3.6]
  3.8 API & Data Design      ──→ output: api-spec + db-schema [required: gate 3.7]
  3.9 Readiness Check        ──→ cross-phase audit + boundary [required: gate 3.8]
  Gate: G3-01~06 (Phase 2 LOCKED, PRD approved, requirements frozen, code standards)
  ↓
Phase 4 (Implementation)
  4.1 Sprint Planning        ──→ scope-freeze tag + parallel groups
  ├── BE Track ──────────────────────────────────────────────
  │   4.2 BE Scaffolding     ──→ project init + health check
  │   4.3 BE Database        ──→ migrations + API client
  │   4.4 BE Endpoints       ──→ AUTO-CONTINUE per-story TDD
  │   4.5 BE Testing Suite   ──→ coverage >= 80%
  │   4.6 BE Completion      ──→ CODE ACCEPTANCE gate
  └── FE Track ──────────────────────────────────────────────
      4.7 FE Scaffolding     ──→ project init + routing
      4.8 FE Design System   ──→ base components
      4.9 FE API Client      ──→ typed client + mocks
      4.10 FE Pages           ──→ AUTO-CONTINUE per-story TDD
      4.11 FE A11y & Perf     ──→ Lighthouse + axe audit
      4.12 FE Completion      ──→ UI ACCEPTANCE gate
  └── Integration ───────────────────────────────────────────
      4.13 Integration        ──→ merge queue + E2E gates
      4.14 Retrospective      ──→ lessons learned
  Gate: G4-01~08 (Phase 3 LOCKED, all artifacts approved, dev order frozen)
```

### 发现 ✅

- ✅ 每个子阶段有明确的 gate 条件
- ✅ 每个子阶段有明确的输出文件
- ✅ skip 机制一致（Phase 1 全部可跳，Phase 2/3 部分可跳）
- ✅ 自动继续（4.4/4.10）故事间无缝
- ✅ 跨 Track 依赖正确：FE story 等待 BE story CODE_ACCEPTED
- ⚠️ 全栈模式（dev_mode=full_stack）路径较短（5 子阶段 vs 14），但定义完整

---

## 综合评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **稳定性** | ⭐⭐⭐⭐½ | 版本一致、文件完整、拆分状态设计健壮 |
| **一致性** | ⭐⭐⭐⭐½ | 命名基本一致、FSM一致、引用零断裂 |
| **可跟踪性** | ⭐⭐⭐⭐ | 状态历史完整、agent 心跳、检查点提交。缺编排器审计日志 |
| **易维护性** | ⭐⭐⭐⭐ | 分层清晰、集中配置。3 处 FSM 冗余 |
| **可扩展性** | ⭐⭐⭐⭐⭐ | 新 agent/门禁/子阶段/安全规则均可扩展 |
| **自动化程度** | ⭐⭐⭐⭐ | 核心流程全自动。缺部署/监控/备份 |
| **执行顺序一致性** | ⭐⭐⭐⭐⭐ | 36 子阶段链路完整、gate 条件明确、skip 一致 |
| **总体** | **⭐⭐⭐⭐½** | |

---

## 改进建议

### 立即修复（3 项）

| ID | 问题 | 修复 |
|----|------|------|
| A1 | `engine/` 空目录 | 清理或添加 `.gitkeep` 说明 |
| A2 | `_test-project/` 测试残留 | 添加 `.gitignore` 或迁移到独立测试目录 |
| A3 | 用户触发词 `/web-dev-flow` 与项目名 `wdf-method` 不一致 | 在 README/SETUP 中说明关系 |

### 短期改进（3 项）

| ID | 问题 | 修复 |
|----|------|------|
| B1 | FSM 状态定义 3 处冗余 | 提取到 `references/fsm-states.md`，其他文件引用 |
| B2 | 编排器决策无审计日志 | 添加 append-only `status/orchestrator-audit.jsonl` |
| B3 | `orchestrator/` 仅 1 个源文件 | 实现编排器引擎或标记为 WIP |

### 长期改进（2 项）

| ID | 问题 | 修复 |
|----|------|------|
| C1 | 仅支持 Claude Code | 添加 Gemini CLI / Codex 适配器 |
| C2 | 无自动部署步骤 | Phase 4.15 部署门禁 |
