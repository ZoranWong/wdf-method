# Scope Lock Protocol — 范围锁定防越界机制

**Version:** 2.0.0 (optimized)
**Applies to:** Phase 4 (Implementation) — all development tracks
**Config:** `customize.toml → [scope_lock]`

## Purpose

防止 AI agent 在 Phase 4 实施阶段修改超出分配范围的文件。v2.0 相比 v1.0 的核心变化：

| 维度 | v1.0 | v2.0 |
|------|------|------|
| 审计日志格式 | YAML 单文件追加 | JSONL（每行独立，原子性） |
| 审计日志 | 强制写入独立文件 | 可选，可嵌入 sprint-status.yaml |
| 操作类型 | 9 种 | 5 种（合并冗余） |
| 控制台输出 | 冗长模板 | 精简一行 |

---

## 三级范围锁定

```
Level 1: Phase Boundary     — implementation_boundary（所有故事 scope 的并集）
Level 2: Story Scope Lock   — scope_write + git diff 验证
Level 3: Acceptance Audit   — CODE ACCEPTANCE 时的范围审计
```

---

## Level 1: Phase Boundary

`implementation_boundary` 在 Phase 3.9 计算，是所有故事 `scope_write` 的去重并集。

```yaml
# sprint-status.yaml
global_state:
  implementation_boundary:
    defined_at: "2026-05-19T10:00:00Z"
    scope_frozen: true
    backend_scope: ["src/modules/", "src/middleware/", "src/db/"]
    frontend_scope: ["src/pages/", "src/components/", "src/hooks/"]
    shared_scope: ["package.json", "tsconfig.json"]
    forbidden_paths: ["src/legacy/", ".env.production"]
```

Phase 4.1 创建 git tag 作为范围基线：

```bash
git tag scope-freeze/pre-implementation
```

---

## Level 2: Story Scope Lock

### Story Ready Gate（4a 子步骤）

| Check | ID | 说明 | Severity |
|-------|----|------|----------|
| scope_write 非空 | SRG-02 | scope_write 已定义且非空 | blocking |
| 无并行重叠 | SRG-05 | 没有其他 IN_PROGRESS 故事与之范围重叠 | blocking |
| 范围内 | SRG-06 | 所有 scope_write 路径在 implementation_boundary 内 | blocking |
| 路径存在 | SRG-07 | scope_write 路径的父目录存在 | blocking |

### Scope Exit Verification（4f2/4h2 子步骤）

故事提交前，用 git diff 验证所有修改在 scope_write 内：

```bash
set -euo pipefail
SCOPE_FILES=$(git diff --name-only HEAD)
for f in $SCOPE_FILES; do
  matched=0
  for p in ${scope_write}; do
    # 目录边界匹配：精确匹配 或 路径前缀+目录分隔符
    # 注意: "$p"/* 中的 "/" 是字面量，确保 src/auth 不会匹配 src/foobar.ts
    [[ $f = "$p" || $f = "$p"/* ]] && { matched=1; break; }
  done
  [ $matched = 0 ] && echo "VIOLATION: $f"
done
```

**违规处理（3 选项）**：

```
⚠ SCOPE VIOLATION in S-3.2: 2 file(s) outside scope_write
  ✗ src/utils/jwt.ts
  ✗ src/config/database.ts

  [1] Revert  — git checkout 违规文件，保留 scope_write 变更
  [2] Expand  — 提交 Scope Expansion CR（需审批）
  [3] Exit    — 保存状态，返回菜单
```

### Scope Expansion CR

```yaml
cr:
  id: "CR-{NNN}"
  type: "scope_expansion"
  story_id: "{story_id}"
  current_scope: ["src/modules/auth/"]
  requested_scope: ["src/modules/auth/", "src/utils/jwt.ts"]
  reason: "JWT utility needs token refresh helper"
```

---

## Level 3: Acceptance Scope Audit (CA-05)

CODE ACCEPTANCE 时运行：

```bash
# 验证当前分支相对于 scope freeze 基线的所有变更都在 scope_write 内
# 使用 for 循环替代 while read 管道，避免子 shell 变量作用域问题
SCOPE_FILES=$(git diff --name-only scope-freeze/pre-implementation..HEAD)
VIOLATIONS=0
for f in $SCOPE_FILES; do
  matched=0
  for p in ${scope_write}; do
    # 目录边界匹配：精确匹配 或 路径前缀+目录分隔符
    [[ $f = "$p" || $f = "$p"/* ]] && { matched=1; break; }
  done
  if [ $matched = 0 ]; then
    echo "VIOLATION: $f"
    VIOLATIONS=$((VIOLATIONS+1))
  fi
done
[ $VIOLATIONS = 0 ]
```

---

## 配置

```toml
[scope_lock]
enabled = true
enforcement_mode = "strict"          # "strict" | "permissive" | "warning_only"
scope_expansion_requires = "user_approval"
forbidden_paths = []

# v2.0 新增
audit_log_format = "jsonl"           # "jsonl" (推荐) | "yaml" (v1 兼容) | "none" (嵌入 sprint-status)
```

### Enforcement Modes

| Mode | SRG-05 | SRG-06 | SRG-07 | Exit Verification | CA-05 |
|------|--------|--------|--------|-------------------|-------|
| `strict` | blocking | blocking | blocking | enforced | blocking |
| `permissive` | warning | blocking | warning | enforced | warning |
| `warning_only` | warning | warning | warning | logged only | warning |

---

## Scope Audit Log（可选）

当 `audit_log_format = "jsonl"` 时，审计记录写入 `{scope_audit_log_output}.jsonl`：

```jsonl
{"op":"boundary_generation","ts":"2026-05-19T10:00:00Z","phase":"3.9","status":"PASS","summary":"12 stories, 18 paths"}
{"op":"scope_validation","ts":"2026-05-19T12:00:00Z","phase":"4.1","status":"PASS","stories":12}
{"op":"overlap_check","ts":"2026-05-19T12:01:00Z","phase":"4.1","status":"PASS","overlaps":0}
{"op":"story_gate","ts":"2026-05-19T13:00:00Z","phase":"4.4","story":"S-3.2","status":"PASS"}
{"op":"exit_verify","ts":"2026-05-19T13:30:00Z","phase":"4.4","story":"S-3.2","status":"PASS","files":3,"violations":0}
{"op":"ca05_audit","ts":"2026-05-19T13:45:00Z","phase":"4.4","story":"S-3.2","status":"PASS","violations":0}
```

**JSONL 的优势**：每行是独立 JSON 记录。写入中途崩溃只影响最后一行，不影响已写入的记录。解决了 YAML 单文件追加的原子性问题。

当 `audit_log_format = "none"` 时，scope audit 信息直接记录在 sprint-status.yaml 的 story 对象中：

```yaml
# sprint-status.yaml — story 对象内
- id: "S-3.2"
  scope_audit:                         # 仅当 audit_log_format = "none"
    gate_passed: true
    exit_verified: true
    exit_violations: 0
    ca05_passed: true
```

### 5 种操作类型（v2.0 精简）

| 操作 | op 字段 | 触发时机 |
|------|---------|---------|
| 边界生成 | `boundary_generation` | Phase 3.9 |
| 范围验证 | `scope_validation` | Phase 4.1（验证 + 重叠检测合并） |
| 故事门禁 | `story_gate` | Phase 4.4/4.10 Step 4a |
| 退出验证 | `exit_verify` | Phase 4.4/4.10 Step 4f2/4h2 |
| CA-05 审计 | `ca05_audit` | CODE ACCEPTANCE |

v1.0 的 9 种操作合并为 5 种：`scope_write_validation` + `parallel_scope_overlap_detection` → `scope_validation`；`git_scope_tag_creation`、`track_level_scope_audit`、`scope_expansion_cr` 不再产生独立审计记录。

---

## 控制台输出格式

精简为一行格式，仅在异常时展开：

```
✓ S-3.2 SCOPE LOCKED — ["src/modules/auth/", "src/middleware/auth.ts"]
✓ S-3.2 SCOPE EXIT CLEAN — 3 files, 0 violations
✗ S-4.1 SCOPE VIOLATION — 2 files outside scope_write → [Revert|Expand|Exit]
```

---

## 与工作流的集成点

| Phase | 步骤 | 操作 |
|-------|------|------|
| 3.9 | Step 4.7 | 生成 implementation_boundary |
| 4.1 | Step 8.1-8.3 | 验证 scope_write → 检测重叠 → 创建 git tag |
| 4.4/4.10 | Step 4a | Story Ready Gate (SRG-02/05/06/07) |
| 4.4/4.10 | Step 4f2/4h2 | Scope Exit Verification |
| 4.4/4.10 | Step 4h/4j | CA-05 Scope Audit |
| 4.6/4.12 | Completion Review | Track-level scope audit |
