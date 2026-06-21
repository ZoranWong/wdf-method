# CHG-2026-017: Semantic Delta v2 Demo

```
Change ID: CHG-2026-017
Proposed: 2026-06-21
Author: AI Agent
Status: PROPOSED
Priority: P1
Target: 3.9.1
Roadmap: R3 (specs as source of truth)
Related:
  - CHG-2026-015 (parent CR — specs/ source of truth, S2 = this demo's substrate)
  - CHG-2026-002 (v1 mechanical delta — superseded but not yet deprecated)
References:
  - schemas/change-delta-schema.yaml (schema_version: 2 grammar)
  - schemas/spec-schema.yaml (BDD requirement + scenario shape)
```

## 1. 摘要

**问题**：CHG-2026-015 S1 已引入 `_wdf_output/specs/<domain>/spec.md` 作为真相源，但 S1 的提交（`d7702f5`）未附带任何 v2 delta 示例。S2 代码已落地（`planApplyV2`、`maybeCascadeSpecsSync`），但缺少一个端到端的 reference delta 作为：(a) 测试目标、(b) 文档示例、(c) 未来 `wdf cr migrate` 转换产物的样板。

**方案**：新建 CHG-2026-017 demo delta，最小化展示 v2 语义（一个 `ADDED` op，向 `auth` domain 注入 `Password Reset` requirement，3 个 BDD scenarios）。该 delta 不实际修改 production spec —— 仅作为 v2 grammar 的活体校验样本，可在 `wdf cr apply CHG-2026-017 --dry-run` 时观察 diff。

**影响**：小。新增 1 个 PROPOSED CR，不动现有代码与 spec。

## 2. 与 CHG-2026-015 的关系

CHG-015 是 R3 paradigm upgrade 的伞型 CR，分 6 个 slice（S1-S6）。CHG-017 不是 CHG-015 的替代，而是 S2 的**可执行示例**：

| 维度 | CHG-015 S2 | CHG-017 |
|---|---|---|
| 角色 | 实现 v2 grammar（types、planner、cascade） | 提供 v2 delta 的 reference 实例 |
| 代码改动 | cr-applier.ts、spec-sync.ts、change-delta-schema.yaml | 零代码，仅 delta.yaml |
| 历史 delta | CHG-015 自身的 delta 是 v1（"uses v1 because v2 doesn't exist yet" — 历史准确） | 不破坏 CHG-015 的历史 v1 delta |
| 测试 | cr-applier.test.ts 内 11 个新 v2 cases | 端到端 smoke target（apply/archive/cascade） |

为什么不直接给 CHG-015 自己写 v2 delta？因为 CHG-015 的 delta 历史记录是"在 S2 落地前用 v1 写的" —— 改写它会破坏审计追溯。CHG-017 以新 CR 的身份承载 v2 reference，使 CHG-015 的历史保持完整。

## 3. delta.yaml 解读

```yaml
schema_version: 2          # 触发 planApplyV2 路由
operations:
  - op: ADDED              # 三个语义之一：ADDED | MODIFIED | REMOVED
    domain: auth           # 目标文件：_wdf_output/specs/auth/spec.md
    requirement:
      id: REQ-014          # 跨 spec 稳定 ID（用于 traceability）
      name: Password Reset # 必须匹配 ^[A-Z][A-Za-z0-9 _-]{2,80}$
      priority: P1         # MoSCoW（可选）
      scenarios:           # 至少 1 个 BDD scenario
        - given: [...]
          when: [...]
          then: [...]      # 必须含 RFC 2119 关键字
```

**校验保证**（由 `validateV2Operation` + `validateSpec` 强制）：

- domain 形如 `^[a-z][a-z0-9-]{1,30}$`
- ADDED 的 requirement 有非空 name + 非空 scenarios
- 每个 scenario 的 given/when/then 均非空
- 每个 scenario 的 then 含 RFC 2119 关键字（MUST/SHALL/WILL/SHOULD/EXPECTED）
- 不允许 placeholder（TODO/FIXME/XXX/...）
- ADDED 的 id 不能与 domain 内现有 id 重复

**Archive 时行为**：

- `source_of_truth=false`（默认）：只更新 `specs/auth/spec.md`，PRD 不动；cascade 返回 warning
- `source_of_truth=true`：同时通过 `forwardSync` 重写 PRD 的 `## 2. Functional Requirements` 段

## 4. 端到端验收（参考 S2 verification block）

```bash
# Apply 到示例项目（用 examples/spec-sync-demo/）
./bin/wdf cr apply CHG-2026-017 --dry-run --diff
./bin/wdf cr apply CHG-2026-017

# 查看 spec
cat _wdf_output/specs/auth/spec.md  # REQ-014 已按 id 排序插入

# Archive（默认 source_of_truth=false → 仅写 spec + 返回 warning）
./bin/wdf cr archive CHG-2026-017

# 翻 flag 后 archive（spec + PRD cascade）
# (编辑 customize.toml: [specs] source_of_truth = true)
./bin/wdf cr archive CHG-2026-017   # 注意：示例 CR 不应被真 archive
grep "Password Reset" _wdf_output/prd.md
```

## 5. 实施记录

- delta 文件：`changes/CHG-2026-017-semantic-delta-demo/delta.yaml`
- INDEX 登记：`changes/INDEX.md` → R3 / P1 / PROPOSED
- 测试覆盖：`orchestrator/src/orchestrator/cr-applier.test.ts` 中的 `v2 planApplyV2 ADDED`、`v2 archiveAndRewrite interop` 等用例

## 6. 后续

- S3：扩展到 api-spec/db-schema 的 cascade regenerate
- S6：`wdf cr migrate` 命令将本 delta 形态作为转换目标
