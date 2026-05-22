---
artifact_type: story
phase: 3
sub_phase: "3.7"
status: locked
version: "3.6.0"
bmad_state: FINAL
story_id: S-1.1
title: "Database Setup & Scaffolding"
track: backend
effort: XS
parallel_safe: false
order: 1
---

# S-1.1: Database Setup & Scaffolding

## User Story
作为开发者，我需要建立项目骨架和数据库连接，以便后续Story有可用的基础设施。

## Acceptance Criteria
- Given 执行 `npm run dev`，When 服务启动，Then 返回 200 健康检查
- Given 数据库配置，When 执行 `npm run migrate`，Then 所有迁移表创建成功
- Given TypeScript 严格模式，When 执行 `npx tsc --noEmit`，Then 无类型错误
- Given ESLint 配置，When 执行 `npm run lint`，Then 零错误退出

## Technical Notes
- Express + TypeScript + Prisma ORM
- Clean Architecture 目录结构：src/server/{routes,services,validators,middleware}
- PostgreSQL 连接池配置

## 7 Contract Fields

- **scope_write:** ["src/db/", "src/server/", "package.json", "tsconfig.json"]
- **out_of_scope:** ["src/pages/", "src/components/", ".env.production"]
- **acceptance_checks:** ["npm run dev -- --health-check", "npm run migrate:status", "npx tsc --noEmit", "npm run lint"]
- **code_standards_source:** ["AGENTS.md", "tsconfig.json", ".eslintrc.js"]
- **dependencies:** []
- **parallel_safe:** false
- **ui_truth_source:** null
