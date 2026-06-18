# CHG-2026-005: Contract Validator（AC ↔ 测试强绑定）

```
Change ID: CHG-2026-005
Proposed: 2026-06-17
Author: AI Agent
Status: IMPLEMENTED
Priority: P0
Target: 3.7.0
Roadmap: docs/plans/2026-06-17-standardization-automation-roadmap.md#opt-04
```

## 1. 摘要

**问题**：当前只挡危险命令；不验证测试是否真覆盖 acceptance_criteria。Story 可能跑过 `npm test`（0 个相关用例）就 PASS。

**方案**：充实 `contract-validator.ts`，强绑定 AC ↔ test 用例 ID，结合 vitest/jest JSON reporter 校验最近运行 PASS。

**影响**：中。提升 acceptance gate 严格度，可能影响既有项目（提供宽松模式过渡）。

## 2. 背景

详见路线图 OPT-04。是 MILESTONE-P0-COMPLETE.md 自承的 P1 #4。

## 3. 规范差异

新增：
- stories frontmatter `acceptance_criteria: [AC-1, AC-2, ...]` 必填
- 测试用例命名约定：`it("AC-1: ...")` 或 `// @ac AC-1` 注解
- customize.toml `[acceptance_gates] contract_strict_mode = true`（默认 false → 3.8.0 改为 true）

## 4. 实施计划

```
[x] Task 1: contract-validator.ts 完整实现（行扫描 + AC 解析）
[x] Task 2: 对接 vitest JSON reporter
[x] Task 3: 对接 jest JSON reporter（向后兼容，共用 reporter shape）
[x] Task 4: 集成到 acceptance-runner（runAcBindingCheck 高层入口）
[x] Task 5: assets/templates/testing/test-ac-binding.example.ts
[x] Task 6: docs/AC-TEST-BINDING.md
[x] Task 7: codemod：扫描既有项目并提示加 AC 注解（auditAcCoverage）
```

## 5. 验收标准

- [x] 5 条 AC，4 条有绑定，1 条无 → 报告精确（test: validateAcBindings 提案 §5 场景）
- [x] 用例错拼 / fail / skip → 各自明确诊断（unbound_acs / failing_acs / skipped_acs / unknown_bindings）
- [x] 与 OPT-03 todo-app 联动（runAcBindingCheck 端到端可用，待 CHG-004 demo 接入）

## 6. 依赖

无

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 既有项目无 AC 绑定 | strict_mode 默认 false，提供 codemod |
| 测试框架差异 | 优先 vitest，jest 作为 secondary |
