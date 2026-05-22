# Agent Isolation Protocol — 每个 Story 一个独立 Agent + 干净上下文

**Version:** 1.0.0
**Applies to:** Phase 4 (Implementation) — all tracks
**Motivation:** 多个 AI agent 在同一个代码库上并行工作时，如果不做上下文隔离，会产生：
  1. 上下文污染 — agent A 的实现细节泄漏到 agent B 的上下文，导致混乱
  2. 上下文膨胀 — 叠加所有 story 的上下文后窗口溢出
  3. 恢复复杂 — 一个 agent 崩溃时无法精确定位到单个 story
  4. 状态不明确 — "当前在开发哪个 story" 需要从历史推断

## 核心原则：One Story = One Agent = One Worktree = One Clean Context

### 并行执行模型

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Orchestrator                        │
│  (只管理状态、调度 sub-agent、处理 merge，不写代码)               │
│  (不保留任何 sub-agent 的上下文 — Context Firewall)              │
│                                                                 │
│   Parallel Batch (同时运行，互不感知):                            │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│   │Agent S3.1│  │Agent S1.1│  │Agent S4.1│  ← 3 个并行        │
│   │BE track  │  │FE track  │  │BE track  │                     │
│   │worktree A│  │worktree B│  │worktree C│                     │
│   │          │  │          │  │          │                     │
│   │~38KB ctx│  │~38KB ctx│  │~38KB ctx│  ← 干净上下文        │
│   │scope: BE │  │scope: FE │  │scope: BE │                     │
│   │不重叠    │  │不重叠    │  │不重叠    │  ← 文件级隔离        │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘                     │
│        │              │              │                           │
│   返回 {id, status}  返回 {id, status}  返回 {id, status}        │
│        ↓              ↓              ↓                           │
│   Orchestrator 顺序处理结果 (merge 是串行的):                     │
│   merge S3.1 → merge S1.1 → merge S4.1                          │
│                                                                 │
│  Serial Queue (一次一个):                                        │
│   ┌──────────┐                                                   │
│   │Agent S5.1│  ← serial_only (protected_path 相交)              │
│   │worktree D│     S6.1 排队等待 S5.1 完成                        │
│   └──────────┘                                                   │
│                                                                 │
│  sprint-status.yaml (唯一共享状态，Orchestrator 原子写入)         │
└─────────────────────────────────────────────────────────────────┘
```

### 并行安全保证

| 隔离层 | 机制 | 保证 |
|--------|------|------|
| **文件系统** | 每个 sub-agent 独立 worktree + 分支 | 零文件写入冲突 |
| **上下文** | 每个 sub-agent 干净 prompt (~38KB) + Context Firewall | 零上下文污染 |
| **Scope** | scope_write 重叠检查 + SRG-05 | 零 scope 冲突 |
| **Protected paths** | serial_only 标记 + 串行队列 | 零 shared infra 冲突 |
| **状态** | Per-story status 文件 + Orchestrator 单写 sprint-status | 零状态写入冲突 |
| **Merge** | Orchestrator 串行 merge（一次一个） | 零 merge 冲突 |

### 并行度控制

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `max_concurrent_stories` | 5 | 同时 dispatch 的最大 sub-agent 数 |
| `story_agent_timeout_minutes` | 30 | 单个 story 超时时间 |
| `dependency_wait_timeout_minutes` | 15 | 依赖等待超时时间 |

### 并行执行的实际模型

**重要：** 单会话内的并行是"逻辑并行"，非真正的多进程并行。

- **逻辑并行**：Orchestrator 在一个调度周期内 dispatch 多个 sub-agent。每个 sub-agent 在返回前独占会话，但它们的 worktree 是独立的。文件系统级别的隔离是真实的——两个 sub-agent 绝不会同时写同一文件。
- **真正的并行需要多会话**：对于需要真实并行的场景（如 5 个 story 同时在 5 个独立 Claude 会话中运行），需要外部编排基础设施（如 CI/CD pipeline、任务队列）。当前工作流设计兼容此模式——每个 sub-agent 的 prompt 模板是自包含的，可直接用于独立会话。
- **单会话的实用价值**：对于 3-5 个独立 story 的项目，逻辑并行在单会话中完全可行。每个 sub-agent 返回后释放上下文，下一个 sub-agent 以干净上下文启动。这比"一个 agent 处理所有 story"的串行模型快得多。

### Protected Paths 覆盖度说明

12 类 protected_path 是**保守默认值**。实际项目中应根据代码库结构调整：

```toml
# 建议：只保护真正的共享基础设施
protected_paths = [
    "shared/types",       # 类型定义（BE+FE 共享）
    "schema/migration",   # 数据库迁移（必须串行）
    "root/config",        # 项目配置
]
# 对于大多数项目，下列路径通常可以移除：
# "shared/contract", "api/contract", "route/entry",
# "permission/model", "build/ci", "env/template",
# "shared/ui/shell", "route/registry", "global/design/tokens"
```

如果大多数 story 都变成了 serial_only，说明 protected_paths 配置过宽——调整到只保护真正的共享热点。

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Orchestrator                        │
│  (主流程控制，不写代码)                                           │
│                                                                 │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │ Agent S1 │  │ Agent S2 │  │ Agent S3 │  │ Agent S4 │  ... │
│   │ story/   │  │ story/   │  │ story/   │  │ story/   │      │
│   │ S-3.1-be │  │ S-4.1-be │  │ S-1.1-fe │  │ S-2.1-fe │      │
│   │          │  │          │  │          │  │          │      │
│   │ 上下文:   │  │ 上下文:   │  │ 上下文:   │  │ 上下文:   │      │
│   │ story文件 │  │ story文件 │  │ story文件 │  │ story文件 │      │
│   │ api-spec │  │ api-spec │  │ api-spec │  │ api-spec │      │
│   │ db-schema│  │ db-schema│  │ wireframes│ │ wireframes│      │
│   │ arch doc │  │ arch doc │  │ design-tok│ │ design-tok│      │
│   │ scope_wr │  │ scope_wr │  │ scope_wr │  │ scope_wr │      │
│   │          │  │          │  │          │  │          │      │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│        │              │              │              │           │
│   ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐      │
│   │Worktree  │  │Worktree  │  │Worktree  │  │Worktree  │      │
│   │S-3.1-be  │  │S-4.1-be  │  │S-1.1-fe  │  │S-2.1-fe  │      │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                 │
│  sprint-status.yaml (唯一共享状态，merge 时原子写入)              │
└─────────────────────────────────────────────────────────────────┘
```

## Agent 的干净上下文

每个 story agent 启动时只加载以下 **最小必要上下文**：

### 必须加载（6 个文件）

| 文件 | 大小 | 用途 |
|------|------|------|
| 当前 story 文件 | ~3KB | 要实现的 story 定义、任务列表、scope_write、acceptance_checks |
| api-spec.yaml | ~15KB | API 契约（我该输出什么） |
| architecture.md | ~10KB | 架构约束（我该遵循什么模式） |
| design-tokens.md | ~3KB | 设计变量（前端 story 必需） |
| db-schema.md | ~5KB | 数据库结构（后端 story 必需） |
| Code standards 文件 | ~2KB | 编码规范（AGENTS.md 或 eslint config） |

**总计: ~38KB** — 在一个 1M context window 里几乎不占空间。

### 禁止加载（上下文防火墙）

- ❌ **其他 story 文件** — 不需要知道别的 story 怎么实现的
- ❌ **其他 story 的状态文件** — 只需要自己当前 story 的状态
- ❌ **其他 story 的 worktree 相关内容**
- ❌ **sprint-status.yaml 的整体状态** — 只需要自己 story 的状态条目
- ❌ **Phase 1-3 的分析文档** — 不是实施阶段需要的
- ❌ **本会话中其他 story 的讨论或代码** — 上下文防火墙：只关注当前 story

### 可读但只读

- sprint-status.yaml 中自己 story 的依赖项状态（只读，检查 deps 是否满足）
- 依赖 story 的 scope_write（只读，确保自己的实现与上游兼容）

## Agent 生命周期

```
Agent 生命周期（Per Story — Independent Sub-Agent）:

1. CREATE

0. CONTEXT FIREWALL — 主 Orchestrator 不保留子 Agent 上下文
   ├→ 主 orchestrator 只跟踪 story 状态（CODE_ACCEPTED / BLOCKED / etc.）
   ├→ 子 agent 的所有实现细节、代码、对话上下文对主 agent 不可见
   ├→ 子 agent 返回后，主 agent 只读取 per-story status 文件获取结果
   └→ 这确保主 agent 上下文窗口不会因 story 实现细节而膨胀
   main orchestrator 创建 worktree + 分支
   └→ 读取 story 文件 + 所有依赖文档
   └→ 计算干净上下文（最小必要文件集合）
   └→ 生成启动提示词给 agent:
        "你在实现 Story {id}: {title}。
         你的 scope_write: [...]
         你的 acceptance_check: [...]
         你的依赖: [...] (all MERGED ✓)
         你需要读取的文件: [...]

          实现步骤 (按顺序执行):
           4a: Story Ready Gate 检查 (SRG-01~SRG-09)
           4b: 读取 story 文件，标记 IN_PROGRESS，写入 started_at
           4b2: [API stories only] Contract Gate — 逐字段验证 api-spec 对齐
           4c: 实现代码 (Validator → Service → Controller → Route)
           4d: 编写并运行测试 (unit + integration)
           4e: 验证与 api-spec 一致 (请求/响应/状态码/错误格式)
           4f: 生成 self-check.md + handoff.md
           4f1: Handoff Minimum Gate (检查文档非空、非占位符)
           4f2: Scope Exit Verification (git diff vs scope_write, 目录边界匹配)
           4g: 运行 acceptance_check (所有命令 exit 0)
           4h: CODE ACCEPTANCE 检查:
               CA-01: 代码审查 (/bmad-code-review adversarial)
               CA-02: 测试覆盖率 >= 80%
               CA-03: 类型检查通过
               CA-04: Lint 通过
               CA-05: Scope 审计 (git diff + 目录边界匹配, 0 violations)
           4i2: Checkpoint commit — CODE_ACCEPTED
           4j: 写入 per-story status → 返回 { story_id, status: "CODE_ACCEPTED" }
         
         需要遵守的代码标准: {code_standards_source}

2. WORK
   Agent 在隔离的 worktree 中工作:
   ├→ 读取 story 文件 + 上文列出的最小上下文
   ├→ 按步骤实现
   ├→ 每个关键步骤做 git commit（规范: 至少 3 次 commit，见 git-commit-checkpoints.md）
   └→ 完成后写入 per-story status 文件:
        路径: _bmad-output/web-dev-flow/stories/{story_id}-status.yaml
        内容: { story_id, status: "CODE_ACCEPTED", started_at, completed_at, last_completed_substep, step_history, scope_audit }
        ⚠️ 故事 agent 不直接写 sprint-status.yaml —— 只写 per-story status 文件

3. RETURN
   └→ agent 返回: { story_id, status: "CODE_ACCEPTED", status_file: "_bmad-output/web-dev-flow/stories/{story_id}-status.yaml" }
   └→ main orchestrator 收到信号
        ↓
   └→ main orchestrator 读取 per-story status 文件
   └→ main orchestrator 执行 merge:  git merge story/{id}-{track} --no-ff
        ↓
   └→ main orchestrator 清理:      git worktree remove + git branch -d
        ↓
   └→ main orchestrator 原子写入:  将 per-story status 合并到 sprint-status.yaml（唯一写入点）
        ↓
   └→ main orchestrator 继续:      下一个 story
```

## 状态写入所有权（v2.0 解决写冲突）

**问题**: step-audit-protocol 将 status 嵌入 sprint-status.yaml，但 story agent 并行运行时多个 agent 同时写同一文件会导致写冲突。

**解决方案: Per-Story Status File + Orchestrator Aggregation**

### 写入分工

| 角色 | 写入目标 | 写入时机 |
|------|---------|---------|
| **Story Agent** | `_bmad-output/web-dev-flow/stories/{story_id}-status.yaml` (per-story 文件) | 故事开发过程中，在 worktree 内 |
| **Main Orchestrator** | `sprint-status.yaml` (全局状态) | agent 返回后，merge 前，原子写入 |

### Per-Story Status File 格式

```yaml
# _bmad-output/web-dev-flow/stories/{story_id}-status.yaml
story_id: "S-3.2"
title: "Auth Endpoints"
status: "CODE_ACCEPTED"
started_at: "2026-05-19T13:00:00Z"
completed_at: "2026-05-19T13:45:00Z"
last_completed_substep: "4h"
step_history:
  - step: "started"
    at: "2026-05-19T13:00:00Z"
    substep: null
  - step: "completed"
    at: "2026-05-19T13:45:00Z"
    substep: "4h"
    summary: "Auth Endpoints — 3 API routes, 12 tests pass, scope clean"
    status: "PASS"
scope_audit:
  gate_passed: true
  exit_verified: true
  exit_violations: 0
  ca05_passed: true
```

### Orchestrator 聚合流程

1. Agent 返回 `{story_id, status_file}` 后
2. Orchestrator 读取 per-story status 文件
3. Orchestrator 将 status 条目合并到 sprint-status.yaml 的 `phases.phase_4.phase_4_N.stories` 数组
4. 此操作在 merge 前完成，确保 sprint-status.yaml 始终是唯一的、一致的全局状态

### 冲突消除保证

- 故事 agent 从不写 sprint-status.yaml
- 只有 main orchestrator 写 sprint-status.yaml（单写入点）
- Per-story status 文件随 git commit 一起提交，merge 后自动可用于读取

## 为什么要干净的上下文

| 问题 | 共享上下文（不做隔离） | 独立 Agent（当前方案） |
|------|------------------|------------------|
| **上下文污染** | Agent A 的实现模式可能被 Agent B 误当作规范 | 各自只看到自己的 scope，互不干扰 |
| **并行性** | 同一 session 无法真正并行 | 每个 agent 完全独立，可真正并行 |
| **故障隔离** | 一个 story 的错误可能影响整个 session | 只有当前 story 的 worktree 受影响 |
| **上下文膨胀** | 10 个 story 后上下文积累 500K+ tokens | 每个 agent 始终 ~38K tokens |
| **恢复** | 中断后需要手动寻找"当前正在做哪个 story" | agent 上下文丢失 = 只丢失当前 story，其他不受影响 |
| **中止成本** | 一个 story 出问题需要清空整个 session | 只需删除当前 story 的 worktree |
| **注意力精度** | 上下文越大，模型注意力越分散 | 极小的上下文 → 极高的输出精度 |

## 并行执行的数量控制

虽然每个 story 独立，但并行 agent 数量受限于：

1. **依赖图拓扑**: depends_on 未满足的 story 是 `BLOCKED_BY_DEPENDENCY`，不启动 agent
2. **protected paths 独占**: `serial_only` 的 story 必须顺序执行
3. **系统资源**: 建议同时最多 3-5 个 agent 并行
4. **用户控制**: 用户可以在 customize.toml 中设置 `[parallel] max_concurrent_stories = 5`

## 与 Claude Code Agent 工具的集成

使用 Claude Code 的 `Agent` 工具启动每个 story agent：

```
Claude Code 主 session (Orchestrator)
  └→ Agent({
       description: "S-3.2: Auth Endpoints",
       subagent_type: "general-purpose",
       prompt: "你在实现 Story S-3.2: Auth Endpoints (backend track)
                你的 scope_write: [...]
                你的 acceptance_check: [...]
                请读取以下文件: ... 然后按步骤实现。
                完成后返回 CODE_ACCEPTED 状态。",
       isolation: "worktree"  ← 使用 worktree 隔离
     })
```

Agent 完成的返回结果包含：
- 分支名
- worktree 路径  
- 完成状态（CODE_ACCEPTED 或 错误）

Main orchestrator 接收返回结果后执行 merge。
<｜end▁of▁thinking｜>创建 Agent 隔离协议。
