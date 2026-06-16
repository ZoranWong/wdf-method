# WDF Method Traceability Matrix

本文档追踪WDF Method中**需求 → 规范 → 实现 → 测试**的完整链路。

---

## 1. 宪法原则追踪 (CONSTITUTION → 实现)

| 宪法原则 | 规范条款 | 实现文件 | 测试覆盖 |
|----------|----------|----------|----------|
| 状态一致性原则 | 第2.1条 | sprint-status.ts, status-paths.ts | status-paths.test.ts (13 tests) |
| 门禁硬化原则 | 第2.2条 | gate-evaluator.ts, command-safety.ts | gate-evaluator.test.ts (14), command-safety.test.ts (91) |
| 原子性原则 | 第2.3条 | merge-queue.ts | merge-queue.test.ts (8 tests) |
| 可追溯性原则 | 第2.4条 | audit-logger.ts | audit-logger.test.ts (15 tests) |
| 安全沙箱原则 | 第2.5条 | agent-dispatcher.ts, scope-lock.ts | agent-dispatcher.test.ts (22), scope-lock.test.ts (41) |

---

## 2. 故事就绪门禁 (SRG) 追踪

| SRG ID | 规范描述 | 实现位置 | 测试用例 |
|--------|----------|----------|----------|
| SRG-01 | scope_write已定义 | story-ready-gate.ts: srg01ScopeDefined() | story-ready-gate.test.ts, story-runner.test.ts |
| SRG-02 | acceptance_check已定义 | story-ready-gate.ts: srg02AcceptanceChecks() | story-ready-gate.test.ts |
| SRG-03 | 故事文件存在 | story-ready-gate.ts: srg03StoryExists() | story-ready-gate.test.ts |
| SRG-04 | 路径安全检测 | story-ready-gate.ts: srg04PathSafety() | story-runner.test.ts: "SRG-04 path traversal" |
| SRG-05 | 无范围重叠 | story-ready-gate.ts: srg05NoScopeOverlap() | story-runner.test.ts |
| SRG-06 | 在实现边界内 | story-ready-gate.ts: srg06WithinBoundary() | story-ready-gate.test.ts |
| SRG-07 | 父目录存在 | story-ready-gate.ts: srg07ParentsExist() | story-ready-gate.test.ts |
| SRG-08 | 保护路径→串行 | story-ready-gate.ts: srg08ProtectedPaths() | story-runner.test.ts: "SRG-08 serial_only" |
| SRG-09 | 命令安全验证 | story-ready-gate.ts: srg09CommandSafety() | story-ready-gate.test.ts |

---

## 3. 合并队列安全追踪

| 规范条款 | 实现位置 | 测试覆盖 |
|----------|----------|----------|
| 原子合并三阶段协议 | merge-queue.ts: attemptAtomicMerge() | merge-queue.test.ts |
| 预检查 scope-lock | merge-queue.ts: runScopeLockPreMergeGate() | scope-lock.test.ts |
| git merge --no-commit | merge-queue.ts: attemptAtomicMerge() line 171 | (集成测试覆盖) |
| 集成检查执行 | merge-queue.ts: runAcceptanceChecks 调用 | acceptance-runner.test.ts (26 tests) |
| 失败abort机制 | merge-queue.ts: 多处spawnSync('git', ['merge', '--abort']) | merge-queue.test.ts |
| 依赖排序 | merge-queue.ts: reconcileDependencies() | merge-queue.test.ts |

---

## 4. Agent调度安全追踪

| 安全特性 | 实现位置 | 测试覆盖 |
|----------|----------|----------|
| assertSafeIdentifier | command-safety.ts | command-safety.test.ts |
| 命令白名单验证 | command-safety.ts: ALLOWED_PREFIXES | command-safety.test.ts, story-ready-gate.test.ts |
| 禁用子串检测 | command-safety.ts: FORBIDDEN_SUBSTRINGS | command-safety.test.ts |
| 工作树路径隔离 | agent-dispatcher.ts: worktreePath参数 | agent-dispatcher.test.ts |
| 超时kill机制 | agent-dispatcher.ts: setTimeout → child.kill() | agent-dispatcher.test.ts |
| JSON结果文件通信 | agent-dispatcher.ts: readResult() | agent-dispatcher.test.ts, agent/write-result.ts |

---

## 5. 状态备份与恢复追踪

| 功能 | 实现位置 | 测试覆盖 |
|------|----------|----------|
| 写入前自动备份 | status-backup.ts: backupFileBeforeWrite() | status-backup.test.ts (5 tests) |
| ISO时间戳命名 | status-backup.ts | status-backup.test.ts |
| 损坏状态重建 | (recovery CLI入口) | recovery.test.ts (5 tests) |
| 备份目录自动创建 | status-backup.ts: mkdirSync recursive | status-backup.test.ts |

---

## 6. 配置项追踪

| 配置项 | customize.toml位置 | 消费位置 |
|--------|---------------------|----------|
| status_dir | [workflow] | config.ts: resolveStatusDir() |
| output_dir | [workflow] | config.ts: resolveWorkflowPath() |
| enforcement_mode | [scope_lock] | merge-queue.ts, story-runner.ts |
| max_concurrent_stories | [auto_run.concurrency] | orchestrator.ts |
| story_agent_timeout_minutes | [auto_run.concurrency] | agent-dispatcher.ts |
| allowed_prefixes | [acceptance_check_safety] | command-safety.ts |
| forbidden_patterns | [acceptance_check_safety] | command-safety.ts |

---

## 7. 审计事件类型追踪

见 SPEC.md 第8章。所有事件类型均在 audit-logger.ts 中实现appendAudit()写入。

---

## 8. 未覆盖缺口

当前Traceability Matrix显示以下需改进项：

| 项 | 状态 | 建议 |
|----|------|------|
| 恢复命令完整实现 | 部分 | 需要完整CLI入口 |
| E2E真实项目跑通验证 | 缺失 | 需要一个完整TODO App示例 |
| 性能指标自动化 | 缺失 | 测试中加入性能断言 |

---

*本矩阵随每次代码变更同步更新。*