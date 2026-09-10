import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import {
  createOperationalMetrics,
  initializeTelemetry,
  withinSpan,
} from "@aether/observability";

import { createOutboxWorker } from "./outbox-worker.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the worker");
const pool = new Pool({ connectionString: databaseUrl });
const telemetry = initializeTelemetry({
  serviceName: "aether-worker",
  ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? { otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }
    : {}),
});
const metrics = createOperationalMetrics("aether-worker");
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
    const result = await withinSpan({
      tracer: telemetry.tracer,
      name: "outbox.poll",
      run: () => worker.processOnce(),
    });
    metrics.recordOutboxCycle(result);
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
} finally {
  await telemetry.shutdown();
  await pool.end();
}
