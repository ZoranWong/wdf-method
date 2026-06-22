// test/auth/login.test.ts
// Story: S-AUTH-03 — POST /api/v1/auth/login
// Maps to REQ: REQ-002
//
// Mirrors register.test.ts structure. Users are seeded via direct
// SQL INSERT (using pg-mem's parameterless `.public.none(...)`) with
// a REAL bcrypt hash, so we can assert against a known plaintext
// password without first calling /register.
//
// BCRYPT_COST=4 keeps the suite sub-second.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { setupTestDb, teardownTestDb } from "../_helpers/pgmem.js";
import { createApp } from "../../src/app.js";
import {
  hashPassword,
  hashRefreshToken,
} from "../../src/services/auth.service.js";
import type { IMemoryDb } from "pg-mem";

// Force cheap bcrypt BEFORE the app modules cache their cost value.
process.env.BCRYPT_COST = "4";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

const KNOWN_PASSWORD = "correct-horse-battery-staple";
const KNOWN_EMAIL = "ada@example.com";

let db: IMemoryDb;
let app: ReturnType<typeof createApp>;
let seededUserId: string;
let seededUserCreatedAt: string;

beforeEach(async () => {
  db = await setupTestDb();
  app = createApp();

  // Seed a user with a known plaintext password. We compute the bcrypt
  // hash the same way /register would so verifyPassword() in the route
  // handler returns true for KNOWN_PASSWORD.
  const passwordHash = await hashPassword(KNOWN_PASSWORD);
  seededUserId = crypto.randomUUID();
  const sqlId = `'${seededUserId.replace(/'/g, "''")}'::uuid`;
  const sqlEmail = `'${KNOWN_EMAIL.replace(/'/g, "''")}'`;
  const sqlName = `'Ada Lovelace'`;
  const sqlHash = `'${passwordHash.replace(/'/g, "''")}'`;
  db.public.none(
    `INSERT INTO users (id, email, password_hash, name)
     VALUES (${sqlId}, ${sqlEmail}, ${sqlHash}, ${sqlName})`,
  );

  // Read back the created_at the DB assigned so response-body assertions
  // can compare exactly.
  const rows = db.public.many(
    `SELECT created_at FROM users WHERE id = '${seededUserId}'`,
  ) as Array<{ created_at: Date }>;
  seededUserCreatedAt = rows[0]!.created_at.toISOString();
});

afterEach(() => {
  teardownTestDb();
});

// --- helpers ---------------------------------------------------------------

function validBody() {
  return { email: KNOWN_EMAIL, password: KNOWN_PASSWORD };
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

/** Extract raw token value from a `name=<jwt>; Path=/; HttpOnly` cookie header. */
function extractCookieValue(
  cookies: string[] | undefined,
  name: string,
): string | undefined {
  if (!cookies) return undefined;
  const c = cookies.find((s) => s.startsWith(`${name}=`));
  if (!c) return undefined;
  return c.split("=")[1]!.split(";")[0];
}

// --- tests -----------------------------------------------------------------

describe("POST /api/v1/auth/login — S-AUTH-03", () => {
  it("AC1: 200 on valid credentials, returns user + access_token, sets both cookies", async () => {
    const res = await request(app).post("/api/v1/auth/login").send(validBody());

    expect(res.status).toBe(200);

    // Body shape: { user, access_token } — refresh is cookie-only.
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(seededUserId);
    expect(res.body.user.email).toBe(KNOWN_EMAIL);
    expect(res.body.user.name).toBe("Ada Lovelace");
    expect(res.body.user.created_at).toBe(seededUserCreatedAt);
    expect(typeof res.body.access_token).toBe("string");
    expect(res.body.access_token.length).toBeGreaterThan(0);
    expect(res.body.refresh_token).toBeUndefined();

    // Both cookies present and httpOnly.
    const cookies = res.headers["set-cookie"] as string[] | undefined;
    expect(cookies).toBeDefined();
    expect(cookies!.length).toBeGreaterThanOrEqual(2);
    const accessCookie = cookies!.find((c) => c.startsWith("access_token="));
    const refreshCookie = cookies!.find((c) => c.startsWith("refresh_token="));
    expect(accessCookie).toBeDefined();
    expect(refreshCookie).toBeDefined();
    expect(accessCookie!).toMatch(/httponly/i);
    expect(refreshCookie!).toMatch(/httponly/i);

    // No password/hash leak in body.
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("AC2: wrong password returns 401 with generic 'invalid_credentials' error", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: KNOWN_EMAIL, password: "wrong-password-here" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
    // Generic message — does NOT echo email or say "user not found" vs
    // "password wrong".
    expect(res.body.message).toMatch(/invalid email or password/i);
    expect(JSON.stringify(res.body)).not.toContain(KNOWN_EMAIL);
  });

  it("AC2: nonexistent email returns 401 — IDENTICAL body shape to wrong password (no user enumeration)", async () => {
    const wrongPasswordRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: KNOWN_EMAIL, password: "wrong-password-here" });

    const unknownEmailRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "any-password" });

    expect(unknownEmailRes.status).toBe(401);
    expect(unknownEmailRes.body.error).toBe("invalid_credentials");

    // The two failure responses must be byte-identical in BODY (same
    // status, same error code, same message). The only acceptable
    // difference would be a request-id header; the JSON body MUST deep-equal.
    expect(unknownEmailRes.body).toEqual(wrongPasswordRes.body);
    // Explicit deep-equal on the entire body — also assert via JSON
    // string to be paranoid about key ordering / extras.
    expect(JSON.stringify(unknownEmailRes.body)).toBe(
      JSON.stringify(wrongPasswordRes.body),
    );
  });

  it("AC2: failed login MUST NOT write a refresh_tokens row", async () => {
    expect(countRefreshTokens()).toBe(0);
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: KNOWN_EMAIL, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(countRefreshTokens()).toBe(0);
  });

  it("AC3: access token expires in 15 minutes, refresh token in 7 days", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await request(app).post("/api/v1/auth/login").send(validBody());
    expect(res.status).toBe(200);

    const cookies = res.headers["set-cookie"] as unknown as string[];
    const rawAccess = extractCookieValue(cookies, "access_token")!;
    const rawRefresh = extractCookieValue(cookies, "refresh_token")!;
    const after = Math.floor(Date.now() / 1000);

    const accessPayload = jwt.verify(rawAccess, "test-secret") as {
      exp: number;
      iat: number;
    };
    const refreshPayload = jwt.verify(rawRefresh, "test-refresh-secret") as {
      exp: number;
      iat: number;
    };

    // Access: 15 min = 900 sec
    const accessTtl = accessPayload.exp - accessPayload.iat;
    expect(accessTtl).toBe(15 * 60);
    expect(accessPayload.exp).toBeGreaterThanOrEqual(before + 15 * 60 - 5);
    expect(accessPayload.exp).toBeLessThanOrEqual(after + 15 * 60 + 5);

    // Refresh: 7 days = 604800 sec
    const refreshTtl = refreshPayload.exp - refreshPayload.iat;
    expect(refreshTtl).toBe(7 * 24 * 60 * 60);
    expect(refreshPayload.exp).toBeGreaterThanOrEqual(
      before + 7 * 24 * 60 * 60 - 5,
    );
    expect(refreshPayload.exp).toBeLessThanOrEqual(
      after + 7 * 24 * 60 * 60 + 5,
    );
  });

  it("AC4: refresh token is stored hashed in refresh_tokens (NOT raw)", async () => {
    const res = await request(app).post("/api/v1/auth/login").send(validBody());
    expect(res.status).toBe(200);

    const cookies = res.headers["set-cookie"] as unknown as string[];
    const rawRefresh = extractCookieValue(cookies, "refresh_token")!;
    expect(rawRefresh.length).toBeGreaterThan(0);

    // Exactly one row inserted by this login.
    expect(countRefreshTokens()).toBe(1);

    const hashes = getStoredRefreshTokenHashes();
    expect(hashes).toHaveLength(1);
    // SHA-256 hex = 64 chars.
    expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/);
    // Stored value must equal sha256(rawRefresh) and NOT be the raw JWT.
    expect(hashes[0]).toBe(hashRefreshToken(rawRefresh));
    expect(hashes[0]).not.toBe(rawRefresh);
  });

  it("AC4: refresh_tokens row is associated with the correct user_id", async () => {
    const res = await request(app).post("/api/v1/auth/login").send(validBody());
    expect(res.status).toBe(200);

    const rows = db.public.many(
      `SELECT user_id, revoked_at, expires_at FROM refresh_tokens`,
    ) as Array<{ user_id: string; revoked_at: Date | null; expires_at: Date }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(seededUserId);
    expect(rows[0]!.revoked_at).toBeNull();
    // Refresh expires ~7d from now.
    const ttlMs = rows[0]!.expires_at.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000); // > 6d
    expect(ttlMs).toBeLessThan(8 * 24 * 60 * 60 * 1000); // < 8d
  });

  // --- validation (AC bonus, not strictly mandated but mirrors register) ----

  it("returns 400 INVALID_INPUT when email is missing", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ password: KNOWN_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it("returns 400 INVALID_INPUT when password is missing", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: KNOWN_EMAIL });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT when email is malformed", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: KNOWN_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT when body is empty", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("does not issue a refresh_tokens row on validation failure", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "x" });
    expect(res.status).toBe(400);
    expect(countRefreshTokens()).toBe(0);
  });
});
