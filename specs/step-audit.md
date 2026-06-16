# Step Audit Protocol — 统一步骤跟踪规范

**Version:** 2.0.0 (optimized)
**Applies to:** All Phase 4 sub-workflows
**Storage:** Embedded in `sprint-status.yaml` — no separate log file

## Purpose

记录每个故事的实现步骤，支持会话中断后精确恢复。v2.0 相比 v1.0 的核心变化：

| 维度 | v1.0 | v2.0 |
|------|------|------|
| 存储位置 | 独立 `step-audit-log.yaml` | 嵌入 `sprint-status.yaml` 的 `step_history` |
| 写入频率 | 每个子步骤（~10次/故事） | 故事开始 + 故事完成（2次/故事） |
| 字段数 | 10+ | 5 |
| 双写风险 | sprint-status + step-audit-log 两份 | 只有 sprint-status 一份 |
| 适用条件 | 所有项目 | 按复杂度分层 |

## 核心设计：单写、低频、嵌入

### 原则 1：sprint-status.yaml 是唯一真相源

不再维护独立的 `step-audit-log.yaml`。步骤跟踪信息直接嵌入 `sprint-status.yaml` 每个 story 对象中，同时也写入 per-story 状态文件 `_wdf_output/stories/{story_id}-status.yaml` 中。故事 agent 只写 per-story 文件；main orchestrator 在 merge 时将 per-story 状态聚合到 sprint-status.yaml。

### 原则 2：只记录关键状态转换

不是每个子步骤都写记录。只在两个关键时刻写入：
- **故事开始** (NOT_STARTED → IN_PROGRESS)：记录 started_at + last_completed_substep = null
- **故事完成** (→ CODE_ACCEPTED)：记录 completed_at + last_completed_substep = 最终子步骤

### 原则 3：last_completed_substep 足够恢复

会话恢复时，读取 `last_completed_substep`（如 "4f2"）即可知道从哪里继续。不需要完整的 sub-step 审计链。

---

## Schema：嵌入 sprint-status.yaml

在 `phases.phase_4.phase_4_N.stories[*]` 中增加 `step_history`：

```yaml
# sprint-status.yaml — story 对象内
- id: "S-3.2"
  status: "CODE_ACCEPTED"
  started_at: "2026-05-19T13:00:00Z"
  completed_at: "2026-05-19T13:45:00Z"
  last_completed_substep: "4j"          # ← 恢复用：最后完成的子步骤 ID

  # step_history — 仅关键转换（v2.0 精简版）
  step_history:                         # 可选，复杂项目启用
    - step: "started"
      at: "2026-05-19T13:00:00Z"
      substep: null
    - step: "completed"
      at: "2026-05-19T13:45:00Z"
      substep: "4j"
      summary: "Auth Endpoints — 3 API routes, 12 tests pass, scope clean"
```

**step_history 条目格式（5 字段）**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `step` | string | `"started"` 或 `"completed"` |
| `at` | ISO timestamp | 记录时间 |
| `substep` | string or null | 对应的子步骤 ID（如 "4f2"），started 时为 null |
| `summary` | string or null | completed 时必填，1-2 句话描述完成内容 |
| `status` | string or null | completed 时必填：`"PASS"` / `"FAIL"` / `"WARNING"` |

---

## 恢复机制

会话重新启动时，Agent 读取 `sprint-status.yaml` 中当前故事的状态：

```
1. 找到 status=IN_PROGRESS 的故事 → 中断的故事
2. 读取 last_completed_substep → 最后完成的子步骤（如 "4f2"）
3. 从子步骤映射表找到下一个子步骤 → 恢复点
4. 如果 last_completed_substep 为 null → 故事刚开始，从 4a 恢复
5. 如果 last_completed_substep = 最后一个子步骤 → 故事已完成，待标记
```

**不再需要**：
- 读取独立的 step-audit-log.yaml
- 交叉验证两份文件的一致性
- 解析可能损坏的 YAML 追加日志

---

## 子步骤 ID 映射（保留，用于恢复定位）

### Phase 4.4 (BE API Endpoints)

| 子步骤 | Step ID | 说明 |
|-------|---------|------|
| 4a: Story Ready Gate | 4a | SRG 检查 |
| 4b: Read Story + Mark IN_PROGRESS | 4b | 故事开始 |
| 4c: Implement | 4c | 代码实现 |
| 4d: Write Tests | 4d | 测试 |
| 4e: Spec Validation | 4e | 规范验证 |
| 4f: Generate Handoff | 4f | 产出文档 |
| 4f2: Scope Exit Verification | 4f2 | 范围检查 |
| 4g: Acceptance Checks | 4g | 验收命令 |
| 4h: CODE ACCEPTANCE | 4h | CA-01~CA-05 |
| 4j: Mark CODE_ACCEPTED | 4j | 状态更新 |

### Phase 4.10 (FE Page Implementation)

| 子步骤 | Step ID | 说明 |
|-------|---------|------|
| 4a: Story Ready Gate | 4a | SRG 检查 |
| 4b: Read Story + Mark IN_PROGRESS | 4b | 故事开始 |
| 4c: Implement Page | 4c | 页面实现 |
| 4d: A11y Audit | 4d | 无障碍检查 |
| 4e: Component Tests | 4e | 组件测试 |
| 4f: Integration Tests | 4f | 集成测试 |
| 4g: Update Dev Log | 4g | 开发日志 |
| 4h: Generate Handoff | 4h | 产出文档 |
| 4h2: Scope Exit Verification | 4h2 | 范围检查 |
| 4i: Acceptance Checks | 4i | 验收命令 |
| 4j: CODE ACCEPTANCE | 4j | CA 检查 |
| 4k: Mark CODE_ACCEPTED | 4k | 状态更新 |

---

## 复杂度分层

| 项目规模 | step_history | last_completed_substep | 说明 |
|---------|-------------|----------------------|------|
| 简单（<10 stories） | 不需要 | 需要 | last_completed_substep 足够恢复 |
| 中等（10-20 stories） | 可选 | 需要 | step_history 提供审计追溯 |
| 复杂（>20 stories） | 建议启用 | 需要 | 完整审计链 |

配置方式：`customize.toml`

```toml
[step_audit]
enabled = true              # 是否启用 step_history 记录
detail_level = "minimal"    # "minimal" (仅 started/completed) | "full" (每子步骤，v1 兼容)
```

`detail_level = "full"` 模式恢复 v1 行为（每子步骤写一条记录），仅用于对审计有严格要求的项目。

---

## Console Output 格式

简化版，仅在故事开始和完成时输出：

```
── STORY START ── S-3.2: Auth Endpoints ──
  scope_write: ["src/modules/auth/", "src/middleware/auth.ts"]
  substep: 4b → 4c

...实现过程...

── STORY COMPLETE ── S-3.2: Auth Endpoints ──
  status: PASS
  substep: 4j (CODE_ACCEPTED)
  summary: 3 API routes, 12 tests pass, scope clean
```

---

## 各文档定位（v2.0 简化版）

| 文档 | 作用 | 写入时机 | 恢复用途 |
|------|------|---------|---------|
| `sprint-status.yaml` | 唯一真相源：FSM 状态 + 步骤跟踪（聚合后） | Main orchestrator 在 merge 时原子写入 | 确定恢复点 |
| `_wdf_output/stories/{story_id}-status.yaml` | Per-story 状态（agent 写入） | Agent 在 worktree 中开发时 | 按 story 的详细状态 |
| `self-check.md` | 故事自检报告 | 每个故事完成后 | 测试/检查结果回溯 |
| `handoff.md` | 故事交接文档 | 每个故事完成后 | 了解实现细节 |
