-- 003_create_refresh_tokens.up.sql
-- Story: S-DB-01
-- Maps to REQ: REQ-003
--
-- Creates the `refresh_tokens` table and its indexes. `token_hash` is unique
-- to support rotation + replay detection; `expires_at` index supports the
-- periodic GC sweep that purges expired/revoked tokens.

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token_hash)
);

CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);
