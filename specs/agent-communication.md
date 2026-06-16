# Agent Communication Protocol — 跨 Worktree 双向通信

**Version:** 1.0.0
**Applies to:** Phase 4 (Implementation) — All story agents
**Principle:** `_wdf_output/signals/` 不在任何 git 仓库内，所有 worktree 共享同一路径

---

## 为什么不用 worktree 内的文件

```
主 worktree (main 分支)               子 worktree (story/S-3.2-be 分支)
_wdf_output/status/                  _wdf_output/status/
        ↓                                     ↓
   同一个逻辑路径                             同一个逻辑路径
   但实际上：git worktree 的文件系统是隔离的
   
主 worktree 写入 status/signals/ → 子 worktree 看不到（不同分支）
子 worktree 写入 status/signals/ → 主 worktree 看不到（未 merge）
```

## 正确方案：独立于 git 的共享目录

```
_wdf_output/signals/              ← 不在任何 git worktree 内
├── global.json                         ← 全局信号
├── main-to-{agentId}.json              ← 主 agent → 子 agent 指令
├── {agentId}-to-main.json              ← 子 agent → 主 agent 状态
└── agents/                             ← 每 agent 子目录
    └── {agentId}/
        ├── heartbeat.txt               ← 最后心跳时间戳
        └── checkpoint.json             ← 最后完成的 checkpoint 信息
```

所有 worktree（main、story/*）都能读写 `_wdf_output/signals/`。零同步延迟。

---

## 信号协议

### 主 → 子 (main-to-{agentId}.json)

```json
{
  "type": "none" | "pause" | "abort",
  "issued_at": "2026-05-22T10:30:00Z",
  "reason": "用户请求暂停",
  "ttl_seconds": 300
}
```

子 agent 在每个子步骤（4a→4b→4c→...）开始前读取。指令执行后不清除——保留最后指令用于诊断。

### 子 → 主 ({agentId}-to-main.json)

```json
{
  "agent_id": "a9f25bd0e65b77e34",
  "story_id": "S-3.2",
  "track": "backend",
  "current_substep": "4c",
  "batch": "B2",
  "heartbeat_at": "2026-05-22T10:31:00Z",
  "files_changed": 3,
  "tests_pass": 8,
  "tests_fail": 0,
  "last_checkpoint_commit": "abc123d"
}
```

子 agent 在每个子步骤完成后写入。主 agent 可随时读取以了解所有运行中 agent 的实时状态。

### 全局信号 (global.json)

```json
{
  "action": "none" | "pause_all" | "abort_all",
  "issued_at": "2026-05-22T10:30:00Z",
  "active_agents": ["a9f25bd0", "b3e8c71f"],
  "paused_agents": [],
  "aborted_agents": []
}
```

---

## 子 Agent 轮询协议

```
每个子步骤开始前 (BEFORE 4a→4b→4c→4d→4e→4f→4f2→4g→4h→4j):

  1. 读 _wdf_output/signals/main-to-{agentId}.json
  2. 读 _wdf_output/signals/global.json
  
  3. IF global.action == "abort_all" OR command.type == "abort":
       回滚当前未提交变更
       写 {agentId}-to-main.json: {"status": "aborted"}
       返回 { status: "ABORTED", agentId }

  4. IF global.action == "pause_all" OR command.type == "pause":
       完成当前子步骤（不开始新的）
       checkpoint commit
       写 {agentId}-to-main.json: {"status": "paused", "last_substep": "{current}"}
       返回 { status: "PAUSED", agentId, last_completed_substep }

  5. IF command.type == "none":
       正常开始下一个子步骤

每个子步骤完成后 (AFTER 4a→4b→4c→4d→4e→4f→4f2→4g→4h):

  1. 写 heartbeat.txt: {ISO_TIMESTAMP}
  2. 写 {agentId}-to-main.json: 更新 current_substep + heartbeat_at
  3. checkpoint commit（如有代码变更）
  
特殊规则:
  - 子步骤 4g (acceptance_check) 和 4h (CA-01~05):
    暂停检查挂起——已经太接近完成，运行到 CODE_ACCEPTED 后返回
    不响应 pause 指令（最多延迟 ~5 分钟）
```

---

## 主 Agent 信号操作

### 暂停所有

```
/web-dev-flow pause →
  1. 写 global.json: {"action": "pause_all"}
  2. FOR each running agent:
       写 main-to-{agentId}.json: {"type": "pause"}
  3. WAIT for all agents to return PAUSED (or timeout 5min)
  4. 更新 status/global.yaml: overall_status = "paused"
  5. 显示暂停仪表盘
```

### 恢复

```
/web-dev-flow resume →
  1. 读 global.json → 清除 action
  2. FOR each PAUSED agent:
       清除 main-to-{agentId}.json（写入 {"type": "none"}）
       读 {agentId}-to-main.json → 获取 last_completed_substep
       SendMessage({to: agentId, message: "resume from {next_substep}"})
  3. 更新 status/global.yaml: overall_status = "implementation"
```

### 中止单个 story

```
/web-dev-flow abort S-3.2 →
  1. 写 main-to-{agentId}.json: {"type": "abort"}
  2. 等待 agent 返回 ABORTED
  3. 清理 worktree + branch
  4. 标记 story FAILED
```

---

## 崩溃恢复

如果主 agent 崩溃，`_wdf_output/signals/` 中保留了最后的状态：

```
恢复流程:
  1. 读 global.json → 找到 active_agents 列表
  2. FOR each agentId:
       读 {agentId}-to-main.json → 获取 last_completed_substep
       读 heartbeat.txt → 判断是否存活（心跳 < 5min 前 = 仍在运行）
  3. 对于仍在运行的 agent:
       SendMessage({to: agentId, message: "主 agent 崩溃恢复，请报告当前状态"})
       agent 返回当前 checkpoint
  4. 对于已停机的 agent:
       从 last_checkpoint_commit 恢复 → 重新分派
  5. 重建 sprint-status 从 status/ 文件
  6. 继续执行
```

---

## 配置

```toml
# customize.toml
[agent_communication]
enabled = true
signal_dir = "_wdf_output/signals"
heartbeat_interval_seconds = 30          # 子 agent 心跳频率
pause_timeout_seconds = 300              # 等待 agent 暂停的最大时间
heartbeat_timeout_seconds = 120          # 判定 agent 宕机的心跳超时
cleanup_on_complete = true               # agent 完成后清理信号文件
```
