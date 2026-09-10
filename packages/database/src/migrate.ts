import { Pool } from "pg";

import { migratePool } from "./migrations.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations");

const pool = new Pool({ connectionString: databaseUrl });
try {
  await migratePool(pool);
  process.stdout.write("Database migrations are current\n");
} finally {
  await pool.end();
}
