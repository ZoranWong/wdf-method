---
artifact_type: implementation-plan
phase: 4
target: examples/todo-app/backend
status: ready
generated_by: wdf-method Phase A / A3.1
generated_at: 2026-06-21
---

# Todo-app Backend 待实现清单 (A3.1 盘点)

从 `_wdf_output/stories/` + `api-spec.yaml` + `db-schema.md` 反向推导。

## 范围

**P0 endpoint（8 stories 全 P0，5 个属 backend）：**
- S-DB-01 — PostgreSQL schema + migrations
- S-AUTH-01 — POST /auth/register (bcrypt)
- S-AUTH-03 — POST /auth/login (JWT)
- S-AUTH-05 — POST /auth/refresh + /auth/logout + JWT middleware
- S-TODO-01 — Todo CRUD endpoints

**Out of scope（属 frontend）：** S-AUTH-02 / S-AUTH-04 / S-TODO-04

## API 端点清单（来自 api-spec.yaml）

| Method | Path | Story | 描述 |
|--------|------|-------|------|
| GET | /health | (基础) | Liveness probe |
| POST | /auth/register | S-AUTH-01 | 注册，bcrypt cost 12 |
| POST | /auth/login | S-AUTH-03 | 登录，发 access_token (JWT) + refresh_token |
| POST | /auth/refresh | S-AUTH-05 | 刷新 access_token |
| POST | /auth/logout | S-AUTH-05 | 撤销 refresh_token |
| GET | /todos | S-TODO-01 | 列出当前用户的 todos |
| POST | /todos | S-TODO-01 | 创建 todo |
| GET | /todos/{id} | S-TODO-01 | 获取单个 todo |
| PUT | /todos/{id} | S-TODO-01 | 更新 todo |
| DELETE | /todos/{id} | S-TODO-01 | 删除 todo |

## 数据模型（来自 db-schema.md）

### users
- `id` uuid PK DEFAULT gen_random_uuid()
- `email` citext UNIQUE NOT NULL（需 citext 扩展）
- `password_hash` text NOT NULL（bcrypt cost 12）
- `name` text NOT NULL
- `created_at` / `updated_at` timestamptz DEFAULT now()

### todos
- `id` uuid PK
- `user_id` uuid FK → users.id
- `title` text NOT NULL，1-500 字符
- `description` text NULLABLE，≤5000 字符
- `due_date` timestamptz NULLABLE
- `priority` text CHECK IN ('low','medium','high')
- `completed` boolean DEFAULT false
- `created_at` / `updated_at` timestamptz

## Tech Stack 决策

**从 `_wdf_output/architecture.md` + node_modules 反推：**
- **Runtime:** Node.js 20+ (已有 node_modules)
- **Framework:** Express 4（生态最广，对应 stories 里 middleware 描述）
- **DB:** PostgreSQL 16 + node-pg-migrate（依赖已在 node_modules）+ pg 驱动
- **Auth:** bcrypt (cost 12) + jsonwebtoken（access_token）+ cookie-parser（cookie auth）
- **Validation:** zod（依赖已在 node_modules）
- **Test:** vitest + supertest（与 orchestrator 一致）

## 目录结构（A3.2 将创建）

```
examples/todo-app/backend/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── auth.ts       (register/login/refresh/logout)
│   │   │   └── todos.ts      (CRUD)
│   │   └── middleware/
│   │       ├── auth.ts       (JWT verify + req.user)
│   │       └── error.ts      (centralized error handler)
│   ├── db/
│   │   ├── client.ts         (pg Pool)
│   │   └── repos/
│   │       ├── users.ts
│   │       └── todos.ts
│   ├── services/
│   │   ├── auth.service.ts   (bcrypt hash/compare, JWT sign/verify)
│   │   └── tokens.service.ts (refresh token rotation)
│   ├── schemas/              (zod)
│   │   ├── auth.ts
│   │   └── todo.ts
│   ├── app.ts                (Express app composition)
│   └── server.ts             (HTTP listen entry)
├── migrations/
│   ├── 001_citext.up.sql / .down.sql
│   ├── 002_users.up.sql / .down.sql
│   └── 003_todos.up.sql / .down.sql
├── tests/
│   ├── auth.test.ts
│   ├── todos.test.ts
│   └── setup.ts              (启动 test DB / cleanup)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## 验收 (A3.2 → A3.3)

- [ ] `npm install && npm run migrate && npm test` 全绿
- [ ] 覆盖率 ≥ 90%（满足宪法 §7）
- [ ] `npm start` + `curl localhost:3000/api/v1/health` 返回 200
- [ ] docker-compose.yml（PostgreSQL + backend）可一键起
- [ ] traceability: 每个 endpoint 反向追溯到 PRD REQ（A3.4）

## 估算

- A3.2 backend src/：~3 人日（DB migrations + 5 endpoint × middleware/tests）
- A3.3 E2E 跑通：~0.5 人日
- A3.4 wdf 验证证据：~0.5 人日

**总计 A3.2-A3.4：4 人日**（与 Phase A plan 估算一致）
