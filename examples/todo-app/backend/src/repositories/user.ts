// src/repositories/user.ts
// Story: S-AUTH-01
// Maps to REQ: REQ-001
//
// CRUD for the `users` table. Returns domain objects (no pg-specific
// column case issues — Postgres identifiers are lowercased, our TS types
// use camelCase; we re-map at the row boundary).

import { getQuery } from "../db/client.js";

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RawUserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

function mapRow(r: RawUserRow): UserRow {
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  name: string;
}): Promise<UserRow> {
  const q = getQuery();
  const result = await q<RawUserRow>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id, email, password_hash, name, created_at, updated_at`,
    [input.email, input.passwordHash, input.name],
  );
  return mapRow(result.rows[0]!);
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const q = getQuery();
  const result = await q<RawUserRow>(
    `SELECT id, email, password_hash, name, created_at, updated_at
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [email],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]!);
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const q = getQuery();
  const result = await q<RawUserRow>(
    `SELECT id, email, password_hash, name, created_at, updated_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]!);
}
