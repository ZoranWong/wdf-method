# Web-Dev-Flow V3.6 — 试点测试方案

**创建日期：** 2026-05-21
**目的：** 通过实际运行工作流，验证 V3.6 规范的可执行性和发现运行时问题

## 测试项目：TODO 应用

一个最小但覆盖全栈的测试项目：
- **功能：** 用户注册/登录、创建/查看/编辑/删除待办事项
- **后端：** Express + TypeScript + PostgreSQL（REST API）
- **前端：** React + TypeScript + Vite
- **复杂度：** 简单（符合轻量/串行模式测试）

## 测试用例

### TC-01: 工作流初始化
- **步骤：** 执行 `web-dev-flow init`
- **验证点：**
  - [ ] `status/` 目录创建（global.yaml, phase-01 至 phase-04-*.yaml）
  - [ ] `status/merge-queue/` 和 `status/stories/` 目录创建
  - [ ] `status/change-requests.yaml` 创建
  - [ ] `sprint-status.yaml` 通过 `rebuild-status` 正确派生
  - [ ] 所有路径通过 customize.toml 正确解析

### TC-02: Phase 1 跳过流程
- **步骤：** 选择跳过 Phase 1
- **验证点：**
  - [ ] `status/phase-01.yaml` 写入 status: SKIPPED
  - [ ] Phase 2 gate card G2-01 接受 SKIPPED 作为有效前置条件

### TC-03: Phase 2 最低路径
- **步骤：** 运行 2.1 → 2.4 → 2.5 → 2.6 → 2.7 → 2.10
- **验证点：**
  - [ ] 每个子阶段向 `status/phase-02.yaml` 写入正确的 FSM 状态
  - [ ] 2.5 完成后 `requirements_frozen_at` 在 `status/global.yaml` 中设置
  - [ ] 可跳过的子阶段 (2.2, 2.3, 2.8, 2.9) 显示 skip 提示

### TC-04: Phase 3 最低路径
- **步骤：** 运行 3.1 → 3.2 → 3.3 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9
- **验证点：**
  - [ ] Gate card G3-06 验证 code_standards_source 已声明
  - [ ] 3.7 完成后 `development_order_frozen_at` 设置
  - [ ] 3.9 跨 Phase 一致性审计子 agent 分派
  - [ ] Story Contract Freeze Gate 验证所有 7 个合约字段

### TC-05: Phase 4 分离模式（BE 轨道）
- **步骤：** 运行 4.1 → 4.2 → 4.3 → 4.4 (AUTO-CONTINUE)
- **验证点：**
  - [ ] Sprint planning 创建 `scope-freeze/pre-implementation` git tag
  - [ ] BE scaffolding 创建项目结构
  - [ ] BE database 创建并运行迁移
  - [ ] Story Ready Gate (SRG-01 至 SRG-09) 每个故事均通过
  - [ ] Per-story 状态文件写入 `status/stories/{story_id}-status.yaml`
  - [ ] CODE_ACCEPTANCE (CA-01 至 CA-05) 全部通过
  - [ ] 合并队列项以正确的 merge_order 创建

### TC-06: Phase 4 分离模式（FE 轨道）
- **步骤：** 运行 4.7 → 4.8 → 4.9 → 4.10 (AUTO-CONTINUE)
- **验证点：**
  - [ ] FE 脚手架创建项目结构
  - [ ] FE 设计系统构建基础组件
  - [ ] FE API 客户端从 OpenAPI spec 生成
  - [ ] Page Parity Gate 在实施前验证 UX spec 对齐
  - [ ] UI ACCEPTANCE 门禁（Lighthouse >= 90, axe 审计通过, bundle < 500KB）

### TC-07: 集成 + 验收
- **步骤：** 运行 4.13 → 4.14
- **验证点：**
  - [ ] 合并队列按依赖顺序处理
  - [ ] 隐性依赖检测运行（无假阳性）
  - [ ] 原子合并协议（--no-commit → 检查 → 提交|中止）
  - [ ] FEATURE ACCEPTANCE 门禁通过
  - [ ] E2E BROWSER ACCEPTANCE 门禁通过

### TC-08: 错误恢复
- **步骤：** 在 Phase 4 中人为引入故障
- **验证点：**
  - [ ] 自动运行暂停并显示恢复仪表盘
  - [ ] 仪表盘显示合并状态、活跃故事、排队故事
  - [ ] 建议的下一步操作与暂停条件匹配
  - [ ] 错误消息使用人类可读翻译（非 SRG 代码）
  - [ ] `last_completed_substep` 允许精确恢复

### TC-09: BMAD 回退
- **步骤：** 在 BMAD 技能不可用的环境中运行
- **验证点：**
  - [ ] 启动能力检测报告缺失的技能
  - [ ] 回退子 agent 为缺失的技能分派
  - [ ] 回退提示模板存在且非空
  - [ ] 回退输出通过 Phase 1-3 结构验证

### TC-10: 全栈模式（可选）
- **步骤：** 使用 `dev_mode = "full_stack"` 运行
- **验证点：**
  - [ ] fs-1 至 fs-5 子工作流遵循 V3.6 对等映射
  - [ ] 全栈子步骤 ID (FS-3a 至 FS-3j) 跟踪恢复
  - [ ] 验收门禁按正确顺序应用（FEATURE → UI → E2E）

## 预期问题与观察点

| 风险区域 | 观察内容 | 严重性 |
|---------|---------|--------|
| Agent 工具可用性 | 子 agent 是否可按 `isolation: "worktree"` 分派 | 关键 |
| BMAD 技能可用性 | 14 个技能中实际可用的有多少 | 关键 |
| Git worktree 支持 | `.claude/worktrees/` 是否可创建 | 关键 |
| 子 agent 超时 | 30 分钟对于实际的 TDD 循环是否足够 | 高 |
| 回退输出质量 | 内联 agent 输出是否与 BMAD 技能质量匹配 | 高 |
| 状态文件 IO 时序 | 拆分文件写入是否存在可见延迟 | 中 |
| 合并原子性 | `git merge --abort` 是否在集成检查失败时正确触发 | 中 |
| 仪表盘渲染 | 所有数据源的防御性读取是否按预期工作 | 低 |
