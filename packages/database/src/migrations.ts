import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

/** Applies every pending SQL migration in lexical order using one transaction per file. */
export async function migratePool(pool: Pool): Promise<void> {
  const migrationDirectory = fileURLToPath(
    new URL("../migrations/", import.meta.url),
  );
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const applied = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations",
  );
  const appliedNames = new Set(applied.rows.map((row) => row.name));
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const name of files) {
    if (appliedNames.has(name)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        name,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
