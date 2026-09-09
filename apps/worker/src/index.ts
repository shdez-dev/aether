import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import { createOutboxWorker } from "./outbox-worker.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the worker");
const pool = new Pool({ connectionString: databaseUrl });
const worker = createOutboxWorker({
  pool,
  workerId: process.env.WORKER_ID ?? `worker-${randomUUID()}`,
});
const intervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1_000);
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopped = true;
  });
}
try {
  while (!stopped) {
    await worker.processOnce();
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
} finally {
  await pool.end();
}
