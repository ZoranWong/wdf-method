-- 001_create_users.down.sql
-- Story: S-DB-01
-- Reverses 001_create_users.up.sql.
--
-- NOTE on trigger function ownership: `set_updated_at()` is also used by the
-- `todos_updated_at` trigger created in 002. To remain a *precise* reverse of
-- 001, we drop only the `users_updated_at` trigger here and leave the shared
-- function in place (it is harmless if no trigger references it). The shared
-- function is dropped in 002_create_todos.down.sql together with the todos
-- trigger. Running 001-down alone therefore still returns `users` to its
-- pre-001 state; the function will be cleaned up by 002-down or no-ops if
-- applied after 002-down.

DROP TRIGGER IF EXISTS users_updated_at ON users;
DROP TABLE IF EXISTS users;
