# WDF Method Specification
> Version: 3.6.0
> Status: DRAFT → STABLE
> See Also: [CONSTITUTION.md](./CONSTITUTION.md), [SKILL.md](./SKILL.md)

## 1. 概述

WDF Method 是一个**可执行的Web开发工作流规范**。
它定义了从产品需求到上线部署的完整开发生命周期，
并提供TypeScript编排引擎确保所有规范得到实际执行。

### 1.1 设计原则
1. **规范即代码**：文档不是建议，是可执行的检查
2. **失败闭合**：未定义的行为 = 失败，不是静默通过
3. **单一真相**：每个数据项仅有一个写入者，一个来源
4. **可审计**：所有状态变更有记录、可回溯、可验证

---

## 2. 生命周期阶段

### 阶段 1: 分析 (Analysis)
| 子阶段 | 输入 | 输出 | 门禁 |
|--------|------|------|------|
| 1.1 影响地图 | 业务目标 | impact-map.md | 利益相关方确认 |
| 1.2 事件风暴 | 影响地图 | event-storm.md | 领域边界清晰 |
| 1.3 JTBD卡片 | 事件风暴 | jtbd-cards.md | 8个以上Job定义 |

### 阶段 2: 规划 (Planning)
| 子阶段 | 输入 | 输出 | 门禁 |
|--------|------|------|------|
| 2.1 产品简介 | 分析输出 | product-brief.md | 电梯陈述清晰 |
| 2.2 领域研究 | 产品简介 | domain-research.md | 技术选型理由 |
| 2.3 用户故事映射 | 产品简介 | story-map.md | 骨干活动完整 |
| 2.4 优先级排序 | 故事地图 | prioritization.md | MoSCoW标记 |
| 2.5 PRD编写 | 优先级 | prd.md | 验收条件可测试 |
| 2.6 用户流程 | PRD | user-flows.md | 异常流程覆盖 |
| 2.7 线框图 | 用户流程 | wireframes.md | 关键页面完整 |
| 2.8 设计令牌 | 线框图 | design-tokens.md | 设计师确认 |
| 2.9 设计验收 | 设计令牌 | design-acceptance.md | 设计系统完整 |

### 阶段 3: 解决方案 (Solutioning)
| 子阶段 | 输入 | 输出 | 门禁 |
|--------|------|------|------|
| 3.1 系统上下文 | PRD + 设计 | system-context.md | C4 L1完整 |
| 3.2 架构风格 | 系统上下文 | architecture-style.md | 技术决策有ADR |
| 3.3 容器设计 | 架构风格 | container-design.md | C4 L2完整 |
| 3.4 质量属性 | 容器设计 | quality-attributes.md | 可量化指标 |
| 3.5 组件设计 | 容器设计 | component-design.md | C4 L3完整 |
| 3.6 Epic划分 | 组件设计 | epics.md | 依赖关系明确 |
| 3.7 故事设计 | Epics | stories/*.md | SRG-01~09全部通过 |
| 3.8 API+数据设计 | 故事 | openapi.yaml + db-schema.md | Swagger验证通过 |
| 3.9 就绪检查 | 全部输出 | readiness-check.md | 所有门禁PASS |

### 阶段 4: 实现 (Implementation) - 并行执行
| 轨道 | 子阶段 | 输出 |
|------|--------|------|
| **后端** | 4.1 脚手架 → 4.2 数据库 → 4.3 API端点 → 4.4 测试 → 4.5 Code Review → 4.6 代码验收 | be-*.md + 测试报告 |
| **前端** | 4.7 脚手架 → 4.8 设计系统 → 4.9 API客户端 → 4.10 页面实现 → 4.11 A11Y+性能 → 4.12 UI验收 | fe-*.md + Lighthouse报告 |
| **集成** | 4.13 全栈集成 → 4.14 E2E测试 → 4.15 回顾 | integration-report.md + retrospective.md |

---

## 3. 故事就绪门禁 (SRG)

每个故事必须通过以下9项检查才能启动：

| ID | 检查项 | 失败条件 |
|----|--------|----------|
| SRG-01 | scope_write已定义 | scope_write为空或缺失 |
| SRG-02 | acceptance_check已定义 | 无验收命令或命令不在白名单 |
| SRG-03 | 故事文件存在 | stories/{story_id}.md不存在 |
| SRG-04 | 路径安全 | scope_write含`../`、绝对路径、forbidden_paths |
| SRG-05 | 无范围重叠 | 与IN_PROGRESS故事的scope_write有交集 |
| SRG-06 | 在实现边界内 | boundary冻结后超出scope |
| SRG-07 | 父目录存在 | scope_write路径不存在 |
| SRG-08 | 保护路径→串行 | 触碰migrations/schema等需串行执行 |
| SRG-09 | 命令安全 | 验收命令含`&&`、`|`、`curl`等危险操作 |

---

## 4. 状态系统

### 4.1 目录结构
```
status/
├── global.yaml              # 全局状态
├── phase-01-analysis.yaml   # 分析阶段
├── phase-02-planning.yaml   # 规划阶段
├── phase-03-solutioning.yaml # 解决方案阶段
├── phase-04-backend.yaml    # 后端实现
├── phase-04-frontend.yaml   # 前端实现
├── stories/                 # 每个故事一个文件
│   ├── story-001.yaml
│   └── story-002.yaml
├── merge-queue/             # 合并队列
│   └── items/
│       ├── queue-story-001.yaml
│       └── queue-story-002.yaml
└── backup/                  # 自动备份
    ├── 2026-06-17T00-00-00-global.yaml
    └── ...
```

### 4.2 状态文件写入权限矩阵
| 写入者 | 可写文件 |
|--------|----------|
| 阶段推进器 | phase-*.yaml |
| 故事运行器 | stories/story-*.yaml |
| 合并队列 | merge-queue/items/*.yaml |
| 状态管理器 | global.yaml, backup/* |

**规则：** 一个文件同一时间只能有一个写入者。

---

## 5. 验收命令白名单

### 5.1 允许的命令前缀
```
npm test
npm run
npx --no-install
node
jest
vitest
tsc
eslint
```

### 5.2 禁止的操作
任何命令含以下内容将被拒绝：
- `&&`、`||`、`;` - 命令串联
- `|` - 管道
- `$(...)`、`` `...` `` - 命令替换
- `>`、`<` - 重定向
- `curl`、`wget` - 网络请求
- `sudo`、`su` - 权限提升
- `eval` - 动态执行

---

## 6. 合并协议

### 6.1 原子合并三阶段协议
```
1. 预检查
   └── scope-lock验证 → 范围锁定

2. 试合并
   └── git merge --no-commit --no-ff
       └── 失败 → abort + 标记failed

3. 验证
   ├── 运行集成测试
   │   └── 失败 → abort + 标记failed
   └── 全部通过
       └── git commit → 标记merged
```

### 6.2 依赖排序
- 故事按`depends_on`声明排序
- 循环依赖 → 立即报错
- 无依赖 → 按development_order顺序

---

## 7. 可追溯性要求

### 7.1 完整链路
```
用户需求 (JTBD)
    ↓
PRD 条目 (REQ-xxx)
    ↓
Epic (EPIC-xxx)
    ↓
Story (STORY-xxx)
    ↓
API 端点 (openapi.yaml#paths/...)
    ↓
数据库表 (db-schema.md#tables/...)
    ↓
测试用例 (test/...)
    ↓
代码变更 (Git Commit)
```

### 7.2 Git提交规范
```
<story-id>: <title> — <phase>

scope: files/changed,other/files/changed
refs: REQ-123, EPIC-456
```

---

## 8. 审计日志

### 8.1 事件类型
| 事件类型 | 触发时机 | 关键字段 |
|----------|----------|----------|
| gate_check | 门禁评估 | check_id, status, phase |
| agent_dispatch_start | Agent启动 | story_id, track, worktree |
| agent_dispatch_complete | Agent完成 | story_id, exit_code, duration_ms |
| story_blocked | SRG未通过 | story_id, reason |
| scope_lock_pre_merge | 范围锁结果 | story_id, decision, violations |
| merge_enqueue | 入队 | story_id, branch, merge_order |
| merge_success | 合并成功 | story_id, commit, branch |
| merge_abort | 合并中止 | story_id, error |
| state_backup | 状态备份 | file, backup_file |

---

## 9. 错误恢复

### 9.1 恢复命令
```bash
# 检查状态一致性
wdf validate-state

# 从损坏中恢复
wdf recover [--from-backup <timestamp>]

# 查看最近备份
wdf recover --list-backups
```

### 9.2 恢复级别
1. **Level 1**：derived index损坏 → 从status/*.yaml重建
2. **Level 2**：单个status文件损坏 → 从backup恢复
3. **Level 3**：全面损坏 → Git回滚 + 备份恢复

---

## 10. 配置项

完整配置参见 [customize.toml](./customize.toml)

### 10.1 核心配置
```toml
[workflow]
version = "3.6.0"
output_dir = "_wdf_output"
status_dir = "_wdf_output/status"

[scope_lock]
enabled = true
enforcement_mode = "strict"  # strict | warning | permissive

[acceptance_gates]
code_coverage_min = 80
lighthouse_min_score = 90

[auto_run]
enabled = true
max_concurrent_stories = 5
story_agent_timeout_minutes = 30
```

---

*本规范是WDF Method的核心文档。所有实现代码必须与本规范保持一致。
任何不一致都是Bug，需要立即修复。*