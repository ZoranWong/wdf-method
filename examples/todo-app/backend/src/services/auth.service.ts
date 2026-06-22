// src/services/auth.service.ts
// Story: S-AUTH-01 (S-AUTH-05 added rotateRefreshToken / revokeRefreshTokenByHash)
// Maps to REQ: REQ-001, REQ-003
//
// Helpers around bcrypt + jsonwebtoken + node:crypto. S-AUTH-01/03 used
// the pure crypto/JWT helpers from here; S-AUTH-05 adds two small
// DB-aware helpers (rotateRefreshToken, revokeRefreshTokenByHash) so
// the /refresh and /logout route handlers stay declarative. The DB
// helpers live here instead of in repositories/refresh-token.ts because
// they need to compose verifyRefreshToken + hashRefreshToken + the DB
// query — keeping them in scope of S-AUTH-05.

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createHash, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { getQuery } from "../db/client.js";

// --- password hashing ------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.bcryptCost);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// --- JWT -------------------------------------------------------------------

export interface AccessTokenClaims {
  sub: string; // user id
  email: string;
}

export interface RefreshTokenClaims {
  sub: string; // user id
  jti: string; // refresh token id (used to look up the hash row)
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign({ email: claims.email }, env.jwtSecret, {
    subject: claims.sub,
    expiresIn: env.accessTokenTtlSec,
  });
}

export function signRefreshToken(claims: RefreshTokenClaims): string {
  return jwt.sign({ jti: claims.jti }, env.jwtRefreshSecret, {
    subject: claims.sub,
    expiresIn: env.refreshTokenTtlSec,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, env.jwtSecret) as AccessTokenClaims & {
    iat?: number;
    exp?: number;
  };
  return { sub: payload.sub, email: payload.email };
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const payload = jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenClaims & {
    iat?: number;
    exp?: number;
  };
  return { sub: payload.sub, jti: payload.jti };
}

/** Generate a new jti for refresh tokens. */
export function newJti(): string {
  return randomUUID();
}

// --- refresh token hashing -------------------------------------------------

/**
 * Hash a refresh token with SHA-256 before storing it. We never store the
 * raw refresh token in the DB: if the DB leaks, attackers cannot forge
 * valid refresh tokens. SHA-256 is sufficient because the JWT signature
 * already provides unforgeability — the hash here is for at-rest secrecy.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// --- refresh token rotation / revocation (S-AUTH-05) ----------------------

interface RefreshRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

async function findRefreshTokenByHash(
  tokenHash: string,
): Promise<RefreshRow | null> {
  const q = getQuery();
  const result = await q<RefreshRow>(
    `SELECT id, user_id, token_hash, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0]!;
}

async function revokeRefreshTokenByHash(tokenHash: string): Promise<void> {
  const q = getQuery();
  await q(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}

/**
 * Outcome of an attempted refresh-token rotation. The route handler
 * branches on `ok`; on failure, `reason` gives a stable error code for
 * logs (but never echoed to the client — the response body uses a
 * generic message to avoid token-state enumeration).
 */
export interface RotateResult {
  ok: boolean;
  reason?:
    | "missing"
    | "invalid_signature"
    | "not_found"
    | "already_revoked"
    | "expired";
  user?: { id: string; email: string };
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Validate + rotate the presented refresh token (AC1 + AC2 / REQ-003).
 *
 * Pipeline:
 *   1. Verify the JWT signature. Any verification failure is `invalid_signature`
 *      (covers tampered / malformed tokens as well — verify() throws both).
 *   2. Hash the raw token SHA-256 and look up the row by `token_hash`.
 *      NOT FOUND -> `not_found` (refresh token reuse after the row was
 *      purged, or a token minted by a different secret).
 *   3. If `revoked_at IS NOT NULL` -> `already_revoked`. This is the
 *      replay-attack signal: an attacker copied a token that the
 *      legitimate user already rotated away from.
 *   4. If past `expires_at` -> `expired`.
 *   5. Otherwise: REVOKE the old row, sign new access + refresh,
 *      persist the new refresh hash, and return the new pair.
 *
 * Replaying a revoked token therefore always reaches step 3 and returns
 * 401 — never re-issues. The lookup by hash guarantees a revoked token
 * can never be promoted back to active by replay.
 */
export async function rotateRefreshToken(
  rawRefreshToken: string,
  user: { id: string; email: string },
): Promise<RotateResult> {
  let jti: string;
  try {
    const claims = verifyRefreshToken(rawRefreshToken);
    jti = claims.jti;
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }

  const presentedHash = hashRefreshToken(rawRefreshToken);
  const row = await findRefreshTokenByHash(presentedHash);
  if (!row) {
    // Either never issued, or already purged by the GC sweep.
    return { ok: false, reason: "not_found" };
  }
  if (row.revoked_at !== null) {
    // Replay attack: this token was already rotated away from.
    return { ok: false, reason: "already_revoked" };
  }
  if (row.expires_at.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // Revoke the OLD row before issuing anything new. If issue-or-store
  // fails downstream, the user will simply have to re-login — but
  // the OLD token is already dead, which is the safer failure mode.
  await revokeRefreshTokenByHash(presentedHash);

  // Issue the new pair.
  const newJtiStr = newJti();
  // sanity: keep the lint happy about jti being read (the verified
  // claim is also the canonical id of the OLD token; we don't store
  // it but it's nice to have for logging in a richer deployment).
  void jti;
  const newRefresh = signRefreshToken({ sub: user.id, jti: newJtiStr });
  const newRefreshHash = hashRefreshToken(newRefresh);
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlSec * 1000);

  // Insert via the existing repository-style call so the row shape and
  // hash format stay consistent with /register and /login.
  // NOTE: we explicitly generate and pass `id` because pg-mem's
  // registered gen_random_uuid() returns the same value per test session
  // when called via the pg adapter. On real Postgres the DEFAULT works.
  const q = getQuery();
  await q(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), user.id, newRefreshHash, expiresAt],
  );

  const accessToken = signAccessToken({ sub: user.id, email: user.email });

  return {
    ok: true,
    user: { id: user.id, email: user.email },
    accessToken,
    refreshToken: newRefresh,
  };
}

/**
 * Revoke the refresh token presented by a logout request (AC3 /
 * REQ-003-AC3). The cookie may be absent (user cleared it manually) —
 * in that case this is a no-op. Invalid JWT signatures are also
 * tolerated so a tampered cookie does not block logout.
 */
export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  // Even if the JWT signature is invalid, hash-and-revoke is safe —
  // we only touch the row whose hash matches, which by SHA-256 second
  // preimage resistance is a row this token could only have produced.
  const tokenHash = hashRefreshToken(rawRefreshToken);
  await revokeRefreshTokenByHash(tokenHash);
}
