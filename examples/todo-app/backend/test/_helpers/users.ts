// test/_helpers/users.ts
// Story: S-TODO-01 (S-AUTH-01 helpers re-exported for todo tests)
//
// Quick "create a user + sign their access token" helpers used by the
// todos integration tests. S-AUTH-01's auth.service.ts is the canonical
// source for token signing; we just compose it with a direct INSERT so
// tests can spin up multiple users without going through /register.

import type { IMemoryDb } from "pg-mem";
import { signAccessToken } from "../../src/services/auth.service.js";

export interface TestUser {
  id: string;
  email: string;
  name: string;
  accessToken: string;
}

/**
 * Insert a user directly into the in-memory DB and sign an access token
 * for them. The token has the same shape `requireAuth` expects
 * ({ sub, email }) because it goes through the same `signAccessToken`
 * used by the production register flow.
 *
 * NOTE: pg-mem's `db.public.many(sql)` does NOT accept query params
 * ($1, $2, ...). To keep this helper dependency-free and synchronous,
 * we inline literal values. The email is already validated by the
 * caller (we control it in tests), and the uuid is freshly generated —
 * so SQL injection isn't a concern here. The route handlers under test
 * still go through the parameterised path via `db/client.ts`.
 */
export async function createUser(
  db: IMemoryDb,
  opts: { id?: string; email: string; name?: string; passwordHash?: string },
): Promise<TestUser> {
  const id = opts.id ?? crypto.randomUUID();
  const name = opts.name ?? "Test User";
  const passwordHash = opts.passwordHash ?? "$2b$04$placeholderhashplaceholderhashplaceholderhashplaceholderhashplaceholderhashplaceho";

  // Inline literal SQL — see NOTE above about pg-mem's lack of params
  // on .public.many(). Values are test-controlled so this is safe.
  const sqlId = `'${id.replace(/'/g, "''")}'::uuid`;
  const sqlEmail = `'${opts.email.replace(/'/g, "''")}'`;
  const sqlName = `'${name.replace(/'/g, "''")}'`;
  const sqlHash = `'${passwordHash.replace(/'/g, "''")}'`;
  db.public.none(
    `INSERT INTO users (id, email, password_hash, name)
     VALUES (${sqlId}, ${sqlEmail}, ${sqlHash}, ${sqlName})`,
  );

  const accessToken = signAccessToken({ sub: id, email: opts.email });
  return { id, email: opts.email, name, accessToken };
}

/**
 * Build a `Cookie: access_token=...` header value from a TestUser's token.
 * supertest also accepts `.set('Authorization', 'Bearer <token>')` but
 * the cookie path exercises the same code the production register handler
 * sets, so it's a more faithful end-to-end test.
 */
export function authCookie(user: TestUser): string {
  return `access_token=${user.accessToken}`;
}

/** Bearer header value — alternative to the cookie for tests that want
 *  to assert both paths work. */
export function bearer(user: TestUser): string {
  return `Bearer ${user.accessToken}`;
}
