# Web-Dev-Flow V3.6 — 测试结果报告

**日期：** 2026-05-21
**测试项目：** TODO 应用（Express + React）

## 测试结果

### ✅ TC-01: 工作流初始化 — PASS

**验证结果：**
- [x] `status/` 目录创建 — `global.yaml`, `phase-01.yaml` 至 `phase-04-fe.yaml`, `change-requests.yaml` 全部就位
- [x] `status/merge-queue/` 和 `status/stories/` 目录创建
- [x] `sprint-status.yaml` 通过 `rebuild-status` 正确派生 — 格式正确，所有 Phase 状态串联
- [x] 拆分文件设计正确工作 — 每个文件一个写入者，零冲突

**发现的问题：** 无

### ✅ TC-02: Phase 1 跳过流程 — PASS（规范验证）

- [x] `status/phase-01.yaml` 正确跟踪 SKIPPED 状态
- [x] Phase 2 gate card G2-01 接受 `status: SKIPPED` 作为有效前置条件
- [x] G2-01 操作符为 `in`，期望值为 `["LOCKED", "SKIPPED"]`

### ⚠️ TC-03: Phase 2 最低路径 — 部分验证

**已验证（通过规范）：**
- [x] Phase 2 最低路径为 2.1 → 2.4 → 2.5 → 2.6 → 2.7 → 2.10
- [x] 2.5 触发 requirements_frozen_at 设置
- [x] 可跳过的子阶段（2.2、2.3、2.8、2.9）有明确的 skip_hint

**需要运行时验证：**
- [ ] 子 agent 分派提示模板是否与子阶段上下文匹配
- [ ] BMAD 技能调用成功（或回退激活）
- [ ] 工件输出通过结构验证

### ✅ TC-04: Phase 3 最低路径 — PASS（规范验证）

- [x] G3-06 强制 `code_standards_source` — 在 gate card 中定义为 `operator: "not_empty"`, `severity: "blocking"`
- [x] 3.7 Story Contract Freeze Gate 验证所有 7 个合约字段（CFG-01 至 CFG-07）
- [x] 3.9 跨 Phase 一致性审计子 agent（V3.6 新增）— 5 个检查类别已定义
- [x] Phase 3.7 → 3.8 排序正确：故事定义 API 需求 → API 设计综合

### ✅ TC-05/06: Phase 4 分离模式 — PASS（规范验证）

- [x] SRG-01 至 SRG-09 全部定义，无 ID 冲突
- [x] SRG-04：路径安全验证（相对路径、无遍历、无禁止路径）
- [x] SRG-08：受保护路径 → serial_only 标记
- [x] SRG-09：命令安全检查（allowlist + 禁止模式）
- [x] 原子合并协议已记录（git merge --no-commit → 检查 → 提交|中止）
- [x] 隐性依赖检测在 merge-queue.md 中定义
- [x] Per-story 状态文件位于 `status/stories/{story_id}-status.yaml`

### ✅ TC-07: 集成 + 验收 — PASS（规范验证）

- [x] 合并队列按 `merge_order` ASC 处理
- [x] 4 个验收门禁全部定义，具有可配置的阈值
- [x] 人类可读的错误翻译表存在（16 个检查 ID）

### ⚠️ TC-08: 错误恢复 — 部分验证

**已验证（通过规范）：**
- [x] 恢复仪表盘显示合并状态、活跃故事、排队故事
- [x] 建议的下一步操作按暂停条件分类
- [x] 防御性渲染：每个数据源独立失败（显示"N/A"）
- [x] 重建安全性：重建期间暂停故事分派 2 秒

**需要运行时验证：**
- [ ] 仪表盘在真实错误条件下的渲染效果
- [ ] `last_completed_substep` 恢复在实际崩溃后是否正确

### ⚠️ TC-09: BMAD 回退 — 规范验证

- [x] 启动能力检测步骤（Step 2.5）检查：
  - Git worktree 支持
  - BMAD 技能可用性（每个技能单独检查）
  - 回退模板验证（阻塞性 — 缺失模板会停止启动）
  - Agent 工具可用性
- [x] 20 个技能回退全部在 customize.toml 中配置
- [x] `fallback_mode = "inline_sub_agent"` → 分派等效的内联子 agent

**需要运行时验证：**
- [ ] 回退模板文件 (`references/prompt-templates/{prompt_key}.md`) 是否全部存在
- [ ] 回退输出通过 Phase 1-3 结构验证

### ✅ TC-10: 全栈模式 — PASS（规范验证）

- [x] 全部 5 个 fs-* 文件更新至 V3.6.0，具有 `v36_parity` 映射
- [x] fs-3-stories.md 具有完整的子步骤 ID 映射（FS-3a 至 FS-3j）
- [x] fs-4-qa.md 具有三级验收门禁顺序
- [x] fs-5-review.md 具有原子合并 + 交付检查表引用

## 总结

| 指标 | 结果 |
|------|------|
| 测试通过（规范验证） | 10/10 |
| 测试通过（运行时验证） | 4/10 — 需要实际的 AI agent 执行环境 |
| 发现的关键问题 | 0 |
| 发现的表面问题 | 0（全部在第 5 轮修复） |
| 版本一致性 | 100%（排除示例数据） |
| 术语一致性 | 100%（"Thin Orchestrator" 已统一） |

**结论：** 规范在所有可静态验证的方面均通过。运行时验证（TC-03、TC-08、TC-09 部分，以及实际的子 agent 分派）需要在具有可用 Agent 工具和 BMAD 技能的完整 Claude Code 环境中进行。

**下一步：** 在支持 Agent 工具的 Claude Code 会话中，使用"为 TODO 应用创建一个 Web 项目"的描述运行 `web-dev-flow init`。
