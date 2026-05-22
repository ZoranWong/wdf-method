# wdf-method Engine — 审核报告

**审核日期：** 2026-05-22
**审核范围：** orchestrator/src/ 全部 13 源文件 / 3,523 行

---

## 已实现 ✅

| 能力 | 文件 | 状态 |
|------|------|------|
| FSM 引擎 (Phase 状态转换) | `orchestrator.ts` | ✅ 完整 |
| 状态仪表盘 | `orchestrator.ts` displayStatus() | ✅ |
| Gate Card 评估 | `gate-evaluator.ts` | ✅ |
| Story 运行器 (AUTO-CONTINUE) | `story-runner.ts` | ✅ |
| 合并队列 (依赖排序) | `merge-queue.ts` | ✅ |
| Sprint 状态读写 | `sprint-status.ts` | ✅ |
| Worktree 管理 | `worktree.ts` | ✅ |
| Agent 分派 | `agent-dispatcher.ts` | ✅ |
| 契约验证 | `contract-validator.ts` | ✅ |
| 页面一致性门禁 | `page-parity-gate.ts` | ✅ |
| 状态一致性验证 | `state-validator.ts` | ✅ |
| BMAD 健康检查 | `bmad-health-check.ts` | ✅ |
| TypeScript 类型 | `types.ts` — 43 interfaces/enums | ✅ |

## 存在差距 ❌

| 差距 | 严重性 | 位置 | 说明 |
|------|--------|------|------|
| **Phase 1 子阶段名称错误** | 🔴 | `orchestrator.ts:214` | 显示 "Impact Mapping/Event Storming/JTBD"，应为 "Brainstorming/Domain Research/Product Brief" |
| **Phase 2 子阶段名称错误** | 🔴 | `orchestrator.ts:215` | 显示 "Product Brief/Domain Research/Impact Mapping/..."，应为 V3.6 的 10 个正确名称 |
| **输出路径仍为 web-dev-flow** | 🟡 | `orchestrator.ts:619-621` | `_bmad-output/web-dev-flow/` 应支持 customize.toml 的 `output_dir` |
| **非拆分文件状态** | 🟡 | `sprint-status.ts` | 读的是统一 sprint-status.yaml，非 `status/*.yaml` 拆分文件 |
| **无原子合并** | 🟡 | `merge-queue.ts` | 合并用 `git merge --no-ff`，缺 `--no-commit → 检查 → commit|abort` |
| **无信号驱动暂停** | 🟡 | 全部文件 | 无 `/tmp/web-dev-flow/signals/` 读写 |
| **无隐性依赖检测** | 🟡 | `merge-queue.ts` | 无合并前的跨分支 diff 交叉分析 |
| **无 SRG 门禁** | 🟡 | `story-runner.ts` | Story Ready Gate (SRG-01~09) 只在 spec 中定义 |
| **无审计日志** | 🟢 | 全部文件 | 无 orchestrator-audit.jsonl 追加日志 |
| **版本注释过时** | 🟢 | `types.ts:1`, `orchestrator.ts:78` | 声明 V3.1，实际应 V3.6 |

---

## 覆盖度矩阵

| 规范能力 | 引擎实现 | 差距 |
|---------|---------|------|
| FSM 状态转换 | ✅ 完整 | — |
| 11种 Gate Card 检查 | ✅ gate-evaluator.ts | — |
| Agent() 分派 | ✅ agent-dispatcher.ts | — |
| 拆分文件状态 | ❌ | 读写统一 yaml |
| 合并队列 | ✅ 基础 | 缺原子合并+隐性检测 |
| SRG-01~09 | ❌ | 仅 spec 层 |
| 范围锁定 | ❌ | 仅 spec 层 |
| CA-01~05 | ❌ | 仅 spec 层 |
| 暂停/恢复 | ❌ | 无信号实现 |
| 隐性依赖检测 | ❌ | 无实现 |
| 跨Phase审计 | ❌ | 仅 spec 层 |
| 恢复仪表盘 | ❌ | 仅 spec 层 |

**覆盖度：6/12 (50%)**

---

## 建议

| 优先级 | 改进 | 文件 |
|--------|------|------|
| **P0** | 修复子阶段名称 | `orchestrator.ts:214-219` |
| **P0** | 默认路径更新 | `orchestrator.ts:619-621` |
| **P1** | 拆分文件状态读写 | `sprint-status.ts` |
| **P1** | 原子合并 + 隐性检测 | `merge-queue.ts` |
| **P2** | SRG 门禁检查 | `story-runner.ts` / `agent-dispatcher.ts` |
| **P2** | 信号驱动暂停 | 新文件或 orchestrator.ts |
| **P3** | 审计日志追加 | `orchestrator.ts` |
| **P3** | 恢复仪表盘 | `orchestrator.ts` |
