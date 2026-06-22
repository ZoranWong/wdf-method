// test/todos/crud.test.ts
// Story: S-TODO-01 — Todo CRUD endpoints
// Maps to REQ: REQ-004, REQ-005, REQ-007
//
// Integration tests covering AC1, AC2, AC3, AC4, AC5, AC7.
// AC6 (cross-user isolation) lives in isolation.test.ts.
//
// Uses supertest + pg-mem (see test/_helpers/pgmem.ts). A single user is
// created per test via createUser(); the test then exercises the API
// through the access token the way a real client would (cookie path).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { setupTestDb, teardownTestDb } from "../_helpers/pgmem.js";
import { createUser, authCookie, type TestUser } from "../_helpers/users.js";
import { createApp } from "../../src/app.js";
import type { IMemoryDb } from "pg-mem";

// Force cheap bcrypt + test-mode env BEFORE the app modules cache their
// cost value. env.ts reads process.env.BCRYPT_COST at module load.
process.env.BCRYPT_COST = "4";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

let db: IMemoryDb;
let app: ReturnType<typeof createApp>;
let user: TestUser;

function authHeader(): { Cookie: string } {
  return { Cookie: authCookie(user) };
}

beforeEach(async () => {
  db = await setupTestDb();
  app = createApp();
  user = await createUser(db, { email: "todo-owner@example.com" });
});

afterEach(() => {
  teardownTestDb();
});

// --- helpers ---------------------------------------------------------------

interface TodoApiRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high";
  completed: boolean;
  created_at: string;
  updated_at: string;
}

async function createTodoViaApi(
  body: Record<string, unknown>,
  status = 201,
): Promise<TodoApiRow> {
  const res = await request(app)
    .post("/api/v1/todos")
    .set(authHeader())
    .send(body);
  expect(res.status).toBe(status);
  return res.body.data as TodoApiRow;
}

function validCreateBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    title: "Write integration tests",
    ...overrides,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- tests -----------------------------------------------------------------

describe("POST /api/v1/todos - create - AC1", () => {
  it("AC1: 201 on valid minimal input (title only); todo is bound to req.user.id", async () => {
    const res = await request(app)
      .post("/api/v1/todos")
      .set(authHeader())
      .send(validCreateBody());

    expect(res.status).toBe(201);
    const todo = res.body.data as TodoApiRow;
    expect(todo.id).toMatch(UUID_RE);
    // CRITICAL: the todo is bound to req.user.id, not anything in the body.
    expect(todo.user_id).toBe(user.id);
    expect(todo.title).toBe("Write integration tests");
    // DB defaults
    expect(todo.priority).toBe("medium");
    expect(todo.completed).toBe(false);
    expect(todo.description).toBeNull();
    expect(todo.due_date).toBeNull();
    // ISO 8601 timestamps
    expect(todo.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(todo.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("AC1: accepts optional fields (description, due_date, priority, completed)", async () => {
    const res = await request(app)
      .post("/api/v1/todos")
      .set(authHeader())
      .send({
        title: "Buy groceries",
        description: "Milk, eggs, coffee",
        due_date: "2026-12-31T23:59:59Z",
        priority: "high",
        completed: true,
      });

    expect(res.status).toBe(201);
    const todo = res.body.data as TodoApiRow;
    expect(todo.description).toBe("Milk, eggs, coffee");
    expect(todo.due_date).toBe("2026-12-31T23:59:59.000Z");
    expect(todo.priority).toBe("high");
    expect(todo.completed).toBe(true);
  });

  it("AC1: ignores user_id in body - the server derives owner from the JWT", async () => {
    // Attacker tries to create a todo "owned by someone else" by stuffing
    // user_id into the body. Zod schema is strict() (extra keys dropped,
    // not rejected) - but even if it weren't, the route passes req.user.sub
    // to the repo, never the body. We assert the bound owner is correct.
    const res = await request(app)
      .post("/api/v1/todos")
      .set(authHeader())
      .send({
        title: "Hostile takeover attempt",
        user_id: "00000000-0000-0000-0000-000000000000",
      });

    expect(res.status).toBe(201);
    expect((res.body.data as TodoApiRow).user_id).toBe(user.id);
  });

  it("AC7: rejects empty body with 400", async () => {
    const res = await request(app).post("/api/v1/todos").set(authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it("AC7: rejects empty title with 400", async () => {
    const res = await request(app)
      .post("/api/v1/todos")
      .set(authHeader())
      .send({ title: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("AC7: rejects title > 500 chars with 400", async () => {
    const res = await request(app)
      .post("/api/v1/todos")
      .set(authHeader())
      .send({ title: "x".repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("AC7: rejects invalid priority with 400", async () => {
    const res = await request(app)
      .post("/api/v1/todos")
      .set(authHeader())
      .send({ title: "T", priority: "urgent" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("AC7: rejects invalid due_date format with 400", async () => {
    const res = await request(app)
      .post("/api/v1/todos")
      .set(authHeader())
      .send({ title: "T", due_date: "not-a-date" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("AC8: 401 when no access token is supplied", async () => {
    const res = await request(app)
      .post("/api/v1/todos")
      .send(validCreateBody());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/todos - list - AC2 + AC3", () => {
  it("AC2: returns only the authed user's todos (empty by default)", async () => {
    const res = await request(app).get("/api/v1/todos").set(authHeader());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it("AC2: returns the user's todos, newest-first", async () => {
    const first = await createTodoViaApi({ title: "first" });
    const second = await createTodoViaApi({ title: "second" });

    const res = await request(app).get("/api/v1/todos").set(authHeader());
    expect(res.status).toBe(200);
    const list = res.body.data as TodoApiRow[];
    expect(list).toHaveLength(2);
    // newest-first: second was created after first
    expect(list[0]!.id).toBe(second.id);
    expect(list[1]!.id).toBe(first.id);
  });

  it("AC3: ?status=active returns only completed=false", async () => {
    await createTodoViaApi({ title: "active-1", completed: false });
    await createTodoViaApi({ title: "done-1", completed: true });
    await createTodoViaApi({ title: "active-2", completed: false });

    const res = await request(app)
      .get("/api/v1/todos?status=active")
      .set(authHeader());
    expect(res.status).toBe(200);
    const list = res.body.data as TodoApiRow[];
    expect(list).toHaveLength(2);
    expect(list.every((t) => t.completed === false)).toBe(true);
  });

  it("AC3: ?status=completed returns only completed=true", async () => {
    await createTodoViaApi({ title: "active-1", completed: false });
    await createTodoViaApi({ title: "done-1", completed: true });

    const res = await request(app)
      .get("/api/v1/todos?status=completed")
      .set(authHeader());
    expect(res.status).toBe(200);
    const list = res.body.data as TodoApiRow[];
    expect(list).toHaveLength(1);
    expect(list[0]!.completed).toBe(true);
  });

  it("AC3: ?status=all returns everything", async () => {
    await createTodoViaApi({ title: "a", completed: false });
    await createTodoViaApi({ title: "b", completed: true });

    const res = await request(app)
      .get("/api/v1/todos?status=all")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect((res.body.data as TodoApiRow[]).length).toBe(2);
  });

  it("AC3: missing status param returns all (same as ?status=all)", async () => {
    await createTodoViaApi({ title: "a", completed: false });
    await createTodoViaApi({ title: "b", completed: true });

    const res = await request(app).get("/api/v1/todos").set(authHeader());
    expect(res.status).toBe(200);
    expect((res.body.data as TodoApiRow[]).length).toBe(2);
  });

  it("AC3: invalid status value returns 400", async () => {
    const res = await request(app)
      .get("/api/v1/todos?status=bogus")
      .set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("AC8: 401 when no access token is supplied", async () => {
    const res = await request(app).get("/api/v1/todos");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/v1/todos/:id - update - AC4", () => {
  it("AC4: updates only the fields present in the body", async () => {
    const todo = await createTodoViaApi({
      title: "Original title",
      priority: "low",
      completed: false,
    });

    const res = await request(app)
      .patch(`/api/v1/todos/${todo.id}`)
      .set(authHeader())
      .send({ title: "Updated title" });

    expect(res.status).toBe(200);
    const updated = res.body.data as TodoApiRow;
    expect(updated.title).toBe("Updated title");
    // Untouched fields preserved
    expect(updated.priority).toBe("low");
    expect(updated.completed).toBe(false);
  });

  it("AC4: updates multiple fields in one request", async () => {
    const todo = await createTodoViaApi({ title: "Old" });

    const res = await request(app)
      .patch(`/api/v1/todos/${todo.id}`)
      .set(authHeader())
      .send({
        title: "New",
        description: "now with description",
        priority: "high",
        completed: true,
      });

    expect(res.status).toBe(200);
    const updated = res.body.data as TodoApiRow;
    expect(updated.title).toBe("New");
    expect(updated.description).toBe("now with description");
    expect(updated.priority).toBe("high");
    expect(updated.completed).toBe(true);
  });

  it("AC4: 404 when todo does not exist", async () => {
    const bogus = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .patch(`/api/v1/todos/${bogus}`)
      .set(authHeader())
      .send({ title: "X" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("AC4: 404 when id is not a uuid (route-level rejection)", async () => {
    const res = await request(app)
      .patch("/api/v1/todos/not-a-uuid")
      .set(authHeader())
      .send({ title: "X" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("AC4: 400 when body is empty (no updatable fields)", async () => {
    const todo = await createTodoViaApi({ title: "X" });
    const res = await request(app)
      .patch(`/api/v1/todos/${todo.id}`)
      .set(authHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("AC7: rejects invalid title with 400", async () => {
    const todo = await createTodoViaApi({ title: "X" });
    const res = await request(app)
      .patch(`/api/v1/todos/${todo.id}`)
      .set(authHeader())
      .send({ title: "" });
    expect(res.status).toBe(400);
  });

  it("AC7: rejects unknown field with 400 (strict schema)", async () => {
    const todo = await createTodoViaApi({ title: "X" });
    const res = await request(app)
      .patch(`/api/v1/todos/${todo.id}`)
      .set(authHeader())
      .send({ bogus: "value" });
    expect(res.status).toBe(400);
  });

  it("AC4: marks completed=true then back to false", async () => {
    const todo = await createTodoViaApi({ title: "X", completed: false });
    const r1 = await request(app)
      .patch(`/api/v1/todos/${todo.id}`)
      .set(authHeader())
      .send({ completed: true });
    expect(r1.status).toBe(200);
    expect((r1.body.data as TodoApiRow).completed).toBe(true);

    const r2 = await request(app)
      .patch(`/api/v1/todos/${todo.id}`)
      .set(authHeader())
      .send({ completed: false });
    expect(r2.status).toBe(200);
    expect((r2.body.data as TodoApiRow).completed).toBe(false);
  });
});

describe("DELETE /api/v1/todos/:id - AC5", () => {
  it("AC5: 204 on successful delete", async () => {
    const todo = await createTodoViaApi({ title: "To be deleted" });

    const res = await request(app)
      .delete(`/api/v1/todos/${todo.id}`)
      .set(authHeader());
    expect(res.status).toBe(204);

    // Subsequent GET list confirms removal
    const list = await request(app).get("/api/v1/todos").set(authHeader());
    expect(list.body.data).toHaveLength(0);
  });

  it("AC5: 404 when deleting a non-existent todo", async () => {
    const bogus = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .delete(`/api/v1/todos/${bogus}`)
      .set(authHeader());
    expect(res.status).toBe(404);
  });

  it("AC5: 404 when id is not a uuid", async () => {
    const res = await request(app)
      .delete("/api/v1/todos/xxx")
      .set(authHeader());
    expect(res.status).toBe(404);
  });

  it("AC5: deleting the same todo twice - second call 404", async () => {
    const todo = await createTodoViaApi({ title: "X" });
    const r1 = await request(app)
      .delete(`/api/v1/todos/${todo.id}`)
      .set(authHeader());
    expect(r1.status).toBe(204);

    const r2 = await request(app)
      .delete(`/api/v1/todos/${todo.id}`)
      .set(authHeader());
    expect(r2.status).toBe(404);
  });
});

describe("End-to-end CRUD flow - AC1 + AC2 + AC4 + AC5", () => {
  it("creates, lists, updates, lists, deletes, lists", async () => {
    // create
    const a = await createTodoViaApi({ title: "A", completed: false });
    const b = await createTodoViaApi({ title: "B", completed: true });

    // list (2)
    const list1 = await request(app).get("/api/v1/todos").set(authHeader());
    expect(list1.status).toBe(200);
    expect((list1.body.data as TodoApiRow[]).length).toBe(2);

    // update A - title + completed=true
    const upd = await request(app)
      .patch(`/api/v1/todos/${a.id}`)
      .set(authHeader())
      .send({ title: "A-edited", completed: true });
    expect(upd.status).toBe(200);

    // filter active - both A and B are now completed, so active count = 0
    const activeList = await request(app)
      .get("/api/v1/todos?status=active")
      .set(authHeader());
    expect(activeList.status).toBe(200);
    expect((activeList.body.data as TodoApiRow[]).length).toBe(0);

    // filter completed - both are now completed
    const completedList = await request(app)
      .get("/api/v1/todos?status=completed")
      .set(authHeader());
    expect(completedList.status).toBe(200);
    expect((completedList.body.data as TodoApiRow[]).length).toBe(2);

    // delete B
    const del = await request(app)
      .delete(`/api/v1/todos/${b.id}`)
      .set(authHeader());
    expect(del.status).toBe(204);

    // list (1) - only A remains
    const list2 = await request(app).get("/api/v1/todos").set(authHeader());
    expect(list2.status).toBe(200);
    const finalList = list2.body.data as TodoApiRow[];
    expect(finalList.length).toBe(1);
    expect(finalList[0]!.id).toBe(a.id);
    expect(finalList[0]!.title).toBe("A-edited");
  });
});
