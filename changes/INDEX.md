# Change Requests Index

**最后更新**: 2026-06-21 (CHG-016 R3 入口一致性修复 IMPLEMENTED)

本目录托管所有 wdf-method 的变更提案（Change Request, CR），遵循 `schemas/change-request-schema.yaml` 与 `.template/proposal.md` 模板。

## 当前路线图

→ **[R2 标准化与自动化开发闭环路线图](../docs/plans/2026-06-18-r2-standardization-roadmap.md)**（v1.0.0, 2026-06-18）

## CR 看板

### R1 已实现 (v3.6.0 → v3.6.1)

| CR ID | 标题 | 优先级 | 目标版本 | 状态 | 负责人 | 关联 OPT |
|-------|------|--------|----------|------|--------|----------|
| [CHG-2026-001](CHG-2026-001-engine-hardening/proposal.md) | 引擎硬化 | — | 3.6.1 | ✅ IMPLEMENTED | AI | — |
| [CHG-2026-002](CHG-2026-002-spec-delta/proposal.md) | Spec Delta 与提案治理 | **P0** | 3.7.0 | ✅ IMPLEMENTED | AI | OPT-01 |
| [CHG-2026-003](CHG-2026-003-traceability-graph/proposal.md) | Traceability Graph + CR 影响分析 | **P0** | 3.7.0 | ✅ IMPLEMENTED | AI | OPT-02, OPT-09 |
| [CHG-2026-005](CHG-2026-005-contract-validator/proposal.md) | Contract Validator (AC↔测试) | **P0** | 3.7.0 | ✅ IMPLEMENTED | AI | OPT-04 |
| [CHG-2026-006](CHG-2026-006-auto-run-loop/proposal.md) | Auto-Run 主循环 | P1 | 3.8.0 | ✅ IMPLEMENTED | AI | OPT-05 |

### R2 P0 — E2E 验证闭环 (v3.7.0)

| CR ID | 标题 | 优先级 | 目标版本 | 状态 | 负责人 | 关联 R2 |
|-------|------|--------|----------|------|--------|----------|
| [CHG-2026-004](CHG-2026-004-self-host-e2e/proposal.md) | 自托管 E2E（todo-app） | **P0** | 3.7.0 | 🚧 IN_PROGRESS | AI | R2-01 |
| [CHG-2026-007](CHG-2026-007-ci-action/proposal.md) | wdf GitHub Action (CI) | **P0** | 3.7.0 | ✅ IMPLEMENTED | AI | R2-02 |
| [CHG-2026-009](CHG-2026-009-constitution-as-code/proposal.md) | Constitution 机读化 | **P0** | 3.7.0 | ✅ IMPLEMENTED | AI | R2-03 |
| [CHG-2026-010](CHG-2026-010-agent-communication/proposal.md) | Agent 通信协议集成 🆕 | **P0** | 3.7.0 | ✅ IMPLEMENTED | AI | R2-04 |

### R2 P1 — 鲁棒性与生态 (v3.8.0)

| CR ID | 标题 | 优先级 | 目标版本 | 状态 | 负责人 | 关联 R2 |
|-------|------|--------|----------|------|--------|----------|
| [CHG-2026-011](CHG-2026-011-snapshot-replay/proposal.md) | 状态快照与时间旅行 🆕 | P1 | 3.7.0 | ✅ IMPLEMENTED | AI | R2-05 |
| [CHG-2026-008](CHG-2026-008-multi-ide-runtime/proposal.md) | 多 IDE 运行时 | P1 | 3.8.0 | 🚧 IN_PROGRESS | AI | R2-06 |
| [CHG-2026-012](CHG-2026-012-error-recovery/proposal.md) | 错误恢复与自愈 🆕 | P1 | 3.8.0 | ✅ IMPLEMENTED | AI | R2-07 |

### R2 P2 — 提质与扩展 (v3.9.0)

| CR ID | 标题 | 优先级 | 目标版本 | 状态 | 负责人 | 关联 R2 |
|-------|------|--------|----------|------|--------|----------|
| [CHG-2026-013](CHG-2026-013-project-templates/proposal.md) | 跨项目模板系统 🆕 | P2 | 3.9.0 | ✅ IMPLEMENTED | AI | R2-08 |
| [CHG-2026-014](CHG-2026-014-cr-archive-spec-rewrite/proposal.md) | CR Archive → Canonical Rewrite 🆕 | **P0** | 3.8.0 | ✅ IMPLEMENTED | AI | R2-09 |

### R3 P0 — Spec 范式升级 (v3.8.1 → v3.9.0)

> **[R3 路线图](../docs/plans/r3-spec-as-truth-roadmap.md)**（待创建）— 对标 OpenSpec，把 wdf 从"流程标准化"推进到"spec 标准化"。

| CR ID | 标题 | 优先级 | 目标版本 | 状态 | 负责人 | 关联 R3 |
|-------|------|--------|----------|------|--------|----------|
| [CHG-2026-015](CHG-2026-015-specs-source-of-truth/proposal.md) | specs/ Source of Truth + Semantic Delta Archive | **P0** | 3.8.1→3.9.0 | 📝 PROPOSED | AI | R3-01 (S1-S6) |
| [CHG-2026-016](CHG-2026-016-r3-consistency-bugfix/proposal.md) | R3 入口一致性修复（12 bugs + 文档漂移） | **P0** | 3.8.1 | ✅ IMPLEMENTED | AI | R3-00 (CHG-015 前置) |

## 状态标识

- 📝 PROPOSED — 已起草
- 🔍 IN_REVIEW — 评审中
- 🚧 IN_PROGRESS — 开发中
- ⏸ BLOCKED — 阻塞
- ✅ IMPLEMENTED — 已合并
- 🗄 ARCHIVED — 已归档

## 依赖图

```
R2-S1 (E2E验证闭环):
  CHG-010 (agent-comm) ──→ CHG-004 (e2e demo) ←── CHG-011 (snapshot)
                                    ↓
R2-S2 (治理加固):                    ↓
  CHG-011 (snapshot) ──→ CHG-007 (CI) ──→ CHG-009 (constitution)
                                    ↓
                          CHG-012 (error-recovery)

R2-S3 (生态扩展):
  CHG-008 (multi-IDE)    独立
  CHG-013 (templates)    依赖 CHG-004 (e2e)

R3 (Spec 范式升级):
  CHG-016 (consistency-bugfix) ✅  ← CHG-015 前置门槛（已清零）
    ↓
  CHG-015 (specs/source-of-truth)
    ├ S1 (specs dir + sync)       → v3.8.1
    ├ S2 (semantic delta v2)      → v3.8.2  [deprecates CHG-002 v1]
    ├ S3 (archive cascade)        → v3.8.3  [upgrades CHG-014]
    ├ S4 (brownfield init)        → v3.8.3
    ├ S5 (traceability upgrade)   → v3.8.1
    └ S6 (v3.9.0 enforcement)     → v3.9.0
```

## 关键里程碑

- **M1 (R2-S1 结束, ~Week 2)**: todo-app 全自动跑通 — **R2 最重要节点**
- **M2 (R2-S2 结束, ~Week 4)**: CI + Constitution + 快照上线 → v3.7.0 GA
- **M3 (R2-S3 结束, ~Week 6)**: 多 IDE + 模板 + 错误自愈 → v3.9.0 GA

## 流程

1. 创建 CR：复制 `.template/proposal.md` → `CHG-YYYY-NNN-<slug>/proposal.md`
2. （3.7+ 起）补 `delta.yaml`（CHG-002 落地后）
3. 评审：状态从 PROPOSED → IN_REVIEW
4. 实施：状态 → IN_PROGRESS，更新此索引
5. 合入：状态 → IMPLEMENTED，关联 commit/PR
6. 归档（≥1 minor 后）：`wdf cr archive <id>` → `_archive/`

## 状态自洽校验

`wdf cr verify` 命令会比对 INDEX.md 中各 CR 的状态与 `proposal.md` frontmatter 中的 `Status:` 字段，并校验
IMPLEMENTED 的 CR 必须有：

1. proposal.md `Status: IMPLEMENTED` 头部
2. 至少一个对应模块的测试文件（按命名约定推断）

不一致即 exit 非零。CI 工作流（`.github/workflows/wdf-ci.yml`）每次 PR 都会跑此校验。
