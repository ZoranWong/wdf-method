---
artifact_type: epics
phase: 3
sub_phase: "3.6"
status: locked
version: "3.6.0"
bmad_state: FINAL
bmad_review_passed: true
project: todo-app-test
dev_mode: separated
total_stories: 13
created_at: "2026-05-21T17:30:00Z"
---

# Epics — todo-app-test

## 概览

| Priority | Epic | Stories | Track | Sizing | 说明 |
|----------|------|---------|-------|--------|------|
| P0 | Epic 1: Backend Foundation & Auth | 3 | backend | M | 数据库+注册+登录+JWT中间件 |
| P0 | Epic 2: Todo Backend API | 3 | backend | M | 待办CRUD+分类CRUD |
| P0 | Epic 3: Frontend Application | 4 | frontend | L | 脚手架+设计系统+API客户端+页面 |
| P1 | Epic 4: Integration & Acceptance | 3 | full-stack | M | 集成测试+E2E+性能验收 |

## Track 分布

| Track | Story 数 | Epic 覆盖 |
|-------|---------|-----------|
| backend | 6 | Epic 1 (3), Epic 2 (3) |
| frontend | 4 | Epic 3 (4) |
| full-stack | 3 | Epic 4 (3) |

## 开发顺序

```
Order  Story ID   Track        Depends On          parallel_safe
─────────────────────────────────────────────────────────────
1      S-1.1      backend      —                   false (serial_only — DB migration)
2      S-1.2      backend      S-1.1               true
3      S-1.3      backend      S-1.2               true
4      S-2.1      backend      S-1.3               true
5      S-3.1      frontend     —                   true
6      S-3.2      frontend     S-3.1               true
7      S-2.2      backend      S-2.1               true
8      S-2.3      backend      S-2.1               true  (parallel with S-2.2)
9      S-3.3      frontend     S-3.2, S-1.2        true  (cross-track dep)
10     S-3.4      frontend     S-3.3, S-2.2        true  (cross-track dep)
11     S-4.1      full-stack   S-2.2, S-2.3        true
12     S-4.2      full-stack   S-3.4               true
13     S-4.3      full-stack   S-4.1, S-4.2        false
```

## 并行组

| Wave | Stories | 说明 |
|------|---------|------|
| Wave 1 | S-1.1, S-3.1 | S-1.1 serial_only (DB), S-3.1 parallel (FE scaffold) |
| Wave 2 | S-1.2, S-3.2 | Auth endpoints + FE API client |
| Wave 3 | S-1.3, S-2.1 | Auth middleware + Todo migrations |
| Wave 4 | S-2.2, S-2.3, S-3.3 | Todo CRUD + Category CRUD + Auth pages |
| Wave 5 | S-3.4, S-4.1 | Todo pages + BE integration tests |
| Wave 6 | S-4.2, S-4.3 | FE a11y/perf + E2E acceptance |

## 跨 Track 依赖

| 依赖 | 说明 |
|------|------|
| S-3.3 (FE Auth pages) → S-1.2 (BE Auth endpoints) | 登录页面需要后端认证API |
| S-3.4 (FE Todo pages) → S-2.2 (BE Todo CRUD) | Todo页面需要后端CRUD API |
