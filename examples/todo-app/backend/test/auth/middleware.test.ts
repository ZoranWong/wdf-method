// test/auth/middleware.test.ts
// Story: S-AUTH-05 — requireAuth middleware
// Maps to REQ: REQ-003-AC4, REQ-003-AC5
//
// AC4: requireAuth returns 401 (no req.user) when access token is
//   missing / expired / tampered / malformed.
// AC5: on a valid token, req.user = { sub, email } is populated.
//
// We mount a tiny probe route behind requireAuth so we can observe the
// middleware's side effect (req.user) without coupling to any concrete
// route handler.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { setupTestDb, teardownTestDb } from "../_helpers/pgmem.js";
import { requireAuth } from "../../src/middleware/auth.js";
import {
  hashPassword,
  signAccessToken,
} from "../../src/services/auth.service.js";
import { env } from "../../src/config/env.js";
import type { IMemoryDb } from "pg-mem";

process.env.BCRYPT_COST = "4";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

let db: IMemoryDb;
let probeApp: express.Express;
let seededUserId: string;
let seededEmail: string;

beforeEach(async () => {
  db = await setupTestDb();
  probeApp = express();
  probeApp.use(express.json());
  probeApp.use(cookieParser()); // ← required so req.cookies is populated

  // A bare probe route behind requireAuth that echoes the user attached
  // by the middleware. Mounting this in isolation lets us test the
  // middleware's contract (AC4 + AC5) without pulling in the full app.
  probeApp.get(
    "/test-mw",
    requireAuth,
    (req, res) => {
      res.json({ user: req.user });
    },
  );

  seededUserId = crypto.randomUUID();
  seededEmail = "ada@example.com";
  const passwordHash = await hashPassword("x");
  const sqlId = `'${seededUserId.replace(/'/g, "''")}'::uuid`;
  const sqlEmail = `'${seededEmail.replace(/'/g, "''")}'`;
  const sqlName = `'Ada'`;
  const sqlHash = `'${passwordHash.replace(/'/g, "''")}'`;
  db.public.none(
    `INSERT INTO users (id, email, password_hash, name)
     VALUES (${sqlId}, ${sqlEmail}, ${sqlHash}, ${sqlName})`,
  );
});

afterEach(() => {
  teardownTestDb();
});

// --- tests -----------------------------------------------------------------

describe("requireAuth middleware — S-AUTH-05", () => {
  it("AC5: valid access cookie → req.user = { sub, email }", async () => {
    const validToken = signAccessToken({ sub: seededUserId, email: seededEmail });

    const res = await request(probeApp)
      .get("/test-mw")
      .set("Cookie", `access_token=${validToken}`)
      .expect(200);

    expect(res.body.user).toBeDefined();
    expect(res.body.user.sub).toBe(seededUserId);
    expect(res.body.user.email).toBe(seededEmail);
  });

  it("AC5: valid Bearer authorization header → req.user populated", async () => {
    const validToken = signAccessToken({ sub: seededUserId, email: seededEmail });

    const res = await request(probeApp)
      .get("/test-mw")
      .set("Authorization", `Bearer ${validToken}`)
      .expect(200);

    expect(res.body.user).toBeDefined();
    expect(res.body.user.sub).toBe(seededUserId);
    expect(res.body.user.email).toBe(seededEmail);
  });

  it("AC4: no cookie and no Authorization header → 401, no user", async () => {
    const res = await request(probeApp).get("/test-mw");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    expect(res.body.user).toBeUndefined();
  });

  it("AC4: expired access token → 401", async () => {
    // Sign a token that expired 60 seconds ago.
    const expiredToken = jwt.sign(
      { email: seededEmail },
      "test-secret",
      {
        subject: seededUserId,
        expiresIn: -60, // iat = now - 60s, exp = now
      },
    );

    const res = await request(probeApp)
      .get("/test-mw")
      .set("Cookie", `access_token=${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("AC4: tampered signature (signed with wrong secret) → 401", async () => {
    const tamperedToken = jwt.sign(
      { email: seededEmail },
      "wrong-secret",
      { subject: seededUserId, expiresIn: env.accessTokenTtlSec },
    );

    const res = await request(probeApp)
      .get("/test-mw")
      .set("Cookie", `access_token=${tamperedToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("AC4: malformed JWT (not a JWT at all) → 401", async () => {
    const res = await request(probeApp)
      .get("/test-mw")
      .set("Cookie", "access_token=this-is-not-a-jwt");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("AC4: empty Bearer token → 401 (falls through to missing-cookie path)", async () => {
    const res = await request(probeApp)
      .get("/test-mw")
      .set("Authorization", "Bearer ");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });
});
