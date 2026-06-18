# CHG-2026-002: Spec Delta 与提案治理

```
Change ID: CHG-2026-002
Proposed: 2026-06-17
Author: AI Agent
Status: IMPLEMENTED
Priority: P0
Target: 3.7.0
Roadmap: docs/plans/2026-06-17-standardization-automation-roadmap.md#opt-01
```

## 1. 摘要

**问题**：当前 CR 仅自然语言描述，无法 diff/apply 到 SPEC.md / customize.toml / schemas/*。

**方案**：引入 `delta.yaml`（字段级 patch），新增 `wdf cr apply / archive` 命令，对标 OpenSpec 双目录治理。

**影响**：中。新增能力，向后兼容。

## 2. 背景

详见路线图 OPT-01。落后于 OpenSpec 的核心治理能力：
- 修改面不可机读 → 无法自动级联
- 无 archive 流转 → 提案历史散落

## 3. 规范差异

新增：
- `schemas/change-delta-schema.yaml`
- SPEC.md §（CR 章节）增加"delta 必填"规则
- customize.toml `[change_request]` 增加 `delta_required = true`

## 4. 实施计划

```
[x] Task 1: schemas/change-delta-schema.yaml（字段级 patch 语义）
[x] Task 2: orchestrator/src/orchestrator/cr-applier.ts
[x] Task 3: cr-applier.test.ts ≥ 15 用例（实际 35 通过）
[x] Task 4: commands/wdf-cr.md 增加 apply/archive
[x] Task 5: changes/.template/delta.yaml.example
[x] Task 6: docs/CR-DELTA-WORKFLOW.md
[x] Task 7: 把 CHG-001 反向补 delta.yaml 作为示例
```

## 5. 验收标准

- [x] 给定 delta.yaml，apply 后所有目标文件正确变更
- [x] dry-run 模式只输出 diff
- [x] 单测覆盖率 ≥ 90%（35 测试全过）
- [x] CHG-001 可作为 reference example

## 6. 依赖

无（本批 CHG 的根节点）

## 7. 风险

| 风险 | 缓解 |
|---|---|
| YAML patch 语义边界不清 | 借鉴 RFC 6902 (json-patch) |
| 错误 apply 损坏 SPEC.md | dry-run 默认 + 自动 git stash |
