// test/auth/refresh.test.ts
// Story: S-AUTH-05 — POST /api/v1/auth/refresh
// Maps to REQ: REQ-003-AC1, REQ-003-AC2
//
// Tests the refresh-token rotation endpoint. AC1 verifies that a valid
// refresh cookie produces a new (access, refresh) pair and revokes the
// old row. AC2 verifies that replaying the old refresh token returns 401
// (the canonical "attacker stole a rotated token" signal).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { setupTestDb, teardownTestDb } from "../_helpers/pgmem.js";
import { createApp } from "../../src/app.js";
import {
  hashPassword,
  signRefreshToken,
  hashRefreshToken,
  newJti,
} from "../../src/services/auth.service.js";
import { env } from "../../src/config/env.js";
import type { IMemoryDb } from "pg-mem";

process.env.BCRYPT_COST = "4";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

const KNOWN_PASSWORD = "correct-horse-battery-staple";
const KNOWN_EMAIL = "ada@example.com";

let db: IMemoryDb;
let app: ReturnType<typeof createApp>;
let seededUserId: string;

beforeEach(async () => {
  db = await setupTestDb();
  app = createApp();

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
});

afterEach(() => {
  teardownTestDb();
});

// --- helpers ---------------------------------------------------------------

/**
 * Insert a refresh-token row directly into the DB. Returns the raw JWT
 * so the test can set it as a cookie. This bypasses /login so we can
 * control the token's exact state (e.g. pre-revoked, expired).
 *
 * NOTE: we mint an explicit id here because pg-mem's gen_random_uuid()
 * can collide across multiple inserts within one test session. Real
 * Postgres would work without this workaround.
 */
function mintRefreshToken(
  opts: {
    revokedAt?: Date | null;
    expiresAt?: Date;
  } = {},
): string {
  const rowId = crypto.randomUUID();
  const jti = newJti();
  const raw = signRefreshToken({ sub: seededUserId, jti });
  const hash = hashRefreshToken(raw);
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + env.refreshTokenTtlSec * 1000);
  const revokedAt = opts.revokedAt ?? null;

  const sqlRowId = `'${rowId.replace(/'/g, "''")}'::uuid`;
  const sqlUserId = `'${seededUserId.replace(/'/g, "''")}'::uuid`;
  const sqlHash = `'${hash}'`;
  const sqlExpires = `'${expiresAt.toISOString()}'`;
  const sqlRevoked = revokedAt ? `'${revokedAt.toISOString()}'` : "NULL";
  db.public.none(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at)
     VALUES (${sqlRowId}, ${sqlUserId}, ${sqlHash}, ${sqlExpires}, ${sqlRevoked})`,
  );
  return raw;
}

function countRefreshTokens(): number {
  const rows = db.public.many(
    `SELECT count(*)::int AS c FROM refresh_tokens`,
  ) as Array<{ c: number }>;
  return rows[0]?.c ?? 0;
}

function countActiveRefreshTokens(): number {
  const rows = db.public.many(
    `SELECT count(*)::int AS c FROM refresh_tokens WHERE revoked_at IS NULL`,
  ) as Array<{ c: number }>;
  return rows[0]?.c ?? 0;
}

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

describe("POST /api/v1/auth/refresh — S-AUTH-05", () => {
  it("AC1: valid refresh cookie → 200, new access + refresh cookies set, old refresh revoked in DB", async () => {
    const oldRefresh = mintRefreshToken();

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${oldRefresh}`)
      .expect(200);

    // Body shape: { user, access_token }
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(seededUserId);
    expect(res.body.user.email).toBe(KNOWN_EMAIL);
    expect(typeof res.body.access_token).toBe("string");
    expect(res.body.refresh_token).toBeUndefined(); // refresh is cookie-only

    // Both cookies set.
    const cookies = res.headers["set-cookie"] as string[] | undefined;
    expect(cookies).toBeDefined();
    const newAccess = extractCookieValue(cookies, "access_token");
    const newRefresh = extractCookieValue(cookies, "refresh_token");
    expect(newAccess).toBeDefined();
    expect(newRefresh).toBeDefined();
    expect(newAccess).not.toBe(oldRefresh); // rotation happened
    expect(newRefresh).not.toBe(oldRefresh);

    // DB: exactly 2 rows now (the old revoked + the new active).
    expect(countRefreshTokens()).toBe(2);
    expect(countActiveRefreshTokens()).toBe(1); // only the new one is active
  });

  it("AC2: replay — second call with same original refresh cookie returns 401", async () => {
    const oldRefresh = mintRefreshToken();

    // First call: rotates successfully.
    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${oldRefresh}`)
      .expect(200);

    // Second call with the SAME old token: must fail.
    const replayRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${oldRefresh}`);

    expect(replayRes.status).toBe(401);
    expect(replayRes.body.error).toBe("invalid_refresh");
    expect(replayRes.body.message).toMatch(/invalid or expired refresh token/i);

    // DB state: old token is still revoked, new token is still active.
    expect(countActiveRefreshTokens()).toBe(1);
  });

  it("AC2: manually revoked refresh token (revoked_at set in DB) → /refresh → 401", async () => {
    const revokedNow = new Date();
    const revokedRefresh = mintRefreshToken({ revokedAt: revokedNow });

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${revokedRefresh}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_refresh");
  });

  it("missing refresh cookie → 401", async () => {
    const res = await request(app).post("/api/v1/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_refresh");
  });

  it("malformed refresh cookie (invalid JWT) → 401", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", "refresh_token=not.a.jwt");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_refresh");
  });

  it("refresh cookie for a deleted user → 401", async () => {
    const otherUserId = crypto.randomUUID();
    // Sign a valid refresh token for a user that doesn't exist in the users table.
    // Don't insert it into refresh_tokens — the handler checks findUserById
    // before even looking up the token hash, so it will reject with 401.
    const jti = newJti();
    const orphanRefresh = signRefreshToken({ sub: otherUserId, jti });

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${orphanRefresh}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_refresh");
  });

  it("refresh cookie with wrong JWT signature → 401", async () => {
    // Sign with a different secret.
    const jti = newJti();
    const tamperedToken = jwt.sign(
      { jti },
      "wrong-refresh-secret",
      { subject: seededUserId, expiresIn: env.refreshTokenTtlSec },
    );

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${tamperedToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_refresh");
  });
});
