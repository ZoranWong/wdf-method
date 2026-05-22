# 故事切片与依赖管理 — web-dev-flow 改进提案

**Version:** 2.0.0 (optimized)
**Source:** StoryRail + Cregis Console Manager 模式分析
**Applies to:** web-dev-flow V3 Phase 3-4

---

## 一、概念：什么是故事切片

**故事切片 = 将一个 L/XL 级故事拆分为多个独立可实施、独立可验收的小单元。**

类比：一个大故事是一整个披萨，切片后可以逐片交付。切片的核心理念来自两个参考项目：

### 1.1 StoryRail 的 Execution Units

StoryRail 将一个故事拆分为多个 Execution Unit，每个 Unit 有独立 scope_write 和 acceptance_check。故事只有在所有 Unit 都合并后才算 "merged"。

### 1.2 Cregis Console Manager 的主线+切片

Cregis 将每条主线（Line）拆分为 P0/P1 优先级切片：

```
ML-009 (主线: deferred)           ← 整条线未收口
  ├── P0 切片: accepted           ← MVP 已验收
  └── P1 切片: deferred           ← 增强功能未开始

ML-004 (主线: closed)             ← 所有切片完成
```

**关键洞察**："ML-009 完成了"是不准确的——准确说法是"ML-009 的 P0 切片已完成，整条线仍是 deferred"。主线的状态 = 所有切片状态的聚合推导。

---

## 二、什么时候需要切片

**核心规则：切片是可选工具，不是默认行为。**

```
故事 effort 为 S 或 M → 不切片，一个 scope_write 搞定
故事 effort 为 L 或 XL → 考虑拆为 P0 + P1 两个切片
```

### 不需要切片的场景（大多数情况）

- S/M 级故事（<4 小时实现）—— 切片管理成本超过收益
- 故事本身就是单一功能点 —— 没有可拆分交付的中间状态
- 项目 < 10 个故事 —— 故事已经足够细粒度
- 单人开发，无并行需求 —— 不需要切片来协调

### 需要切片的场景

- L/XL 级故事（>1 天实现）—— 切成 P0/P1，P0 完成即可交付 MVP
- 故事有明确的分阶段交付价值 —— 用户可以逐阶段使用
- 多人并行开发 —— 切片可分配给不同开发者
- 想降低风险 —— P0 完成后即使 P1 推迟，MVP 已就绪

---

## 三、切片定义

```yaml
# L 级故事：使用切片
- story_id: "S-4.1"
  title: "User CRUD Endpoints"
  effort: "L"
  scope_write: ["src/modules/users/"]          # 故事级兜底
  slices:
    - slice_id: "S-4.1-P0"
      title: "Create + Read (MVP)"
      scope_write: ["src/modules/users/create.ts", "src/modules/users/read.ts"]
      acceptance_check: ["npm run test:users:crud -- --grep 'create|read'"]
    - slice_id: "S-4.1-P1"
      title: "Update + Delete"
      depends_on_slices: ["S-4.1-P0"]          # P1 依赖 P0
      scope_write: ["src/modules/users/update.ts", "src/modules/users/delete.ts"]
      acceptance_check: ["npm run test:users:crud -- --grep 'update|delete'"]

# S 级故事：不切片
- story_id: "S-1.1"
  title: "Project Scaffold"
  effort: "S"
  scope_write: ["src/app/"]
  acceptance_check: ["npm run dev"]
  # slices 省略 → 整个故事就是一个切片
```

**为什么只有 P0/P1 而不是 P0/P1/P2**：两级足够覆盖绝大多数场景。P2（"锦上添花"）通常是独立的小故事，不值得用切片管理。

---

## 四、状态推导（简化版）

### 切片状态

```
NOT_STARTED  →  IN_PROGRESS  →  CODE_ACCEPTED
                                 BLOCKED_BY_DEPENDENCY（依赖切片未完成）
```

### 故事状态（从切片聚合推导）

| 切片状态组合 | 故事推导状态 |
|------------|------------|
| 所有切片 NOT_STARTED | NOT_STARTED |
| 任一切片 IN_PROGRESS | IN_PROGRESS |
| P0 CODE_ACCEPTED, P1 未完成 | IN_PROGRESS（MVP 可交付） |
| 所有切片 CODE_ACCEPTED | CODE_ACCEPTED |

推导逻辑简单到一句话：**所有切片都 CODE_ACCEPTED → 故事 CODE_ACCEPTED；否则取最靠前的切片状态。**

### 实施流程

```
1. 选中故事 S-4.1
2. 找第一个未完成切片 → S-4.1-P0
3. 实施 S-4.1-P0 → CODE_ACCEPTED
4. 检查 P1 依赖：P0 已完成 ✓
5. 实施 S-4.1-P1 → CODE_ACCEPTED
6. 所有切片完成 → 故事 CODE_ACCEPTED
```

### 切片子步骤 ID 映射（V3.6）

每个切片遵循相同的子步骤序列，切片 ID 作为前缀：

**BE 切片（Phase 4.4）：**

| 子步骤 | Step ID | 说明 |
|-------|---------|------|
| 切片就绪门 | `{slice_id}-4a` | SRG 检查（此切片特定的 scope_write） |
| 读取切片 + 标记 IN_PROGRESS | `{slice_id}-4b` | 切片开始 |
| 实施 | `{slice_id}-4c` | 仅切片的 scope_write 中的代码 |
| 编写测试 | `{slice_id}-4d` | 切片特定的测试 |
| 规范验证 | `{slice_id}-4e` | 切片特定的 api-spec 对齐 |
| 生成交接 | `{slice_id}-4f` | 切片 self-check.md + handoff.md |
| 范围退出验证 | `{slice_id}-4f2` | 切片 scope_write vs git diff |
| 验收检查 | `{slice_id}-4g` | 切片特定的 acceptance_check 命令 |
| CODE ACCEPTANCE | `{slice_id}-4h` | CA-01 至 CA-05 |
| 标记 CODE_ACCEPTED | `{slice_id}-4j` | 切片状态更新 |

**FE 切片（Phase 4.10）：**

| 子步骤 | Step ID | 说明 |
|-------|---------|------|
| 切片就绪门 | `{slice_id}-4a` | SRG 检查 |
| 读取切片 + 标记 IN_PROGRESS | `{slice_id}-4b` | 切片开始 |
| 实施页面 | `{slice_id}-4c` | 仅切片的 scope_write |
| 可访问性审计 | `{slice_id}-4d` | 切片页面 a11y |
| 组件测试 | `{slice_id}-4e` | 切片组件测试 |
| 集成测试 | `{slice_id}-4f` | 切片集成测试 |
| 更新开发日志 | `{slice_id}-4g` | 切片进度日志 |
| 生成交接 | `{slice_id}-4h` | 切片 self-check.md + handoff.md |
| 范围退出验证 | `{slice_id}-4h2` | 切片 scope_write vs git diff |
| 验收检查 | `{slice_id}-4i` | 切片 acceptance_check |
| CODE ACCEPTANCE | `{slice_id}-4j` | CA-01 至 CA-05 |
| 标记 CODE_ACCEPTED | `{slice_id}-4k` | 切片状态更新 |

**恢复示例：** `last_completed_substep: "S-4.1-P0-4f2"` → 恢复：切片 P0，子步骤 4g（验收检查）。
故事的 `last_completed_substep` 是最后完成切片的最后完成子步骤。

---

## 五、依赖检查时机

**默认保持 SRG-01 为 blocking（v1 行为）**。

StoryRail 的"start 不检查、merge 强检查"模式适合有独立 merge 步骤的项目。web-dev-flow 没有独立的 merge 阶段，CODE_ACCEPTANCE 就是 merge。将依赖检查延迟到 CA 阶段会引入返工风险。

需要提高并行性时，在 `customize.toml` 中可选启用：

```toml
[dependency_check]
mode = "strict"              # "strict"（默认，启动时检查）| "deferred"（延迟到 CA）
```

`deferred` 模式下 Agent 可以提前开始，但必须在 handoff 中标注假设的依赖接口。仅在以下条件同时满足时建议使用：
- 依赖故事的 API 契约已在 Phase 3.8 明确
- 团队能承受 10-20% 的返工概率
- 并行收益显著（>30% 时间节省）

---

## 六、复杂度分层建议

| 项目规模 | 切片 | 依赖延迟 | 说明 |
|---------|------|---------|------|
| 简单（<10 stories） | 不需要 | 不需要 | 故事粒度已足够，切片徒增复杂度 |
| 中等（10-20 stories） | L/XL 故事可选 | 不需要 | 仅在必要处切片 |
| 复杂（>20 stories） | L/XL 故事建议 | 可选 | 切片 + 可选延迟依赖 |

---

## 七、与现有文档的关联

| 文档 | 修改 |
|------|------|
| `sprint-status-schema.yaml` | `slices` 数组已定义（可选字段） |
| `3-7-stories.md` | 故事设计时支持 L/XL 故事的可选切片定义 |
| `3-9-readiness-check.md` | 如有切片，检查切片级 scope_write 完整性 |
| `4-4-be-api-endpoints.md` | auto-continue 按切片顺序迭代 |
| `4-10-fe-page-implementation.md` | 同上 |
