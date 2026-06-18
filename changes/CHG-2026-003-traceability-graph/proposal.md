# CHG-2026-003: Traceability Graph + CR 影响自动分析

```
Change ID: CHG-2026-003
Proposed: 2026-06-17
Author: AI Agent
Status: IMPLEMENTED
Priority: P0
Target: 3.7.0
Roadmap: docs/plans/2026-06-17-standardization-automation-roadmap.md#opt-02
```

## 1. 摘要

**问题**：修改 PRD-REQ-7 → 不知道哪些 stories / endpoints / 测试受影响。MILESTONE-P0-COMPLETE.md 自承未做。

**方案**：构建 traceability graph（JTBD/REQ/EPIC/STORY/API/DB/TEST/COMMIT 节点+边），CR 触发时反查级联，自动 UNLOCK_RESOLVE。同时为 OPT-09 `wdf trace` 命令打基础。

**影响**：中。新增能力。

## 2. 背景

详见路线图 OPT-02。

## 3. 规范差异

新增：
- `_wdf_output/traceability.graph.json`（自动产物，gitignore）
- stories frontmatter 强制 `refs:` 字段（linter 校验）
- `wdf cr create` 默认开启 `--analyze`

## 4. 实施计划

```
[x] Task 1: traceability-graph.ts（构建 + 增量更新 + 8 种节点 + 5 种边）
[x] Task 2: 解析器：stories/openapi/db-schema/jtbd/test 标记
[x] Task 3: cr-impact-analyzer.ts（anchor→seed→BFS 反查 + UNLOCK 调度）
[x] Task 4: 与 fsm-engine 联动，planUnlockTransitions 批量校验
[x] Task 5: 单测：23 测试，30 节点 fixture，准确率 100%，构建 < 2s
[x] Task 6: docs/TRACEABILITY-GRAPH.md
[x] Task 7: linter 规则：STORY_REFS_REQUIRED（缺失 refs: → error）
```

## 5. 验收标准

- [x] 修改 SPEC.md 某段 → CR 报告自动列出受影响节点（锚 → BFS 下游）
- [x] graph 构建 < 2s（23 测试均通过时间阀值）
- [x] 30 节点 fixture graph 节点 ≥ 30，反查准确率 100%（REQ-3 → STORY-003 + 2 TEST）
- [x] CR 标 blocking 时受影响节点自动 UNLOCK_RESOLVE（planUnlockTransitions）

## 6. 依赖

- **CHG-2026-002**（delta 提供修改面）

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 自然语言引用解析错误 | 强制 `refs:` 显式字段 + linter |
| graph 构建性能 | 增量更新 + 缓存 |
