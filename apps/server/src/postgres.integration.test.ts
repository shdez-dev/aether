import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  AccessDeniedError,
  EvaluationService,
  InitiativeVersionConflictError,
  InitiativeService,
  OutboxWorker,
  ProjectAlreadyExistsError,
  ProjectService,
  TenantService,
} from "@aether/application";
import {
  AuthService,
  createAesGcmCipher,
  type OidcProvider,
} from "@aether/auth";
import {
  PostgresAuthStore,
  PostgresEvaluationStandardStore,
  PostgresEvaluationStore,
  PostgresInitiativeAuditStore,
  PostgresInitiativeStore,
  PostgresIdempotencyStore,
  PostgresOutboxStore,
  PostgresProjectAuditStore,
  PostgresProjectExecutionStore,
  PostgresProjectClosureStore,
  PostgresProjectStore,
  PostgresDocumentStore,
  PostgresTenantStore,
  migratePool,
} from "@aether/database";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let pool: Pool;
const testSessionEncryptionKey = Buffer.alloc(32).toString("base64");
const containerRuntimeAvailable =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const requireContainerRuntime = process.env.REQUIRE_CONTAINER_RUNTIME === "1";
const runPostgresIntegration =
  containerRuntimeAvailable || requireContainerRuntime ? it : it.skip;

if (containerRuntimeAvailable || requireContainerRuntime) {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("aether")
      .withUsername("aether")
      .withPassword("aether")
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await migratePool(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });
}

describe("PostgreSQL integration", () => {
  runPostgresIntegration(
    "renews, expires and revokes opaque sessions with append-only audit",
    async () => {
      let now = new Date("2026-09-09T12:00:00.000Z");
      const actorId = `session-${randomUUID()}@example.test`;
      const oidc: OidcProvider = {
        async buildAuthorizationUrl({ state }) {
          return `https://identity.example/authorize?state=${state}`;
        },
        async exchangeAuthorizationCode() {
          return { subject: actorId, email: actorId };
        },
      };
      const store = new PostgresAuthStore(pool);
      const auth = new AuthService({
        store,
        audit: store,
        cipher: createAesGcmCipher(testSessionEncryptionKey),
        oidc,
        issuer: "https://identity.example",
        sessionTtlSeconds: 3600,
        sessionRenewalWindowSeconds: 600,
        now: () => now,
      });
      const login = async () => {
        const started = await auth.beginLogin();
        const state = new URL(started.authorizationUrl).searchParams.get(
          "state",
        );
        if (!state) throw new Error("OIDC state was not generated");
        return auth.completeLogin({
          transactionHandle: started.transactionHandle,
          state,
          callbackUrl: `https://app.example/auth/callback?code=test&state=${state}`,
        });
      };

      const first = await login();
      now = new Date("2026-09-09T12:55:00.000Z");
      expect(
        (await auth.authenticate(first.sessionToken))?.expiresAt.toISOString(),
      ).toBe("2026-09-09T13:55:00.000Z");
      const second = await login();
      const listed = await auth.listSessions(actorId, second.session.id);
      expect(listed).toHaveLength(2);
      expect(listed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: second.session.id, isCurrent: true }),
        ]),
      );
      expect(
        await auth.revokeSession({
          actorId,
          sessionId: first.session.id,
          correlationId: randomUUID(),
        }),
      ).toBe(true);
      await expect(auth.authenticate(first.sessionToken)).resolves.toBeNull();
      const third = await login();
      expect(
        await auth.revokeOtherSessions({
          actorId,
          currentSessionId: second.session.id,
          correlationId: randomUUID(),
        }),
      ).toBe(1);
      await expect(auth.authenticate(third.sessionToken)).resolves.toBeNull();
      now = new Date("2026-09-09T13:56:00.000Z");
      await expect(auth.authenticate(second.sessionToken)).resolves.toBeNull();
      const events = await pool.query<{ action: string }>(
        "SELECT action FROM auth_session_audit_events WHERE actor_id = $1 ORDER BY occurred_at",
        [actorId],
      );
      expect(events.rows).toEqual([
        { action: "auth.session_revoked.v1" },
        { action: "auth.sessions_revoked_others.v1" },
      ]);
      await expect(
        pool.query(
          "DELETE FROM auth_session_audit_events WHERE actor_id = $1",
          [actorId],
        ),
      ).rejects.toThrow("append-only");
    },
    120_000,
  );

  runPostgresIntegration(
    "persists and replays idempotent mutation responses",
    async () => {
      const store = new PostgresIdempotencyStore(pool);
      const input = {
        actorId: "idempotency@example.test",
        operation: "initiative.create",
        key: randomUUID(),
        requestHash: "request-hash",
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      expect(await store.reserve(input)).toEqual({ kind: "claimed" });
      await store.complete({
        ...input,
        response: { statusCode: 201, body: { id: randomUUID() } },
      });
      await expect(store.reserve(input)).resolves.toMatchObject({
        kind: "completed",
        response: { statusCode: 201 },
      });
      await expect(
        store.reserve({ ...input, requestHash: "different-request" }),
      ).resolves.toEqual({ kind: "key_reused" });
      const pending = { ...input, key: randomUUID(), requestHash: "pending" };
      const concurrentReservations = await Promise.all([
        store.reserve(pending),
        store.reserve(pending),
      ]);
      expect(concurrentReservations).toEqual(
        expect.arrayContaining([{ kind: "claimed" }, { kind: "in_progress" }]),
      );
      await store.abandon(pending);
      await expect(store.reserve(pending)).resolves.toEqual({
        kind: "claimed",
      });
    },
  );

  runPostgresIntegration(
    "isolates tenants and persists project plus outbox event atomically",
    async () => {
      const ids = { next: randomUUID };
      const clock = { now: () => new Date() };
      const tenantStore = new PostgresTenantStore(pool);
      const initiativesStore = new PostgresInitiativeStore(pool);
      const initiativeAudit = new PostgresInitiativeAuditStore(pool);
      const evaluationsStore = new PostgresEvaluationStore(pool);
      const tenantService = new TenantService({
        store: tenantStore,
        ids,
        tokens: { generate: () => "token", hash: (value) => `hash:${value}` },
        clock,
      });
      const initiativeService = new InitiativeService({
        store: initiativesStore,
        audit: initiativeAudit,
        tenancy: tenantStore,
        ids,
        clock,
      });
      const evaluationService = new EvaluationService({
        standards: new PostgresEvaluationStandardStore(pool),
        evaluations: evaluationsStore,
        initiatives: initiativesStore,
        audit: initiativeAudit,
        tenancy: tenantStore,
        ids,
        clock,
      });
      const projectService = new ProjectService({
        projects: new PostgresProjectStore(pool),
        execution: new PostgresProjectExecutionStore(pool),
        closures: new PostgresProjectClosureStore(pool),
        documents: new PostgresDocumentStore(pool),
        audit: new PostgresProjectAuditStore(pool),
        decisions: evaluationsStore,
        initiatives: initiativesStore,
        tenancy: tenantStore,
        ids,
        clock,
      });

      const owner = "owner@example.test";
      const organization = await tenantService.createOrganization({
        actorId: owner,
        actorEmail: owner,
        name: "Aether integration",
        timezone: "UTC",
        locale: "es-CL",
      });
      const workspace = await tenantService.createWorkspace({
        actorId: owner,
        organizationId: organization.id,
        name: "Estrategia",
        mode: "institutional",
      });
      const invited = await tenantService.invite({
        actorId: owner,
        organizationId: organization.id,
        email: "lead@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "member",
        expiresInDays: 1,
      });
      await tenantService.acceptInvitation({
        actorId: "lead@example.test",
        actorEmail: "lead@example.test",
        token: invited.deliveryToken,
      });

      const draft = await initiativeService.create({
        actorId: owner,
        organizationId: organization.id,
        workspaceId: workspace.id,
        correlationId: randomUUID(),
        title: "Reducir tiempos de espera",
        problemStatement: "La atención tarda demasiado.",
        expectedOutcome: "Reducir la mediana de espera.",
        classification: "internal",
      });
      await expect(
        initiativeService.list({
          actorId: "outsider@example.test",
          organizationId: organization.id,
          workspaceId: workspace.id,
        }),
      ).rejects.toBeInstanceOf(AccessDeniedError);

      const presented = await initiativeService.present({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        correlationId: randomUUID(),
        expectedVersion: draft.version,
      });
      const standard = await evaluationService.publishStandard({
        actorId: owner,
        organizationId: organization.id,
        name: "Estándar inicial",
        version: 1,
        criteria: [
          {
            id: randomUUID(),
            code: "IMPACT",
            name: "Impacto",
            description: "Impacto institucional verificable.",
            weight: 1,
          },
        ],
      });
      await evaluationService.activateStandard({
        actorId: owner,
        organizationId: organization.id,
        standardId: standard.id,
      });
      const evaluation = await evaluationService.review({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        standardId: standard.id,
        expectedVersion: presented.version,
        correlationId: randomUUID(),
        results: [
          {
            criterionId: standard.criteria[0]!.id,
            assessment: "met",
            evidence: ["Indicador confirmado."],
          },
        ],
      });
      const reviewing = await initiativesStore.findById(draft.id);
      const decisionInput = {
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        evaluationId: evaluation.id,
        expectedVersion: reviewing!.version,
        outcome: "approved" as const,
        rationale: "Evidencia suficiente.",
        evidence: ["Acta."],
      };
      const decisionAttempts = await Promise.allSettled([
        evaluationService.decide({
          ...decisionInput,
          correlationId: randomUUID(),
        }),
        evaluationService.decide({
          ...decisionInput,
          correlationId: randomUUID(),
        }),
      ]);
      expect(
        decisionAttempts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        decisionAttempts.find((result) => result.status === "rejected")?.reason,
      ).toBeInstanceOf(InitiativeVersionConflictError);
      const successfulDecision = decisionAttempts.find(
        (result) => result.status === "fulfilled",
      );
      if (!successfulDecision || successfulDecision.status !== "fulfilled")
        throw new Error("An approved decision was expected");
      const decision = successfulDecision.value;
      const projectInput = {
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        decisionId: decision.id,
        name: "Proyecto de espera",
        sponsorActorId: owner,
        leadActorId: "lead@example.test",
        participants: [
          { actorId: owner, role: "sponsor" },
          { actorId: "lead@example.test", role: "lead" },
        ] as const,
      };
      const projectAttempts = await Promise.allSettled([
        projectService.createFromInitiative({
          ...projectInput,
          correlationId: randomUUID(),
        }),
        projectService.createFromInitiative({
          ...projectInput,
          correlationId: randomUUID(),
        }),
      ]);
      expect(
        projectAttempts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        projectAttempts.find((result) => result.status === "rejected")?.reason,
      ).toBeInstanceOf(ProjectAlreadyExistsError);
      const successfulProject = projectAttempts.find(
        (result) => result.status === "fulfilled",
      );
      if (!successfulProject || successfulProject.status !== "fulfilled")
        throw new Error("A project was expected");
      const project = successfulProject.value;

      const events = await pool.query<{ event_type: string; status: string }>(
        "SELECT event_type, status FROM outbox_events WHERE aggregate_id = $1",
        [project.id],
      );
      expect(events.rows).toEqual([
        { event_type: "project.created.v1", status: "pending" },
      ]);

      const handled: string[] = [];
      const worker = new OutboxWorker({
        store: new PostgresOutboxStore(pool),
        handler: { handle: async (event) => void handled.push(event.eventId) },
        clock,
        workerId: "integration-worker",
        consumer: "integration-test.v1",
        maxAttempts: 3,
        lockTimeoutSeconds: 60,
      });
      await worker.processOnce();
      expect(handled).toHaveLength(1);
      const processed = await pool.query<{ status: string }>(
        "SELECT status FROM outbox_events WHERE aggregate_id = $1",
        [project.id],
      );
      expect(processed.rows).toEqual([{ status: "processed" }]);
      const consumptions = await pool.query(
        "SELECT 1 FROM outbox_consumptions WHERE consumer = 'integration-test.v1'",
      );
      expect(consumptions.rowCount).toBe(1);
    },
    120_000,
  );
});
