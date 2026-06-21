# CHG-2026-015: specs/ Source of Truth + Semantic Delta Archive

```
Change ID: CHG-2026-015
Proposed: 2026-06-20
Author: AI Agent
Status: IMPLEMENTED
Priority: P0
Target: 3.9.0 (enforcement) / 3.8.1+ (incremental rollout)
Roadmap: docs/plans/r3-spec-as-truth-roadmap.md (to be created)
Related:
  - CHG-2026-002 (spec-delta v1 — will be deprecated at v3.9.0)
  - CHG-2026-014 (cr-archive mechanical patch — will be upgraded)
  - CHG-2026-005 (contract-validator — will consume BDD scenarios)
References:
  - OpenSpec docs/concepts.md (delta spec, brownfield-first, archive flow)
  - github/spec-kit spec-driven.md (constitutional template gates)
```

## 1. 摘要

**问题**：wdf 当前 PRD/epics/api-spec/db-schema 是手工写的真相源，无 `specs/` 目录；`delta.yaml` 是机械式字段 patch（RFC 6902-style），不是语义式 delta。导致：

1. spec 不是真正的 single source of truth（每次 CR archive 后正典与代码逐渐漂移）
2. delta 无法跨产物级联（改 PRD 不会自动改 api-spec）
3. archive 是 file patch，不是 semantic merge（无 ADDED/MODIFIED/REMOVED 语义）
4. 无法支持 brownfield（无现成 spec 可参考，wdf 只能从零开始）

**方案**：引入 `specs/<domain>/spec.md`（BDD 格式）作为唯一真相源；升级 `delta.yaml` 为 semantic ADDED/MODIFIED/REMOVED；PRD/epics/api-spec 变为 derived view，由 `wdf spec sync` 生成；`wdf cr archive` 升级为 semantic merge + cascade regenerate。

**影响**：大。v3.8.x 双轨期，v3.9.0 起强制。已 lock 的三个设计决策：

| 维度 | 决策 |
|---|---|
| specs/ 与 PRD 关系 | specs/ 为源，PRD 是 derived |
| Delta 强制度 | v3.9.0 起强制 semantic v2 |
| Scenario 格式 | GIVEN/WHEN/THEN (BDD) |

## 2. 背景与动机

### 2.1 与三个对标框架的差距

详见 2026-06-20 深度评估报告。核心结论：

- **vs OpenSpec**：wdf 有 CHG-002/014 实现的 delta + archive，但 delta 是机械式 patch，不是 OpenSpec 那种 ADDED/MODIFIED/REMOVED 的语义 delta。wdf 没有 `specs/<domain>/spec.md` 这个真相源层。
- **vs SpecKit**：wdf 的 `constitution.yaml` 只检查流程质检（state-consistency, gate-hardening），没有架构强约束（Library-First / Simplicity / Anti-Abstraction）。本 CR 不解决这个，留给 CHG-016。
- **vs BMAD V6**：wdf 缺 step files 和真正的 multi-IDE runtime。本 CR 不解决，留给 CHG-017。

本 CR 只聚焦 OpenSpec 范式拉齐——把 wdf 从"流程标准化"推进到"spec 标准化"。

### 2.2 为什么现在做

- R2-S1 todo-app demo（CHG-004）即将启动，但 demo 用的还是 v1 mechanical delta。如果不在 demo 前固化 v2 语义，v3.9.0 强制切换会让 demo 退化。
- 14 个已存在的 CR 中只有 4 个有 delta.yaml（CHG-001/002/003/005），其余 10 个还是自然语言描述。趁机统一到 v2 语义，比逐个补 v1 更划算。

## 3. 规范差异

### 3.1 修改前的规范

```
# 当前架构（v3.8.0）

_wdf_output/
├── prd.md                  ← 手工写，是真相源
├── epics.md                ← 手工写，是真相源
├── api-spec.yaml           ← 手工写，是真相源
├── db-schema.md            ← 手工写，是真相源
└── changes/
    └── CHG-XXX/
        ├── proposal.md
        └── delta.yaml      ← 机械式 patch (schema_version: 1)
                              # op: set/remove/modify/append/create/delete
                              # target: { kind, file, path/section }
```

### 3.2 修改后的规范

```
# 目标架构（v3.9.0）

_wdf_output/
├── specs/                          ← ✨ CANONICAL SOURCE OF TRUTH (新增)
│   ├── auth/spec.md                # Requirement + Scenario (BDD)
│   ├── todos/spec.md
│   └── data/spec.md
├── prd.md                          ← DERIVED (由 wdf spec sync 生成)
├── epics.md                        ← DERIVED
├── api-spec.yaml                   ← DERIVED
├── db-schema.md                    ← DERIVED
└── changes/
    └── CHG-XXX/
        ├── proposal.md
        ├── delta.yaml              ← 升级: schema_version: 2 (semantic)
        │                              # op: ADDED | MODIFIED | REMOVED
        │                              # domain + requirement + scenarios + cascades
        └── specs/                  ← ✨ delta spec files (新增)
            └── auth/spec.md        # ## ADDED Requirements / ## MODIFIED / ## REMOVED
```

### 3.3 兼容性分析

- [ ] 完全向后兼容（仅新增） — **否**
- [x] 部分不兼容（有废弃、行为变更） — v3.8.x 双轨，v3.9.0 起 v1 delta 报错
- [ ] 破坏性变更（需要迁移脚本） — 提供 `wdf cr migrate` 自动转换

**迁移策略**：

| 触达点 | 迁移方式 |
|---|---|
| 现有 14 CR（10 个无 delta.yaml） | 不强制补；archive 后只读 |
| 现有 4 CR 的 v1 delta.yaml | `wdf cr migrate <id>` 自动转 v2，或保留 v1 直至 archive |
| 现有项目的 PRD/epics | `wdf spec sync --reverse` 一次性抽取到 specs/，后续 specs/ 为源 |
| 现有 stories 的 AC（自然语言） | `wdf spec migrate-ac` 辅助转 BDD（不强制，可在 archive 时做） |
| customize.toml | 新增 `[specs] source_of_truth = false`，渐进切换 |

## 4. 实施计划

### 4.1 任务清单（6 个 slice）

```
[x] S1: specs/ 目录结构 + wdf spec sync 双向同步            (v3.8.1, 3 工日)
[x] S2: delta.yaml v2 semantic format + cr-applier 升级     (v3.8.2, 4 工日)
[x] S3: cr archive cascade regenerate + --no-regenerate flag (v3.8.3, 2 工日)
[x] S4: wdf init --existing brownfield 模式                 (v3.8.3, 3 工日)
[x] S5: traceability graph 升级支持 specs/ 节点              (v3.8.1, 2 工日)
[x] S6: v3.9.0 enforcement (default flip + migrate 命令)     (v3.9.0, 2 工日)
```

详细 task breakdown 见各 slice 的 sub-proposal（实施时补）。

### 4.2 验收标准

- [ ] `wdf spec sync` 双向同步幂等（specs/ ↔ PRD/epics 反复同步无 diff）
- [ ] `wdf spec sync --reverse` 能从现有 PRD 抽取 specs/<domain>/spec.md
- [ ] delta.yaml v2 (semantic) archive 后 specs/<domain>/spec.md 正确合并（ADDED append / MODIFIED replace / REMOVED delete）
- [ ] archive cascade regenerate 后 PRD/epics/api-spec/db-schema 与 specs/ 一致
- [ ] gate-evaluator 的 `prd_matches_specs` check 在不一致时 blocking fail
- [ ] `wdf spec test-gen <domain>` 从 BDD scenario 生成 Cucumber/Playwright 测试骨架
- [ ] `wdf init --existing --from openapi` 能从 OpenAPI 3.x 推导 specs/
- [ ] v3.9.0 起 `delta.yaml schema_version=1` 直接 error，提示用 `wdf cr migrate`
- [ ] `wdf cr migrate CHG-001` 能把 v1 转 v2，dry-run 模式输出 diff
- [ ] spec-schema.yaml 校验 BDD 格式（GIVEN/WHEN/THEN）+ RFC 2119 关键字 + 无 placeholder
- [ ] 单测覆盖率 ≥ 90%

### 4.3 回滚方案

1. `customize.toml [specs] source_of_truth = false` 可全局禁用 specs/ 层
2. v1 delta.yaml 在 v3.9.0 之前始终可 apply
3. archive 失败时 git stash 自动恢复（已有机制）
4. v3.9.0 enforcement 可通过 `WDF_LEGACY_DELTA=1` 环境变量临时绕过（仅限紧急回滚窗口）

## 5. 替代方案

### 5.1 不动现有 PRD/epics，仅新增 specs/ 作为镜像（弱一致性）

- **优点**：零迁移成本，现有项目无感
- **缺点**： specs/ 和 PRD 必然漂移，违背 single source of truth 原则；没有真正解决"spec 不是真相源"的问题
- **否决理由**：与 OpenSpec 范式核心冲突，做了一半不如不做

### 5.2 直接替换 PRD/epics 为 specs/，不做 derived view

- **优点**：彻底干净
- **缺点**：破坏所有现有 wdf 项目；与 Phase 2.5 PRD、Phase 3.6 Epics 的 sub-phase 定义冲突；下游工具（epic→story slicer）需重写
- **否决理由**：迁移成本过高，且 PRD/epics 作为人类可读 summary 仍有价值

### 5.3 用 natural language scenario 而非 BDD

- **优点**：与现有 AC 格式一致，零迁移
- **缺点**：无法机读、无法自动生成测试、与 Cucumber/Behave 生态不兼容
- **否决理由**：失去 testing-agent 自动生成测试骨架的能力（CHG-005 contract-validator 的扩展依赖 BDD）

## 6. 风险分析

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| PRD → specs/ 反向抽取错位（结构差异大） | 中 | 高 | sync --reverse 提供 dry-run + diff 审查；首次抽取人工 review |
| Semantic merge 冲突（同名 Requirement） | 低 | 中 | spec validate 强制 Requirement name 在 domain 内 unique |
| BDD 迁移成本（现有 stories AC 自然语言） | 高 | 中 | 提供 `wdf spec migrate-ac` 辅助命令；不强制，archive 时做 |
| Brownfield 推导不准（OpenAPI 不完整） | 中 | 中 | 三种输入源（openapi/prisma/jsdoc）各自 fallback；init --existing 强制人工 review |
| v3.9.0 强制切换导致现有项目阻塞 | 中 | 高 | v3.8.x 长期支持（LTS）至 v3.10.0；WDF_LEGACY_DELTA 紧急绕过 |
| cascade regenerate 性能（大 spec 多产物） | 低 | 低 | 增量 regenerate（按 cascade anchor 哈希缓存） |

## 7. 审批记录

| 角色 | 姓名 | 日期 | 意见 |
|------|------|------|------|
| 架构师 | | | |
| 技术负责人 | | | |
| 产品负责人 | | | |

## 8. 实施后记录（实施后填写）

- 合并提交：`<git-hash>`
- 版本：`3.8.1 → 3.8.2 → 3.8.3 → 3.9.0`
- 生产验证：todo-app demo + 至少 1 个 brownfield 项目
- 遗留问题：...
