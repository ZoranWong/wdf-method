// test/auth/register.test.ts
// Story: S-AUTH-01 — POST /api/v1/auth/register
// Maps to REQ: REQ-001
//
// Uses supertest + the pg-mem harness in test/_helpers/pgmem.ts.
// BCRYPT_COST is forced to 4 (see top of file) so the suite runs in
// well under a second.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { setupTestDb, teardownTestDb } from "../_helpers/pgmem.js";
import { createApp } from "../../src/app.js";
import { hashRefreshToken } from "../../src/services/auth.service.js";
import type { IMemoryDb } from "pg-mem";

// Force cheap bcrypt BEFORE the app modules cache their cost value.
// env.ts reads process.env.BCRYPT_COST at module load.
process.env.BCRYPT_COST = "4";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

let db: IMemoryDb;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await setupTestDb();
  app = createApp();
});

afterEach(() => {
  teardownTestDb();
});

// --- helpers ---------------------------------------------------------------

function validBody() {
  return {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "correct-horse-battery-staple",
  };
}

function countRefreshTokens(): number {
  const rows = db.public.many(
    `SELECT count(*)::int AS c FROM refresh_tokens`,
  ) as Array<{ c: number }>;
  return rows[0]?.c ?? 0;
}

function getStoredRefreshTokenHashes(): string[] {
  const rows = db.public.many(
    `SELECT token_hash FROM refresh_tokens`,
  ) as Array<{ token_hash: string }>;
  return rows.map((r) => r.token_hash);
}

// --- tests -----------------------------------------------------------------

describe("POST /api/v1/auth/register — S-AUTH-01", () => {
  it("AC1 + AC4 + AC7: 201 on valid input, returns user + access_token", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(res.body.user.email).toBe("ada@example.com");
    expect(res.body.user.name).toBe("Ada Lovelace");
    expect(res.body.user.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // AC7: refresh_token is NOT in the body
    expect(res.body.refresh_token).toBeUndefined();
    // AC7: access_token IS in the body
    expect(typeof res.body.access_token).toBe("string");
    expect(res.body.access_token.length).toBeGreaterThan(0);
  });

  it("AC2: password is hashed with bcrypt before persistence", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(validBody());
    expect(res.status).toBe(201);

    // Direct DB assertion: password_hash column must NOT equal the plaintext
    // and must look like a bcrypt hash ($2b$ prefix).
    const rows = db.public.many(
      `SELECT password_hash FROM users WHERE email = 'ada@example.com'`,
    ) as Array<{ password_hash: string }>;
    expect(rows).toHaveLength(1);
    const hash = rows[0]!.password_hash;
    expect(hash).not.toBe(validBody().password);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    // cost factor 4 (test override)
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
  });

  it("AC3: 409 when email already exists", async () => {
    const first = await request(app)
      .post("/api/v1/auth/register")
      .send(validBody());
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/auth/register")
      .send(validBody()); // same email
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("EMAIL_TAKEN");
  });

  it("AC3: 409 message is generic enough to not leak user existence", async () => {
    // Register
    await request(app).post("/api/v1/auth/register").send(validBody());
    // Re-register same email
    const second = await request(app)
      .post("/api/v1/auth/register")
      .send(validBody());
    expect(second.status).toBe(409);
    // Spec: "message 明确" — we DO say it's an email collision, but we
    // do NOT echo the offending email back.
    expect(second.body.message).toMatch(/already exists/i);
    expect(JSON.stringify(second.body)).not.toContain(validBody().email);
  });

  it("AC5: access_token + refresh_token are set as httpOnly cookies", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(validBody());
    expect(res.status).toBe(201);

    const cookies = res.headers["set-cookie"] as string[] | undefined;
    expect(cookies).toBeDefined();
    expect(cookies!.length).toBeGreaterThanOrEqual(2);

    const accessCookie = cookies!.find((c) => c.startsWith("access_token="));
    const refreshCookie = cookies!.find((c) => c.startsWith("refresh_token="));
    expect(accessCookie).toBeDefined();
    expect(refreshCookie).toBeDefined();
    // httpOnly flag on both
    expect(accessCookie!).toMatch(/httponly/i);
    expect(refreshCookie!).toMatch(/httponly/i);
  });

  it("AC6: refresh token is stored in DB as a SHA-256 hash, not plaintext", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(validBody());
    expect(res.status).toBe(201);

    // Extract the raw refresh_token from the cookie header
    const cookies = res.headers["set-cookie"] as string[];
    const refreshCookie = cookies!.find((c) => c.startsWith("refresh_token="))!;
    // Cookie string looks like: refresh_token=<jwt>; Path=/; HttpOnly; ...
    const rawToken = refreshCookie.split("=")[1]!.split(";")[0]!;
    expect(rawToken.length).toBeGreaterThan(0);

    // Exactly one refresh_tokens row
    expect(countRefreshTokens()).toBe(1);

    // The stored hash equals sha256(rawToken)
    const hashes = getStoredRefreshTokenHashes();
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toBe(hashRefreshToken(rawToken));
    // 64 hex chars = SHA-256 hex digest length
    expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/);

    // The raw token is NOT stored anywhere
    const allRows = db.public.many(`SELECT token_hash FROM refresh_tokens`) as Array<{
      token_hash: string;
    }>;
    for (const r of allRows) {
      expect(r.token_hash).not.toBe(rawToken);
    }
  });

  it("AC8: 400 when name is missing", async () => {
    const body = validBody();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { name: _name, ...withoutName } = body;
    void _name;
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(withoutName);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it("AC8: 400 when name is empty string", async () => {
    const body = { ...validBody(), name: "" };
    const res = await request(app).post("/api/v1/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("AC8: 400 when name exceeds 120 chars", async () => {
    const body = { ...validBody(), name: "x".repeat(121) };
    const res = await request(app).post("/api/v1/auth/register").send(body);
    expect(res.status).toBe(400);
  });

  it("AC8: 400 when email is invalid", async () => {
    const body = { ...validBody(), email: "not-an-email" };
    const res = await request(app).post("/api/v1/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("AC8: 400 when password is shorter than 8 chars", async () => {
    const body = { ...validBody(), password: "short" };
    const res = await request(app).post("/api/v1/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("AC9: response matches the OpenAPI RegisterInput/User contract", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(validBody());
    expect(res.status).toBe(201);

    // User schema: required [id, email, name, created_at]
    const user = res.body.user;
    expect(typeof user.id).toBe("string");
    expect(typeof user.email).toBe("string");
    expect(typeof user.name).toBe("string");
    expect(typeof user.created_at).toBe("string");
    // No password/hash leak
    expect(user.password).toBeUndefined();
    expect(user.password_hash).toBeUndefined();
    expect(user.passwordHash).toBeUndefined();
  });

  it("does not issue a refresh_token row on validation failure", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validBody(), password: "short" });
    expect(res.status).toBe(400);
    expect(countRefreshTokens()).toBe(0);
  });

  it("does not issue a refresh_token row on email-collision failure", async () => {
    await request(app).post("/api/v1/auth/register").send(validBody());
    expect(countRefreshTokens()).toBe(1); // from the successful first call

    const second = await request(app)
      .post("/api/v1/auth/register")
      .send(validBody());
    expect(second.status).toBe(409);
    // Still exactly one — the failed call MUST not have written a row.
    expect(countRefreshTokens()).toBe(1);
  });
});
