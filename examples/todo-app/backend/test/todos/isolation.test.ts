// test/todos/isolation.test.ts
// Story: S-TODO-01 — cross-user isolation
// Maps to REQ: REQ-007, AC6
//
// Verifies the existence-leak protection: user A's todos are invisible
// to user B for ALL read/update/delete operations. Non-owners always
// receive 404 — never 403 — so an attacker cannot distinguish "todo does
// not exist" from "todo exists but belongs to someone else".
//
// This is the security-critical test for REQ-007. If ANY assertion in
// this file fails, the security invariant is broken.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { setupTestDb, teardownTestDb } from "../_helpers/pgmem.js";
import { createUser, authCookie, type TestUser } from "../_helpers/users.js";
import { createApp } from "../../src/app.js";
import type { IMemoryDb } from "pg-mem";

process.env.BCRYPT_COST = "4";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

let db: IMemoryDb;
let app: ReturnType<typeof createApp>;
let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  db = await setupTestDb();
  app = createApp();
  alice = await createUser(db, { email: "alice@example.com", name: "Alice" });
  bob = await createUser(db, { email: "bob@example.com", name: "Bob" });
});

afterEach(() => {
  teardownTestDb();
});

// --- helpers ---------------------------------------------------------------

function as(user: TestUser): { Cookie: string } {
  return { Cookie: authCookie(user) };
}

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

async function createTodoAs(
  user: TestUser,
  body: Record<string, unknown>,
): Promise<TodoApiRow> {
  const res = await request(app).post("/api/v1/todos").set(as(user)).send(body);
  expect(res.status).toBe(201);
  return res.body.data as TodoApiRow;
}

// --- tests -----------------------------------------------------------------

describe("Cross-user isolation — AC6 / REQ-007", () => {
  it("AC6: user A's todos are NOT visible to user B in GET /todos", async () => {
    // Alice creates two todos
    await createTodoAs(alice, { title: "Alice's secret 1" });
    await createTodoAs(alice, { title: "Alice's secret 2" });
    // Bob creates one todo
    await createTodoAs(bob, { title: "Bob's only todo" });

    // Alice sees 2, Bob sees 1 — they never see each other's
    const aliceRes = await request(app).get("/api/v1/todos").set(as(alice));
    expect(aliceRes.status).toBe(200);
    const aliceTodos = aliceRes.body.data as TodoApiRow[];
    expect(aliceTodos).toHaveLength(2);
    expect(aliceTodos.every((t) => t.user_id === alice.id)).toBe(true);
    expect(aliceTodos.some((t) => t.title === "Bob's only todo")).toBe(false);

    const bobRes = await request(app).get("/api/v1/todos").set(as(bob));
    expect(bobRes.status).toBe(200);
    const bobTodos = bobRes.body.data as TodoApiRow[];
    expect(bobTodos).toHaveLength(1);
    expect(bobTodos[0]!.user_id).toBe(bob.id);
    expect(bobTodos[0]!.title).toBe("Bob's only todo");
  });

  it("AC6: user B GET /todos/:id on Alice's todo → 404 (not 403)", async () => {
    const aliceTodo = await createTodoAs(alice, { title: "Alice's secret" });

    // Alice can fetch her own todo
    const aliceFetch = await request(app)
      .get(`/api/v1/todos/${aliceTodo.id}`)
      .set(as(alice));
    expect(aliceFetch.status).toBe(200);

    // Bob cannot fetch Alice's todo — gets 404, NOT 403
    const bobFetch = await request(app)
      .get(`/api/v1/todos/${aliceTodo.id}`)
      .set(as(bob));
    expect(bobFetch.status).toBe(404);
    expect(bobFetch.body.error).toBe("not_found");
  });

  it("AC6: user B PATCH /todos/:id on Alice's todo → 404 (no mutation)", async () => {
    const aliceTodo = await createTodoAs(alice, {
      title: "Original",
      completed: false,
    });

    // Bob attempts to hijack the todo
    const bobPatch = await request(app)
      .patch(`/api/v1/todos/${aliceTodo.id}`)
      .set(as(bob))
      .send({ title: "Pwned by Bob", completed: true });
    expect(bobPatch.status).toBe(404);
    expect(bobPatch.body.error).toBe("not_found");

    // Alice's todo is unchanged — fetch as Alice to confirm
    const aliceFetch = await request(app)
      .get(`/api/v1/todos/${aliceTodo.id}`)
      .set(as(alice));
    expect(aliceFetch.status).toBe(200);
    const fetched = aliceFetch.body.data as TodoApiRow;
    expect(fetched.title).toBe("Original");
    expect(fetched.completed).toBe(false);
  });

  it("AC6: user B DELETE /todos/:id on Alice's todo → 404 (no deletion)", async () => {
    const aliceTodo = await createTodoAs(alice, { title: "Alice's todo" });

    // Bob attempts to delete Alice's todo
    const bobDelete = await request(app)
      .delete(`/api/v1/todos/${aliceTodo.id}`)
      .set(as(bob));
    expect(bobDelete.status).toBe(404);
    expect(bobDelete.body.error).toBe("not_found");

    // Alice's todo still exists — fetch as Alice
    const aliceFetch = await request(app)
      .get(`/api/v1/todos/${aliceTodo.id}`)
      .set(as(alice));
    expect(aliceFetch.status).toBe(200);
    expect((aliceFetch.body.data as TodoApiRow).id).toBe(aliceTodo.id);
  });

  it("AC6: row count is correct after attempted cross-user operations", async () => {
    // Each user has 1 todo
    const aliceTodo = await createTodoAs(alice, { title: "Alice's" });
    await createTodoAs(bob, { title: "Bob's" });

    // Bob tries every cross-user op on Alice's todo
    await request(app).get(`/api/v1/todos/${aliceTodo.id}`).set(as(bob)).expect(404);
    await request(app)
      .patch(`/api/v1/todos/${aliceTodo.id}`)
      .set(as(bob))
      .send({ title: "x" })
      .expect(404);
    await request(app).delete(`/api/v1/todos/${aliceTodo.id}`).set(as(bob)).expect(404);

    // Direct DB assertion: todos table still has exactly 2 rows
    const rows = db.public.many(`SELECT count(*)::int AS c FROM todos`) as Array<{
      c: number;
    }>;
    expect(rows[0]!.c).toBe(2);
  });

  it("AC6: ?status filter is also user-scoped", async () => {
    // Alice has 1 completed + 1 active; Bob has 0 completed
    await createTodoAs(alice, { title: "Alice done", completed: true });
    await createTodoAs(alice, { title: "Alice active", completed: false });
    await createTodoAs(bob, { title: "Bob active", completed: false });

    // Bob asks for completed → must NOT see Alice's completed todo
    const res = await request(app)
      .get("/api/v1/todos?status=completed")
      .set(as(bob));
    expect(res.status).toBe(200);
    expect((res.body.data as TodoApiRow[])).toHaveLength(0);

    // Alice asks for completed → sees only hers (1)
    const aliceRes = await request(app)
      .get("/api/v1/todos?status=completed")
      .set(as(alice));
    expect(aliceRes.status).toBe(200);
    const completed = aliceRes.body.data as TodoApiRow[];
    expect(completed).toHaveLength(1);
    expect(completed[0]!.user_id).toBe(alice.id);
  });
});
