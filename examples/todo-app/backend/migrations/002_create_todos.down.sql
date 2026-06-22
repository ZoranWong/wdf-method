-- 002_create_todos.down.sql
-- Story: S-DB-01
-- Reverses 002_create_todos.up.sql.
--
-- Also drops the shared `set_updated_at()` trigger function. By the time
-- 002-down runs, `todos_updated_at` (created here) and `users_updated_at`
-- (created in 001, dropped in 001-down) are the only two consumers; both
-- triggers must already have been dropped before this function can be removed.
-- We use IF EXISTS so the down migration is idempotent regardless of order.

DROP TRIGGER IF EXISTS todos_updated_at ON todos;
DROP TABLE IF EXISTS todos;
DROP TYPE IF EXISTS priority_level;
DROP FUNCTION IF EXISTS set_updated_at();
