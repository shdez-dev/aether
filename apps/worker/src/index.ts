import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { DocumentScanService } from "@aether/application";
import { PostgresDocumentStore, PostgresOutboxStore } from "@aether/database";
import { S3DocumentObjectStore } from "@aether/storage";
import {
  createOperationalMetrics,
  initializeTelemetry,
  withinSpan,
} from "@aether/observability";

import {
  createOutboxWorker,
  createWorkerEventHandler,
} from "./outbox-worker.js";
import { ClamAvDocumentScanner } from "./clamav-scanner.js";

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
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Bucket = process.env.S3_BUCKET;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
if (!s3Endpoint || !s3Bucket || !s3AccessKeyId || !s3SecretAccessKey)
  throw new Error(
    "S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required for the worker",
  );
const ids = { next: randomUUID };
const documentStore = new PostgresDocumentStore(pool);
const outboxStore = new PostgresOutboxStore(pool);
const documentScans = new DocumentScanService({
  store: documentStore,
  audit: documentStore,
  objects: new S3DocumentObjectStore({
    endpoint: s3Endpoint,
    bucket: s3Bucket,
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    maxBytes: Number(process.env.MAX_DOCUMENT_BYTES ?? 10_485_760),
  }),
  scanner: new ClamAvDocumentScanner({
    host: process.env.CLAMAV_HOST ?? "127.0.0.1",
    port: Number(process.env.CLAMAV_PORT ?? 3310),
    timeoutMs: Number(process.env.CLAMAV_TIMEOUT_MS ?? 30_000),
  }),
  ids,
  clock: { now: () => new Date() },
  retentionDays: { internal: 365, confidential: 1_095, restricted: 2_555 },
});
const worker = createOutboxWorker({
  pool,
  store: outboxStore,
  workerId: process.env.WORKER_ID ?? `worker-${randomUUID()}`,
  handler: createWorkerEventHandler({
    documentScans,
    onDeferred(event) {
      process.stdout.write(
        `Deferred outbox event ${event.eventType} (${event.eventId})\n`,
      );
    },
  }),
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
    metrics.recordOutboxQueue(await outboxStore.queueStats(new Date()));
    await documentScans.purgeExpired();
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
} finally {
  await telemetry.shutdown();
  await pool.end();
}
