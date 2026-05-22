---
artifact_type: story
phase: 3
sub_phase: "3.7"
status: locked
version: "3.6.0"
bmad_state: FINAL
story_id: S-1.2
title: "Auth Endpoints — Register & Login"
track: backend
effort: M
parallel_safe: true
order: 2
depends_on: ["S-1.1"]
---

# S-1.2: Auth Endpoints — Register & Login

## User Story
作为用户，我需要通过邮箱和密码注册账号并登录，以便使用待办功能。

## Acceptance Criteria
- Given 新用户邮箱和密码，When POST /api/auth/register，Then 返回 201 + JWT token
- Given 已注册用户凭据，When POST /api/auth/login，Then 返回 200 + JWT token
- Given 无效凭据，When POST /api/auth/login，Then 返回 401 + 错误消息
- Given 重复邮箱，When POST /api/auth/register，Then 返回 409 + 错误消息
- Given 弱密码，When POST /api/auth/register，Then 返回 400 + 验证错误

## Technical Notes
- bcrypt 密码哈希（salt rounds >= 10）
- JWT token 签发（RS256，15min access + 7d refresh）
- 输入验证：email 格式、password >= 8字符

## 7 Contract Fields

- **scope_write:** ["src/server/routes/auth.ts", "src/server/services/auth.service.ts", "src/server/validators/auth.validator.ts", "src/server/middleware/auth.ts"]
- **out_of_scope:** ["src/pages/", "src/db/"]
- **acceptance_checks:** ["npm run test:auth", "npm run test:integration -- --grep auth"]
- **code_standards_source:** ["AGENTS.md"]
- **dependencies:** ["S-1.1"]
- **parallel_safe:** true
- **ui_truth_source:** null
