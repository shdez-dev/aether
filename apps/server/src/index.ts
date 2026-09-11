import { randomUUID } from "node:crypto";

import {
  EvaluationService,
  DocumentService,
  AuditHistoryService,
  InitiativeService,
  ProjectService,
  TenantService,
} from "@aether/application";
import {
  AuthService,
  createAesGcmCipher,
  createKeycloakOidcProvider,
  hashOpaqueToken,
  randomOpaqueToken,
} from "@aether/auth";
import {
  PostgresAuthStore,
  PostgresAuditHistoryStore,
  PostgresInitiativeAuditStore,
  PostgresInitiativeStore,
  PostgresIdempotencyStore,
  PostgresProjectAuditStore,
  PostgresProjectExecutionStore,
  PostgresProjectStore,
  PostgresEvaluationStandardStore,
  PostgresEvaluationStore,
  PostgresTenantStore,
  PostgresDocumentStore,
} from "@aether/database";
import {
  createOperationalMetrics,
  initializeTelemetry,
} from "@aether/observability";
import { S3DocumentObjectStore } from "@aether/storage";
import { Pool } from "pg";

import { buildServer } from "./app.js";
import { readServerConfig } from "./config.js";

const config = readServerConfig();
const telemetry = initializeTelemetry({
  serviceName: "aether-server",
  ...(config.otelExporterOtlpEndpoint
    ? { otlpEndpoint: config.otelExporterOtlpEndpoint }
    : {}),
});
const metrics = createOperationalMetrics("aether-server");
const pool = new Pool({ connectionString: config.databaseUrl });
const authStore = new PostgresAuthStore(pool);
const auth = new AuthService({
  store: authStore,
  audit: authStore,
  cipher: createAesGcmCipher(config.sessionEncryptionKey),
  oidc: createKeycloakOidcProvider({
    issuerUrl: config.oidcIssuerUrl,
    clientId: config.oidcClientId,
    clientSecret: config.oidcClientSecret,
    redirectUri: config.oidcRedirectUri,
    allowInsecureRequests: config.nodeEnv === "development",
  }),
  issuer: config.oidcIssuerUrl,
  sessionTtlSeconds: config.sessionTtlSeconds,
  sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
});
const tenants = new TenantService({
  store: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  tokens: { generate: randomOpaqueToken, hash: hashOpaqueToken },
  clock: { now: () => new Date() },
});
const initiatives = new InitiativeService({
  store: new PostgresInitiativeStore(pool),
  audit: new PostgresInitiativeAuditStore(pool),
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const evaluations = new EvaluationService({
  standards: new PostgresEvaluationStandardStore(pool),
  evaluations: new PostgresEvaluationStore(pool),
  initiatives: new PostgresInitiativeStore(pool),
  audit: new PostgresInitiativeAuditStore(pool),
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const projects = new ProjectService({
  projects: new PostgresProjectStore(pool),
  execution: new PostgresProjectExecutionStore(pool),
  audit: new PostgresProjectAuditStore(pool),
  decisions: new PostgresEvaluationStore(pool),
  initiatives: new PostgresInitiativeStore(pool),
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const documents = new DocumentService({
  store: new PostgresDocumentStore(pool),
  audit: new PostgresDocumentStore(pool),
  objects: new S3DocumentObjectStore({
    endpoint: config.s3Endpoint,
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
    maxBytes: config.maxDocumentBytes,
  }),
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
  maxBytes: config.maxDocumentBytes,
  urlTtlSeconds: config.s3PresignTtlSeconds,
});
const auditHistory = new AuditHistoryService({
  store: new PostgresAuditHistoryStore(pool),
  tenancy: new PostgresTenantStore(pool),
});
const app = await buildServer({
  config,
  auth,
  tenants,
  initiatives,
  evaluations,
  projects,
  documents,
  idempotency: new PostgresIdempotencyStore(pool),
  auditHistory,
  metrics,
  readinessCheck: async () => {
    await pool.query("SELECT 1");
  },
});
try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  await telemetry.shutdown();
  await pool.end();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => telemetry.shutdown())
      .then(() => pool.end());
  });
