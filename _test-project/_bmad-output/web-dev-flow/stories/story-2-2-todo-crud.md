---
artifact_type: story
phase: 3
sub_phase: "3.7"
status: locked
version: "3.6.0"
bmad_state: FINAL
story_id: S-2.2
title: "Todo CRUD Endpoints"
track: backend
effort: M
parallel_safe: true
order: 7
depends_on: ["S-2.1"]
---

# S-2.2: Todo CRUD Endpoints

## User Story
作为用户，我需要创建、查看、编辑和删除待办事项，以便管理我的任务列表。

## Acceptance Criteria
- Given 已认证用户，When POST /api/todos {title, description?, due_date?, category_id?}，Then 返回 201 + todo对象
- Given 已认证用户，When GET /api/todos，Then 返回 200 + 分页todo列表（支持 ?page&limit&status&sort）
- Given 已认证用户，When GET /api/todos/:id，Then 返回 200 + todo详情
- Given todo所有者，When PATCH /api/todos/:id {title, status, ...}，Then 返回 200 + 更新后的todo
- Given todo所有者，When DELETE /api/todos/:id，Then 返回 204
- Given 非所有者，When 操作他人todo，Then 返回 403
- Given 未认证请求，When 访问任意todo端点，Then 返回 401

## Technical Notes
- 分页：`?page=1&limit=20` → `{ data: [...], pagination: { page, limit, total, pages } }`
- 排序：`?sort=created_at&order=desc`
- 过滤：`?status=todo&category_id=1`
- 所有者验证中间件

## 7 Contract Fields

- **scope_write:** ["src/server/routes/todo.ts", "src/server/services/todo.service.ts", "src/server/validators/todo.validator.ts"]
- **out_of_scope:** ["src/pages/", "src/components/", "src/db/migrations/"]
- **acceptance_checks:** ["npm run test:todo", "npm run test:integration -- --grep todo"]
- **code_standards_source:** ["AGENTS.md"]
- **dependencies:** ["S-2.1"]
- **parallel_safe:** true
- **ui_truth_source:** null
