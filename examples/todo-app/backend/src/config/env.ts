// src/config/env.ts
// Story: S-AUTH-01
// Maps to REQ: REQ-001
//
// Centralized, validated env access. Reading `process.env.X` ad-hoc inside
// services makes them untestable — every test that touches a service would
// need to monkey-patch env. Instead, services import from here, and tests
// override `process.env.BCRYPT_COST` etc. BEFORE this module loads
// (vitest isolates modules per test file by default).

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`env ${name} is not a valid integer: ${raw}`);
  }
  return n;
}

/**
 * We expose these as getters (not plain values) so tests can override env
 * vars in `beforeEach` and have the change take effect. Reading
 * `process.env.X` once at module load would cache the default before any
 * test setup runs.
 */
export const env = {
  /** bcrypt cost factor. Production default 12; tests override to 4. */
  get bcryptCost(): number {
    return intEnv("BCRYPT_COST", 12);
  },
  /** Access token TTL in seconds (15 min). */
  get accessTokenTtlSec(): number {
    return intEnv("ACCESS_TOKEN_TTL_SEC", 60 * 15);
  },
  /** Refresh token TTL in seconds (7 days). */
  get refreshTokenTtlSec(): number {
    return intEnv("REFRESH_TOKEN_TTL_SEC", 60 * 60 * 24 * 7);
  },
  get jwtSecret(): string {
    return process.env.JWT_SECRET ?? "dev-insecure-secret-change-me";
  },
  get jwtRefreshSecret(): string {
    return (
      process.env.JWT_REFRESH_SECRET ??
      "dev-insecure-refresh-secret-change-me"
    );
  },
  get isTest(): boolean {
    return process.env.NODE_ENV === "test";
  },
  get databaseUrl(): string {
    return (
      process.env.DATABASE_URL ?? "postgres://todo:todo@localhost:5432/todo"
    );
  },
};

/**
 * Cookie options shared by access_token + refresh_token. httpOnly + secure
 * + sameSite=strict is the OWASP-recommended baseline for auth cookies.
 * `secure` is forced off in tests because supertest uses plain HTTP.
 */
export function authCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: !env.isTest,
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSec * 1000,
  };
}

/**
 * Cookie options to PASS TO res.clearCookie() (S-AUTH-05). For a cookie
 * to actually be deleted by the browser, `path`, `domain`, `secure`,
 * and `sameSite` MUST match what was used at set-time — Express / the
 * user agent match on those before honoring a Max-Age=0. We pass the
 * same flags as `authCookieOptions` minus `maxAge` (Express ignores it
 * on clearCookie) so the deletion actually takes effect in production
 * AND in tests (supertest validates Set-Cookie header shape).
 */
export function clearAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: !env.isTest,
    sameSite: "strict" as const,
    path: "/",
  };
}
