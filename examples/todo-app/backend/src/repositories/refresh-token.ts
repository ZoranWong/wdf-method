// src/repositories/refresh-token.ts
// Story: S-AUTH-01
// Maps to REQ: REQ-001
//
// Persists refresh-token hashes. We store ONLY the SHA-256 hash; the raw
// token is returned to the client via cookie and never touches the DB.

import { getQuery } from "../db/client.js";

export interface RefreshTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface RawRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

function mapRow(r: RawRow): RefreshTokenRow {
  return {
    id: r.id,
    userId: r.user_id,
    tokenHash: r.token_hash,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
  };
}

export async function storeRefreshToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<RefreshTokenRow> {
  const q = getQuery();
  const result = await q<RawRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, token_hash, expires_at, revoked_at, created_at`,
    [input.userId, input.tokenHash, input.expiresAt],
  );
  return mapRow(result.rows[0]!);
}

export async function findActiveRefreshToken(
  tokenHash: string,
): Promise<RefreshTokenRow | null> {
  const q = getQuery();
  const result = await q<RawRow>(
    `SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
     FROM refresh_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]!);
}
