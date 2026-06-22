// src/middleware/auth.ts
// Story: S-TODO-01
// Maps to REQ: REQ-004, REQ-007, AC8
//
// requireAuth: extract access_token from cookie or Authorization: Bearer,
// verify, and attach `req.user = { sub, email }`. Reject with 401 on
// missing / malformed / invalid tokens.

import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../services/auth.service.js";
import type { AuthUser } from "../types.js";

// Augment Express's Request with our `user` field so routes see
// `req.user.sub` typed. Declared once here; imported transitively via
// the import graph (TypeScript merges across the project automatically).
declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Read the access token from one of:
 *   1. Authorization: Bearer <token>
 *   2. Cookie named access_token (signed cookies are NOT used; the cookie
 *      layer only needs to parse the literal value, so cookie-parser is
 *      sufficient without a secret).
 */
function extractToken(req: Request): string | null {
  const auth = req.header("authorization") ?? req.header("Authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    const tok = auth.replace(/^Bearer\s+/i, "").trim();
    if (tok) return tok;
  }
  // cookie-parser populates req.cookies (or req.signedCookies for signed).
  // We use the unsigned variant — the JWT signature is the integrity gate.
  const ck = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (ck && typeof ck.access_token === "string" && ck.access_token.length > 0) {
    return ck.access_token;
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res
      .status(401)
      .json({ error: "unauthorized", message: "Missing access token" });
    return;
  }
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res
      .status(401)
      .json({ error: "unauthorized", message: "Invalid or expired access token" });
    return;
  }
  req.user = { sub: payload.sub, email: payload.email };
  next();
}

/**
 * Helper used by routes to confirm `req.user` is present. should be
 * unreachable in production (requireAuth runs first) but worth guarding
 * so tests fail loudly if wiring is dropped.
 */
export function ensureReady(req: Request, res: Response): boolean {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}
