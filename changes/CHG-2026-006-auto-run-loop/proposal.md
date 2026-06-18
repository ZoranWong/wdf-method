# CHG-2026-006: Auto-Run 顶层主循环

```
Change ID: CHG-2026-006
Proposed: 2026-06-17
Author: AI Agent
Status: IMPLEMENTED
Priority: P1
Target: 3.8.0
Roadmap: docs/plans/2026-06-17-standardization-automation-roadmap.md#opt-05
```

## 1. 摘要

**问题**：SKILL.md 声明 hands-free Phase 1→4，实际 `runAutoLoop()` 主调度器缺失。零件齐全，缺主控。

**方案**：在 `orchestrator.ts` 实现 `runAutoLoop()`，串起 entry-gate → execute → exit-gate → next-phase。预计 200-400 行。

**影响**：中。新增能力，向后兼容。

## 2. 背景

详见路线图 OPT-05。这是 OPT-03 自托管 E2E 的前置条件。

## 3. 规范差异

无新规范，仅落实已有 [auto_run] 配置。

## 4. 实施计划

```
[x] Task 1: orchestrator.ts 增加 runAutoLoop(opts)（~120 行）
[x] Task 2: 终止条件：fail-closed gate / max_iter / SIGINT / pause
[x] Task 3: commands/wdf-build.md 直连主循环
[x] Task 4: SIGINT 安全停止 + resume 续跑（通过 SignalManager 轮询）
[x] Task 5: 单测覆盖：complete / gate-fail / max-iter / bounds / detect
[x] Task 6: docs/AUTO-RUN.md
```

## 5. 验收标准

- [x] 干净环境一句话指令跑通 Phase 1→3（单测: 3/3 locked）
- [x] SIGINT 安全停止 + `wdf resume` 续跑（SIGINT handler + detectCurrentPhase）
- [x] gate fail 时不前进、不污染状态（halt_on_gate_failure 测试）
- [x] 与现有 step-audit / scope-lock 兼容（auto-run 无额外审计开销,
      scope-lock 在 story dispatch 层生效）

## 6. 依赖

无（但与 CHG-2026-004 联合验证）

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 长链路 LLM 漂移 | 复用现有 step-audit / scope-lock 兜底 |
| 死循环 | max_iter 强制 + 启动告警 |
