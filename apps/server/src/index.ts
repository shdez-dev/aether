import { randomUUID } from "node:crypto";

import {
  EvaluationService,
  TriageService,
  DocumentService,
  EvidenceService,
  NotificationService,
  CommentService,
  AuditHistoryService,
  ProductMetricsService,
  OutboxAdministrationService,
  InitiativeService,
  IntakeService,
  ProjectService,
  TenantService,
  TemporaryAccessGrantService,
  SupportAccessService,
  ExportService,
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
  PostgresSecurityAuditStore,
  PostgresProductMetricsStore,
  PostgresOutboxAdministrationStore,
  PostgresInitiativeAuditStore,
  PostgresInitiativeStore,
  PostgresIntakeAssignmentStore,
  PostgresIdempotencyStore,
  PostgresProjectAuditStore,
  PostgresProjectExecutionStore,
  PostgresProjectStore,
  PostgresEvaluationStandardStore,
  PostgresEvaluationStore,
  PostgresTriageStandardStore,
  PostgresTriageStore,
  PostgresTenantStore,
  PostgresDocumentStore,
  PostgresDocumentProjectAccess,
  PostgresEvidenceStore,
  PostgresProjectClosureStore,
  PostgresNotificationStore,
  PostgresCommentStore,
  PostgresTemporaryAccessGrantStore,
  PostgresSupportAccessGrantStore,
  PostgresExportJobStore,
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
const accessGrantStore = new PostgresTemporaryAccessGrantStore(pool);
const accessGrants = new TemporaryAccessGrantService({
  store: accessGrantStore,
  resources: accessGrantStore,
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const supportOperatorIds = new Set(config.supportOperatorActorIds);
const supportAccess = new SupportAccessService({
  store: new PostgresSupportAccessGrantStore(pool),
  operators: {
    isEligible: async (actorId) => supportOperatorIds.has(actorId),
  },
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const tenants = new TenantService({
  store: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  tokens: { generate: randomOpaqueToken, hash: hashOpaqueToken },
  clock: { now: () => new Date() },
  accessGrants,
});
const initiatives = new InitiativeService({
  store: new PostgresInitiativeStore(pool),
  audit: new PostgresInitiativeAuditStore(pool),
  tenancy: new PostgresTenantStore(pool),
  accessGrants,
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const intake = new IntakeService({
  assignments: new PostgresIntakeAssignmentStore(pool),
  initiatives: new PostgresInitiativeStore(pool),
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
  accessGrants,
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const triage = new TriageService({
  standards: new PostgresTriageStandardStore(pool),
  triages: new PostgresTriageStore(pool),
  initiatives: new PostgresInitiativeStore(pool),
  audit: new PostgresInitiativeAuditStore(pool),
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const documentStore = new PostgresDocumentStore(pool);
const projects = new ProjectService({
  projects: new PostgresProjectStore(pool),
  execution: new PostgresProjectExecutionStore(pool),
  closures: new PostgresProjectClosureStore(pool),
  documents: documentStore,
  audit: new PostgresProjectAuditStore(pool),
  decisions: new PostgresEvaluationStore(pool),
  initiatives: new PostgresInitiativeStore(pool),
  tenancy: new PostgresTenantStore(pool),
  accessGrants,
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const documents = new DocumentService({
  store: documentStore,
  audit: documentStore,
  objects: new S3DocumentObjectStore({
    endpoint: config.s3Endpoint,
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
    maxBytes: config.maxDocumentBytes,
  }),
  tenancy: new PostgresTenantStore(pool),
  accessGrants,
  projectAccess: new PostgresDocumentProjectAccess(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
  maxBytes: config.maxDocumentBytes,
  urlTtlSeconds: config.s3PresignTtlSeconds,
});
const evidence = new EvidenceService({
  references: new PostgresEvidenceStore(pool),
  subjects: new PostgresEvidenceStore(pool),
  documents: documentStore,
  documentAudit: documentStore,
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const notifications = new NotificationService({
  store: new PostgresNotificationStore(pool),
  tenancy: new PostgresTenantStore(pool),
  projects: new PostgresDocumentProjectAccess(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const comments = new CommentService({
  store: new PostgresCommentStore(pool),
  resources: documentStore,
  tenancy: new PostgresTenantStore(pool),
  projects: new PostgresDocumentProjectAccess(pool),
  notifications,
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const auditHistory = new AuditHistoryService({
  store: new PostgresAuditHistoryStore(pool),
  tenancy: new PostgresTenantStore(pool),
});
const productMetrics = new ProductMetricsService({
  store: new PostgresProductMetricsStore(pool),
  tenancy: new PostgresTenantStore(pool),
  clock: { now: () => new Date() },
});
const outboxAdministration = new OutboxAdministrationService({
  store: new PostgresOutboxAdministrationStore(pool),
  tenancy: new PostgresTenantStore(pool),
  clock: { now: () => new Date() },
  ids: { next: randomUUID },
});
const exports = new ExportService({
  store: new PostgresExportJobStore(pool),
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const app = await buildServer({
  config,
  auth,
  tenants,
  accessGrants,
  supportAccess,
  initiatives,
  intake,
  evaluations,
  triage,
  projects,
  documents,
  evidence,
  notifications,
  comments,
  idempotency: new PostgresIdempotencyStore(pool),
  auditHistory,
  securityAudit: new PostgresSecurityAuditStore(pool),
  productMetrics,
  outboxAdministration,
  exports,
  metrics,
  readinessCheck: async () => {
    await pool.query("SELECT 1");
    await auth.checkIdentityProviderAvailability();
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
