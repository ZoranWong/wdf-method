---
artifact_type: story
phase: 3
sub_phase: "3.7"
status: locked
version: "3.6.0"
bmad_state: FINAL
story_id: S-3.4
title: "Todo Pages — List, Create, Edit, Detail"
track: frontend
effort: L
parallel_safe: true
order: 10
depends_on: ["S-3.3", "S-2.2"]
---

# S-3.4: Todo Pages

## User Story
作为用户，我需要一个直观的界面来查看、创建、编辑和管理待办事项。

## Acceptance Criteria
- Given 已登录用户，When 访问 /todos，Then 显示分页待办列表（含loading/empty/error状态）
- Given 待办列表，When 点击"新建"，Then 显示创建表单（title必填 + description/due_date/category选填）
- Given 已创建的待办，When 点击待办项，Then 进入详情页（显示完整信息 + 编辑/删除按钮）
- Given 编辑模式，When 修改字段并保存，Then 显示成功提示 + 列表刷新
- Given 删除确认，When 确认删除，Then 待办从列表消失
- Given 空列表，When 访问 /todos，Then 显示空状态插画 + "创建第一个待办"CTA
- Given 网络错误，When API调用失败，Then 显示错误消息 + 重试按钮
- Given 键盘导航，When Tab through 页面，Then 焦点顺序正确 + 可操作元素有焦点指示

## Technical Notes
- React + TypeScript + TanStack Query
- UI States: Loading (Skeleton) / Empty (插画+CTA) / Error (消息+重试) / Success
- 分页：无限滚动 或 页码导航
- 乐观更新：创建/编辑操作先更新UI，失败时回滚

## 7 Contract Fields

- **scope_write:** ["src/pages/todos/", "src/components/todo/", "src/hooks/useTodos.ts"]
- **out_of_scope:** ["src/server/", "src/db/", "src/pages/auth/"]
- **acceptance_checks:** ["npm run test:todo-pages", "npx axe src/pages/todos/ --stdout", "npm run lighthouse -- --path=/todos"]
- **code_standards_source:** ["AGENTS.md", ".eslintrc.js"]
- **dependencies:** ["S-3.3", "S-2.2"]
- **parallel_safe:** true
- **ui_truth_source:** "wireframes.md § Todo Pages"
