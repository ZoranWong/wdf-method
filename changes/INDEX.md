# Change Requests Index

**最后更新**: 2026-06-18

本目录托管所有 wdf-method 的变更提案（Change Request, CR），遵循 `schemas/change-request-schema.yaml` 与 `.template/proposal.md` 模板。

## 当前路线图

→ **[标准化与自动化开发能力优化路线图](../docs/plans/2026-06-17-standardization-automation-roadmap.md)**（v1.0.0, 2026-06-17）

## CR 看板

| CR ID | 标题 | 优先级 | 目标版本 | 状态 | 负责人 | 关联 OPT |
|---|---|---|---|---|---|---|
| [CHG-2026-001](CHG-2026-001-engine-hardening/proposal.md) | 引擎硬化 | — | 3.6.1 | ✅ IMPLEMENTED | AI | — |
| [CHG-2026-002](CHG-2026-002-spec-delta/proposal.md) | Spec Delta 与提案治理 | **P0** | 3.7.0 | ✅ IMPLEMENTED | AI | OPT-01 |
| [CHG-2026-003](CHG-2026-003-traceability-graph/proposal.md) | Traceability Graph + CR 影响分析 | **P0** | 3.7.0 | 📝 PROPOSED | TBD | OPT-02, OPT-09 |
| [CHG-2026-004](CHG-2026-004-self-host-e2e/proposal.md) | 自托管 E2E（todo-app） | **P0** | 3.7.0 | 📝 PROPOSED | TBD | OPT-03 |
| [CHG-2026-005](CHG-2026-005-contract-validator/proposal.md) | Contract Validator (AC↔测试) | **P0** | 3.7.0 | 📝 PROPOSED | TBD | OPT-04 |
| [CHG-2026-006](CHG-2026-006-auto-run-loop/proposal.md) | Auto-Run 主循环 | P1 | 3.8.0 | 📝 PROPOSED | TBD | OPT-05 |
| [CHG-2026-007](CHG-2026-007-ci-action/proposal.md) | wdf GitHub Action | P1 | 3.8.0 | 📝 PROPOSED | TBD | OPT-06 |
| [CHG-2026-008](CHG-2026-008-multi-ide-runtime/proposal.md) | 多 IDE 运行时 | P1 | 3.8.0 | 📝 PROPOSED | TBD | OPT-07 |
| [CHG-2026-009](CHG-2026-009-constitution-as-code/proposal.md) | Constitution 机读化 + trace | P1 | 3.8.0 | 📝 PROPOSED | TBD | OPT-08, OPT-09 |

## 状态标识

- 📝 PROPOSED — 已起草
- 🔍 IN_REVIEW — 评审中
- 🚧 IN_PROGRESS — 开发中
- ⏸ BLOCKED — 阻塞
- ✅ IMPLEMENTED — 已合并
- 🗄 ARCHIVED — 已归档

## 依赖图

```
CHG-002 (delta) ─┬─→ CHG-003 (graph) ──→ CHG-009 (constitution + trace)
                 │
                 └─→ (使所有后续 CR 可结构化)

CHG-006 (auto-run) ──→ CHG-004 (e2e demo)

CHG-005 (contract-validator)  独立
CHG-007 (ci-action)           独立
CHG-008 (multi-ide)           独立
```

## 关键里程碑

- **M1（~Week 4）**：CHG-002 + CHG-005 + CHG-006 完成 → todo-app demo 跑通
- **M2（3.7.0 GA）**：CHG-003 + CHG-004 完成 → P0 闭环
- **M3（3.8.0 GA）**：CHG-007 + CHG-008 + CHG-009 完成 → P1 大众化

## 流程

1. 创建 CR：复制 `.template/proposal.md` → `CHG-YYYY-NNN-<slug>/proposal.md`
2. （3.7+ 起）补 `delta.yaml`（CHG-002 落地后）
3. 评审：状态从 PROPOSED → IN_REVIEW
4. 实施：状态 → IN_PROGRESS，更新此索引
5. 合入：状态 → IMPLEMENTED，关联 commit/PR
6. 归档（≥1 minor 后）：`wdf cr archive <id>` → `_archive/`
