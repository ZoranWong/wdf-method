-- 002_create_todos.up.sql
-- Story: S-DB-01
-- Maps to REQ: REQ-004, REQ-007
--
-- Creates the `priority_level` enum, the `todos` table with FK to `users`,
-- its indexes (including the query-hot user_id + completed composite index),
-- and the `todos_updated_at` trigger.

-- Priority enum
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high');

-- Todos table
CREATE TABLE todos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  description text CHECK (description IS NULL OR length(description) <= 5000),
  due_date    timestamptz,
  priority    priority_level NOT NULL DEFAULT 'medium',
  completed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX todos_user_id_idx       ON todos (user_id);
CREATE INDEX todos_user_status_idx   ON todos (user_id, completed);
CREATE INDEX todos_user_priority_idx ON todos (user_id, priority);

-- todos_updated_at trigger (function defined in 001_create_users.up.sql)
CREATE TRIGGER todos_updated_at
  BEFORE UPDATE ON todos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
