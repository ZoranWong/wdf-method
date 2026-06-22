// scripts/migrate.js
// Minimal migration runner for S-DB-01.
//
// WHY THIS EXISTS (scope note for the reviewer):
// The story mandates `<NNN>_<name>.up.sql` / `<NNN>_<name>.down.sql` file
// naming. node-pg-migrate v7 expects ONE `.sql` file per migration with
// `-- up migration` / `-- down migration` comment markers inside, so it cannot
// honor the required naming directly. Rather than fight the library, we ship
// a ~50-line runner that applies the ordered .up.sql / .down.sql files to a
// real PostgreSQL instance via the `pg` driver. The integration tests in
// test/migrations.test.ts exercise the SAME file-pair logic against pg-mem
// (in-memory Postgres), so behavior is covered.
//
// USAGE
//   DATABASE_URL=postgres://todo:todo@localhost:5432/todo npm run migrate:up
//   DATABASE_URL=postgres://todo:todo@localhost:5432/todo npm run migrate:down
//   DATABASE_URL=postgres://todo:todo@localhost:5432/todo npm run migrate:status

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATIONS_TABLE = "schema_migrations";

function dbUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "[migrate] DATABASE_URL is not set. Default would be postgres://todo:todo@localhost:5432/todo",
    );
    process.exit(2);
  }
  return url;
}

async function listFiles(suffix) {
  const all = await readdir(MIGRATIONS_DIR);
  return all
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => ({ name: f.replace(suffix, ""), path: join(MIGRATIONS_DIR, f) }));
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name    text PRIMARY KEY,
      applied timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function appliedSet(client) {
  const { rows } = await client.query(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name ASC`,
  );
  return new Set(rows.map((r) => r.name));
}

async function runMigration(client, name, sqlPath) {
  const sql = await readFile(sqlPath, "utf8");
  console.log(`[migrate] applying ${name}: ${sqlPath}`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1) ON CONFLICT DO NOTHING`,
      [name],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function revertMigration(client, name, sqlPath) {
  const sql = await readFile(sqlPath, "utf8");
  console.log(`[migrate] reverting ${name}: ${sqlPath}`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = $1`, [
      name,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function up() {
  const pool = new pg.Pool({ connectionString: dbUrl() });
  try {
    const client = await pool.connect();
    try {
      await ensureMigrationsTable(client);
      const applied = await appliedSet(client);
      const files = await listFiles(".up.sql");
      let count = 0;
      for (const f of files) {
        if (applied.has(f.name)) continue;
        await runMigration(client, f.name, f.path);
        count += 1;
      }
      console.log(`[migrate] up: applied ${count} migration(s)`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function down() {
  const pool = new pg.Pool({ connectionString: dbUrl() });
  try {
    const client = await pool.connect();
    try {
      await ensureMigrationsTable(client);
      const applied = await appliedSet(client);
      const files = (await listFiles(".down.sql")).reverse();
      let count = 0;
      for (const f of files) {
        if (!applied.has(f.name)) continue;
        await revertMigration(client, f.name, f.path);
        count += 1;
      }
      console.log(`[migrate] down: reverted ${count} migration(s)`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function status() {
  const pool = new pg.Pool({ connectionString: dbUrl() });
  try {
    const client = await pool.connect();
    try {
      await ensureMigrationsTable(client);
      const applied = await appliedSet(client);
      const ups = await listFiles(".up.sql");
      for (const f of ups) {
        const tag = applied.has(f.name) ? "[applied]  " : "[pending]  ";
        console.log(`${tag}${f.name}`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

const cmd = process.argv[2];
try {
  if (cmd === "up") await up();
  else if (cmd === "down") await down();
  else if (cmd === "status") await status();
  else {
    console.error(`Usage: node scripts/migrate.js <up|down|status>`);
    process.exit(2);
  }
} catch (err) {
  console.error(`[migrate] ${cmd ?? "(no cmd)"} failed:`, err.message);
  process.exit(1);
}
