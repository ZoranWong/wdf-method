// src/routes/auth.ts
// Story: S-AUTH-01 (S-AUTH-03 added /login, S-AUTH-05 added /refresh + /logout)
// Maps to REQ: REQ-001, REQ-002, REQ-003
//
// /api/v1/auth router.
//   POST /register  — S-AUTH-01
//   POST /login     — S-AUTH-03
//   POST /refresh   — S-AUTH-05 (rotation + replay detection)
//   POST /logout    — S-AUTH-05 (revoke refresh + clear cookies)

import { Router, type Request, type Response, type NextFunction } from "express";
import { registerSchema, loginSchema } from "../schemas/auth.js";
import { findUserByEmail, findUserById, createUser } from "../repositories/user.js";
import { storeRefreshToken } from "../repositories/refresh-token.js";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
  newJti,
  rotateRefreshToken,
  revokeRefreshToken,
} from "../services/auth.service.js";
import { env, authCookieOptions, clearAuthCookieOptions } from "../config/env.js";

export const authRouter = Router();

/**
 * Dummy bcrypt hash used when the login email does not match any user.
 *
 * AC2 (REQ-002-AC2): invalid credentials return the same 401 for both
 * "user not found" and "wrong password". If we short-circuited on
 * missing-user by skipping `bcrypt.compare`, an attacker measuring
 * response latency could distinguish "email exists" from "email does
 * not exist" (user enumeration via timing). To close that leak we run
 * `bcrypt.compare` against a real hash of equal cost regardless of
 * whether the user exists; the boolean result is then AND-ed with
 * `user !== null`.
 *
 * The plaintext that produced this hash is irrelevant — we only need a
 * syntactically valid bcrypt hash of the same cost factor so the work
 * factor is identical to the real path.
 */
const DUMMY_BCRYPT_HASH =
  "$2b$12$w4UkLYMQtXduxBy6aiPms.16z91PsJNOH2YzJRNPT3TQ9/3m0m48a";

// --- POST /api/v1/auth/register -------------------------------------------

authRouter.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // AC8: validate input
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "INVALID_INPUT",
          message: "Request body failed validation.",
          details: parsed.error.issues,
        });
        return;
      }
      const { name, email, password } = parsed.data;

      // AC3: reject duplicate email with 409. We use the citext-aware
      // findUserByEmail so 'A@B.com' and 'a@b.com' collide on real PG.
      const existing = await findUserByEmail(email);
      if (existing) {
        res.status(409).json({
          error: "EMAIL_TAKEN",
          message: "An account with this email already exists.",
        });
        return;
      }

      // AC2: bcrypt hash with cost from env (default 12)
      const passwordHash = await hashPassword(password);

      const user = await createUser({ email, passwordHash, name });

      // AC4 + AC6: issue refresh token, hash with SHA-256, store the hash
      const jti = newJti();
      const refreshToken = signRefreshToken({ sub: user.id, jti });
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const refreshExpiresAt = new Date(
        Date.now() + env.refreshTokenTtlSec * 1000,
      );
      await storeRefreshToken({
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: refreshExpiresAt,
      });

      // AC4: also sign an access token (no DB row — JWTs are stateless)
      const accessToken = signAccessToken({ sub: user.id, email: user.email });

      // AC5: set httpOnly cookies
      res.cookie(
        "access_token",
        accessToken,
        authCookieOptions(env.accessTokenTtlSec),
      );
      res.cookie(
        "refresh_token",
        refreshToken,
        authCookieOptions(env.refreshTokenTtlSec),
      );

      // AC7: response body — refresh_token is cookie-only, never in body
      res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          created_at: user.createdAt.toISOString(),
        },
        access_token: accessToken,
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- POST /api/v1/auth/login ------------------------------------------------
// Story: S-AUTH-03 / REQ-002
//
// AC1 + AC3: on valid credentials, issue a fresh access_token (15 min)
// and refresh_token (7 days) as cookies, return 200 with `{user,
// access_token}` (refresh is cookie-only — never in body, same shape
// as /register).
//
// AC2: invalid credentials — whether the email is unknown OR the
// password is wrong — return the SAME 401 body. We deliberately run
// bcrypt.compare against DUMMY_BCRYPT_HASH when the user does not
// exist so the work factor is constant and a timing attacker cannot
// tell "user not found" from "wrong password".
//
// AC4: refresh token is persisted as a SHA-256 hash in refresh_tokens
// (same pattern as /register) — never the raw JWT string.

authRouter.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "INVALID_INPUT",
          message: "Request body failed validation.",
          details: parsed.error.issues,
        });
        return;
      }
      const { email, password } = parsed.data;

      const user = await findUserByEmail(email);

      // Always run bcrypt.compare against a real cost-N hash so the
      // response-time distribution is the same whether or not the user
      // exists. This closes the user-enumeration-via-timing side channel.
      const passwordHash = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
      const passwordOk = await verifyPassword(password, passwordHash);

      if (!user || !passwordOk) {
        // AC2: identical response for "user not found" and "wrong password".
        res.status(401).json({
          error: "invalid_credentials",
          message: "Invalid email or password.",
        });
        return;
      }

      // AC3 + AC4: issue refresh token, hash with SHA-256, persist the hash.
      const jti = newJti();
      const refreshToken = signRefreshToken({ sub: user.id, jti });
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const refreshExpiresAt = new Date(
        Date.now() + env.refreshTokenTtlSec * 1000,
      );
      await storeRefreshToken({
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: refreshExpiresAt,
      });

      // AC3: access token (15 min). Stateless JWT, no DB row.
      const accessToken = signAccessToken({ sub: user.id, email: user.email });

      // AC1: set both as httpOnly cookies — same options as /register.
      res.cookie(
        "access_token",
        accessToken,
        authCookieOptions(env.accessTokenTtlSec),
      );
      res.cookie(
        "refresh_token",
        refreshToken,
        authCookieOptions(env.refreshTokenTtlSec),
      );

      // AC1: 200 with {user, access_token}. Refresh token is cookie-only.
      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          created_at: user.createdAt.toISOString(),
        },
        access_token: accessToken,
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- POST /api/v1/auth/refresh ---------------------------------------------
// Story: S-AUTH-05 / REQ-003-AC1 + REQ-003-AC2
//
// AC1: a VALID refresh cookie is rotated into a new (access, refresh)
//   pair. The OLD refresh row is marked revoked_at=now() BEFORE the
//   new tokens are issued — so a partial failure cannot leave two
//   active refresh tokens for the same session.
//
// AC2: replay detection. If the presented refresh token's hash matches
//   a row whose revoked_at is non-null, we refuse with 401. This is
//   the canonical "the legitimate user already rotated away from this
//   token; the request is either an attacker with a stolen token or
//   a buggy client" signal.
//
// The response body intentionally uses a generic message for ALL
// failure modes (missing cookie / tampered JWT / unknown hash / already
// revoked / expired). Echoing the specific reason would let an
// attacker probe token state.

function readRefreshCookie(req: Request): string | null {
  const ck = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (ck && typeof ck.refresh_token === "string" && ck.refresh_token.length > 0) {
    return ck.refresh_token;
  }
  return null;
}

authRouter.post(
  "/refresh",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawRefresh = readRefreshCookie(req);
      if (!rawRefresh) {
        res.status(401).json({
          error: "invalid_refresh",
          message: "Invalid or expired refresh token.",
        });
        return;
      }

      // First decode the JWT subject (without DB) so we know which user
      // the token claims to be. A bad signature throws here; we treat
      // that the same as any other invalid token -> 401 generic.
      // We re-decode inside rotateRefreshToken too, but we need the
      // user lookup to happen first because rotateRefreshToken expects
      // an already-resolved {id, email}. Doing the lookup here keeps
      // rotateRefreshToken pure-ish.
      let claims: { sub: string };
      try {
        claims = verifyRefreshToken(rawRefresh);
      } catch {
        res.status(401).json({
          error: "invalid_refresh",
          message: "Invalid or expired refresh token.",
        });
        return;
      }

      const user = await findUserById(claims.sub);
      if (!user) {
        res.status(401).json({
          error: "invalid_refresh",
          message: "Invalid or expired refresh token.",
        });
        return;
      }

      const result = await rotateRefreshToken(rawRefresh, {
        id: user.id,
        email: user.email,
      });

      if (!result.ok || !result.accessToken || !result.refreshToken) {
        res.status(401).json({
          error: "invalid_refresh",
          message: "Invalid or expired refresh token.",
        });
        return;
      }

      // Set the new cookies with the SAME options used by /login.
      res.cookie(
        "access_token",
        result.accessToken,
        authCookieOptions(env.accessTokenTtlSec),
      );
      res.cookie(
        "refresh_token",
        result.refreshToken,
        authCookieOptions(env.refreshTokenTtlSec),
      );

      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          created_at: user.createdAt.toISOString(),
        },
        access_token: result.accessToken,
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- POST /api/v1/auth/logout ----------------------------------------------
// Story: S-AUTH-05 / REQ-003-AC3
//
// Always returns 200 (or 204) — logout MUST NOT leak whether the user
// was actually authenticated. We try to revoke the refresh token row
// (cookie present -> hash -> UPDATE revoked_at), and regardless of
// outcome we clear BOTH cookies with the same options used to set them
// so the browser actually deletes them.

authRouter.post(
  "/logout",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawRefresh = readRefreshCookie(req);
      if (rawRefresh) {
        // revokeRefreshToken is tolerant of bad JWTs — it hashes the
        // raw value and updates the matching row, so even a tampered
        // cookie does not throw here.
        try {
          await revokeRefreshToken(rawRefresh);
        } catch {
          // Swallow DB errors here — logout must still clear cookies
          // and return 200 even if the DB is briefly unavailable.
        }
      }

      // Always clear both cookies. The path / sameSite / secure flags
      // MUST match the values used at set-time or the browser keeps
      // the cookie; clearAuthCookieOptions() mirrors authCookieOptions
      // minus the (ignored on clear) maxAge.
      res.clearCookie("access_token", clearAuthCookieOptions());
      res.clearCookie("refresh_token", clearAuthCookieOptions());

      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default authRouter;
