-- 001_create_users.up.sql
-- Story: S-DB-01
-- Maps to REQ: REQ-001
--
-- Sets up extensions, the `users` table, its indexes, and the shared
-- `set_updated_at()` trigger function plus the `users_updated_at` trigger.

-- Required extensions (citext for case-insensitive email, pgcrypto for gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users table
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_email_idx ON users (email);

-- Trigger function shared by `users` and `todos` for refreshing updated_at.
-- Defined here (with the first table that needs it) and dropped in the last
-- migration that references it. We create it as OR REPLACE so re-applying
-- the migration is safe.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
