import { describe, expect, it } from "vitest";

import {
  AuthService,
  createAesGcmCipher,
  type AuthSession,
  type AuthStore,
  type LoginTransaction,
  type OidcProvider,
} from "@aether/auth";
import {
  EvaluationService,
  AuditHistoryService,
  InitiativeService,
  ProjectService,
  ProductMetricsService,
  OutboxAdministrationService,
  TenantService,
} from "@aether/application";
import {
  InMemoryEvaluationStandardStore,
  InMemoryEvaluationStore,
  InMemoryInitiativeAuditStore,
  InMemoryAuditHistoryStore,
  InMemoryInitiativeStore,
  InMemoryIdempotencyStore,
  InMemoryTenantStore,
  InMemoryProductMetricsStore,
} from "@aether/testkit";

import { buildServer } from "./app.js";
import type { ServerConfig } from "./config.js";

const testSessionEncryptionKey = Buffer.alloc(32).toString("base64");
class InMemoryAuthStore implements AuthStore {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly transactions = new Map<string, LoginTransaction>();
  async createSession(session: AuthSession): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSession | null> {
    return (
      [...this.sessions.values()].find(
        (session) =>
          session.tokenHash === tokenHash &&
          !session.revokedAt &&
          session.expiresAt > now,
      ) ?? null
    );
  }
  async renewSession(
    sessionId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<AuthSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const renewed = { ...session, expiresAt, lastSeenAt: now };
    this.sessions.set(sessionId, renewed);
    return renewed;
  }
  async listActiveSessions(input: {
    actorId: string;
    now: Date;
  }): Promise<readonly AuthSession[]> {
    return [...this.sessions.values()].filter(
      (session) =>
        session.actorId === input.actorId &&
        !session.revokedAt &&
        session.expiresAt > input.now,
    );
  }
  async revokeOwnedSession(input: {
    actorId: string;
    sessionId: string;
    now: Date;
  }): Promise<boolean> {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.actorId !== input.actorId || session.revokedAt)
      return false;
    this.sessions.set(input.sessionId, { ...session, revokedAt: input.now });
    return true;
  }
  async revokeOtherSessions(input: {
    actorId: string;
    exceptSessionId: string;
    now: Date;
  }): Promise<number> {
    const sessions = await this.listActiveSessions({
      actorId: input.actorId,
      now: input.now,
    });
    for (const session of sessions)
      if (session.id !== input.exceptSessionId)
        this.sessions.set(session.id, { ...session, revokedAt: input.now });
    return sessions.filter((session) => session.id !== input.exceptSessionId)
      .length;
  }
  async createLoginTransaction(transaction: LoginTransaction): Promise<void> {
    this.transactions.set(transaction.handleHash, transaction);
  }
  async consumeLoginTransaction(input: {
    handleHash: string;
    stateHash: string;
    now: Date;
  }): Promise<LoginTransaction | null> {
    const transaction = this.transactions.get(input.handleHash);
    if (
      !transaction ||
      transaction.stateHash !== input.stateHash ||
      transaction.expiresAt <= input.now
    )
      return null;
    this.transactions.delete(input.handleHash);
    return transaction;
  }
}

const config: ServerConfig = {
  nodeEnv: "test",
  port: 4000,
  databaseUrl: "postgres://unused",
  serverPublicUrl: "http://127.0.0.1:4000",
  webOrigin: "http://127.0.0.1:3000",
  oidcIssuerUrl: "https://identity.example",
  oidcClientId: "test",
  oidcClientSecret: "test",
  oidcRedirectUri: "http://127.0.0.1:4000/auth/callback",
  sessionEncryptionKey: testSessionEncryptionKey,
  sessionTtlSeconds: 3600,
  sessionRenewalWindowSeconds: 600,
  maxRequestBodyBytes: 1_048_576,
  rateLimitMax: 120,
  rateLimitWindowSeconds: 60,
  logLevel: "info",
  secureCookies: false,
  s3Endpoint: "http://127.0.0.1:9000",
  s3Bucket: "aether-test",
  s3AccessKeyId: "test",
  s3SecretAccessKey: "test",
  s3PresignTtlSeconds: 300,
  maxDocumentBytes: 1_048_576,
};
const oidc: OidcProvider = {
  async buildAuthorizationUrl({ state }) {
    return `https://identity.example/authorize?state=${state}`;
  },
  async exchangeAuthorizationCode() {
    return { subject: "actor-123", email: "actor@example.test" };
  },
};

function cookieValue(setCookies: string[], name: string): string {
  const found = setCookies.find((value) => value.startsWith(`${name}=`));
  if (!found) throw new Error(`Cookie ${name} not found`);
  return found.split(";")[0]!.slice(name.length + 1);
}
function responseCookies(response: {
  headers: Record<string, string | number | string[] | undefined>;
}): string[] {
  const value = response.headers["set-cookie"];
  return Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
}

describe("HTTP authentication boundary", () => {
  it("uses HttpOnly opaque cookies and requires Origin plus double-submit CSRF on logout", async () => {
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: 3600,
      sessionRenewalWindowSeconds: 600,
    });
    const tenants = new TenantService({
      store: new InMemoryTenantStore(),
      ids: { next: () => crypto.randomUUID() },
      tokens: {
        generate: () => "x".repeat(43),
        hash: (value) => `hash:${value}`,
      },
      clock: { now: () => new Date() },
    });
    const app = await buildServer({
      config,
      auth,
      tenants,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    const login = await app.inject({ method: "GET", url: "/auth/login" });
    const loginCookies = responseCookies(login);
    expect(
      loginCookies.find((cookie) => cookie.startsWith("aether_oidc_tx=")),
    ).toContain("HttpOnly");
    expect(
      loginCookies.find((cookie) => cookie.startsWith("aether_oidc_tx=")),
    ).toContain("SameSite=Lax");
    const state = new URL(login.headers.location!).searchParams.get("state")!;
    const callback = await app.inject({
      method: "GET",
      url: `/auth/callback?code=code&state=${state}`,
      headers: {
        cookie: `aether_oidc_tx=${cookieValue(loginCookies, "aether_oidc_tx")}`,
      },
    });
    const callbackCookies = responseCookies(callback);
    const sessionHeader = callbackCookies.find((cookie) =>
      cookie.startsWith("aether_session="),
    )!;
    expect(sessionHeader).toContain("HttpOnly");
    expect(sessionHeader).toContain("SameSite=Lax");
    expect(sessionHeader).not.toContain("access_token");
    const session = cookieValue(callbackCookies, "aether_session");
    const csrf = cookieValue(callbackCookies, "aether_csrf");
    const activeSessions = await app.inject({
      method: "GET",
      url: "/auth/sessions",
      headers: { cookie: `aether_session=${session}` },
    });
    expect(activeSessions.statusCode).toBe(200);
    expect(activeSessions.json()).toMatchObject({
      sessions: [expect.objectContaining({ isCurrent: true })],
    });
    expect(JSON.stringify(activeSessions.json())).not.toContain("tokenHash");
    const revokeOthers = await app.inject({
      method: "POST",
      url: "/auth/sessions/revoke-others",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
    });
    expect(revokeOthers.statusCode).toBe(200);
    expect(revokeOthers.json()).toEqual({ revoked: 0 });
    const mutationWithoutCsrf = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: { cookie: `aether_session=${session}; aether_csrf=${csrf}` },
      payload: { name: "Aether Test", timezone: "UTC", locale: "es-CL" },
    });
    expect(mutationWithoutCsrf.statusCode).toBe(403);
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { name: "Aether Test", timezone: "UTC", locale: "es-CL" },
    });
    expect(organization.statusCode).toBe(201);
    const rejected = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: `aether_session=${session}; aether_csrf=${csrf}` },
    });
    expect(rejected.statusCode).toBe(403);
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie: `aether_session=${session}` },
    });
    expect(afterLogout.statusCode).toBe(401);
    await app.close();
  });

  it("recorre por HTTP la iniciativa desde borrador hasta decisión y conserva su auditoría", async () => {
    const tenancyStore = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenancyStore,
      ids: { next: () => crypto.randomUUID() },
      tokens: {
        generate: () => "x".repeat(43),
        hash: (value) => `hash:${value}`,
      },
      clock: { now: () => new Date() },
    });
    const initiativeStore = new InMemoryInitiativeStore();
    const auditStore = new InMemoryInitiativeAuditStore();
    const auditHistory = new AuditHistoryService({
      store: new InMemoryAuditHistoryStore(auditStore),
      tenancy: tenancyStore,
    });
    const initiatives = new InitiativeService({
      store: initiativeStore,
      audit: auditStore,
      tenancy: tenancyStore,
      ids: { next: () => crypto.randomUUID() },
      clock: { now: () => new Date() },
    });
    const evaluations = new EvaluationService({
      standards: new InMemoryEvaluationStandardStore(),
      evaluations: new InMemoryEvaluationStore(),
      initiatives: initiativeStore,
      audit: auditStore,
      tenancy: tenancyStore,
      ids: { next: () => crypto.randomUUID() },
      clock: { now: () => new Date() },
    });
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: 3600,
      sessionRenewalWindowSeconds: 600,
    });
    const metricsStore = new InMemoryProductMetricsStore();
    const productMetrics = new ProductMetricsService({
      store: metricsStore,
      tenancy: tenancyStore,
      clock: { now: () => new Date("2026-04-01T00:00:00.000Z") },
    });
    const deadLetters = new Map<
      string,
      {
        eventId: string;
        eventType: string;
        organizationId: string;
        aggregateId: string;
        aggregateType: string;
        aggregateVersion: number;
        correlationId: string;
        attempts: number;
        failedAt: Date;
        lastError: string;
      }
    >();
    const outboxAdministration = new OutboxAdministrationService({
      store: {
        async listDeadLetters({ organizationId }) {
          return [...deadLetters.values()].filter(
            (letter) => letter.organizationId === organizationId,
          );
        },
        async replayDeadLetter({ eventId, organizationId }) {
          const letter = deadLetters.get(eventId);
          if (!letter || letter.organizationId !== organizationId) return false;
          deadLetters.delete(eventId);
          return true;
        },
      },
      tenancy: tenancyStore,
      clock: { now: () => new Date("2026-04-01T00:00:00.000Z") },
      ids: { next: () => crypto.randomUUID() },
    });
    const app = await buildServer({
      config,
      auth,
      tenants,
      initiatives,
      evaluations,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
      auditHistory,
      productMetrics,
      outboxAdministration,
    });
    const login = await app.inject({ method: "GET", url: "/auth/login" });
    const state = new URL(login.headers.location!).searchParams.get("state")!;
    const callback = await app.inject({
      method: "GET",
      url: `/auth/callback?code=code&state=${state}`,
      headers: {
        cookie: `aether_oidc_tx=${cookieValue(responseCookies(login), "aether_oidc_tx")}`,
      },
    });
    const session = cookieValue(responseCookies(callback), "aether_session");
    const csrf = cookieValue(responseCookies(callback), "aether_csrf");
    const headers = {
      origin: config.webOrigin,
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
      cookie: `aether_session=${session}; aether_csrf=${csrf}`,
    };

    const organizationResponse = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers,
      payload: { name: "Aether Test", timezone: "UTC", locale: "es-CL" },
    });
    expect(organizationResponse.statusCode).toBe(201);
    const organization = organizationResponse.json() as { id: string };
    metricsStore.setSnapshot(organization.id, {
      calculationVersion: "2026-09-v1",
      timezone: "UTC",
      calculatedAt: new Date("2026-04-01T00:00:00.000Z"),
      period: {
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      initiativeDecision: {
        decidedCount: 2,
        averageHours: 36,
        medianHours: 36,
      },
      decisionEvidence: {
        decidedCount: 2,
        decisionsWithVerifiedEvidence: 1,
        coveragePercent: 50,
      },
      conversion: {
        approvedDecisions: 1,
        projectsCreatedFromApprovedDecisions: 1,
        conversionPercent: 100,
      },
      activeProjects: {
        activeOrBlockedCount: 1,
        withAssignedLeadCount: 1,
        withUpcomingMilestoneCount: 1,
        staleForThirtyDaysCount: 0,
      },
      closures: {
        closedCount: 0,
        withLessonsLearnedCount: 0,
        lessonsCoveragePercent: null,
      },
    });
    const productMetricsResponse = await app.inject({
      method: "GET",
      url: `/v1/admin/product-metrics?organizationId=${organization.id}`,
      headers: { cookie: headers.cookie },
    });
    expect(productMetricsResponse.statusCode).toBe(200);
    expect(productMetricsResponse.json()).toMatchObject({
      calculationVersion: "2026-09-v1",
      timezone: "UTC",
      initiativeDecision: { medianHours: 36 },
      decisionEvidence: { coveragePercent: 50 },
      closures: { lessonsCoveragePercent: null },
    });
    const deadLetterId = crypto.randomUUID();
    deadLetters.set(deadLetterId, {
      eventId: deadLetterId,
      eventType: "project.created.v1",
      organizationId: organization.id,
      aggregateId: crypto.randomUUID(),
      aggregateType: "project",
      aggregateVersion: 1,
      correlationId: crypto.randomUUID(),
      attempts: 5,
      failedAt: new Date("2026-04-01T00:00:00.000Z"),
      lastError: "Dependency unavailable",
    });
    const deadLettersResponse = await app.inject({
      method: "GET",
      url: `/v1/admin/outbox/dead-letters?organizationId=${organization.id}`,
      headers: { cookie: headers.cookie },
    });
    expect(deadLettersResponse.statusCode).toBe(200);
    expect(deadLettersResponse.json()).toEqual([
      expect.objectContaining({ eventId: deadLetterId, attempts: 5 }),
    ]);
    const replayResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/outbox/dead-letters/${deadLetterId}/replay`,
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      payload: {
        organizationId: organization.id,
        reason: "La dependencia ya se recuperó.",
      },
    });
    expect(replayResponse.statusCode).toBe(202);
    expect(deadLetters.has(deadLetterId)).toBe(false);
    const foreignOrganizationId = crypto.randomUUID();
    const foreignMetrics = await app.inject({
      method: "GET",
      url: `/v1/admin/product-metrics?organizationId=${foreignOrganizationId}`,
      headers: { cookie: headers.cookie },
    });
    expect(foreignMetrics.statusCode).toBe(403);
    const foreignDeadLetters = await app.inject({
      method: "GET",
      url: `/v1/admin/outbox/dead-letters?organizationId=${foreignOrganizationId}`,
      headers: { cookie: headers.cookie },
    });
    expect(foreignDeadLetters.statusCode).toBe(403);
    const organizationsResponse = await app.inject({
      method: "GET",
      url: "/v1/organizations",
      headers: { cookie: headers.cookie },
    });
    expect(organizationsResponse.statusCode).toBe(200);
    expect(organizationsResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: organization.id }),
      ]),
    );
    const workspaceResponse = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers,
      payload: {
        organizationId: organization.id,
        name: "Estrategia",
        mode: "institutional",
      },
    });
    expect(workspaceResponse.statusCode).toBe(201);
    const workspace = workspaceResponse.json() as { id: string };
    const workspacesResponse = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.id}/workspaces`,
      headers: { cookie: headers.cookie },
    });
    expect(workspacesResponse.statusCode).toBe(200);
    expect(workspacesResponse.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: workspace.id })]),
    );
    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/initiatives",
      headers,
      payload: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        title: "Reducir tiempos de espera",
        problemStatement: "La atención tarda demasiado.",
        expectedOutcome: "Reducir la mediana de espera en el piloto.",
        classification: "internal",
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json() as { id: string; version: number };
    const replayedCreate = await app.inject({
      method: "POST",
      url: "/v1/initiatives",
      headers,
      payload: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        title: "Reducir tiempos de espera",
        problemStatement: "La atención tarda demasiado.",
        expectedOutcome: "Reducir la mediana de espera en el piloto.",
        classification: "internal",
      },
    });
    expect(replayedCreate.statusCode).toBe(201);
    expect(replayedCreate.headers["idempotent-replayed"]).toBe("true");
    expect(replayedCreate.json()).toMatchObject({ id: created.id });
    const reusedKey = await app.inject({
      method: "POST",
      url: "/v1/initiatives",
      headers,
      payload: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        title: "Otra iniciativa",
        problemStatement: "Otro problema.",
        expectedOutcome: "Otro resultado.",
        classification: "internal",
      },
    });
    expect(reusedKey.statusCode).toBe(409);
    expect(reusedKey.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const editedResponse = await app.inject({
      method: "PATCH",
      url: `/v1/initiatives/${created.id}?organizationId=${organization.id}`,
      headers,
      payload: {
        expectedVersion: created.version,
        title: "Reducir tiempos de espera en atención",
        problemStatement: "La atención tarda demasiado.",
        expectedOutcome: "Reducir la mediana de espera en el piloto.",
        classification: "internal",
      },
    });
    expect(editedResponse.statusCode).toBe(200);
    const edited = editedResponse.json() as { version: number };

    const presentedResponse = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/submit?organizationId=${organization.id}`,
      headers,
      payload: { expectedVersion: edited.version },
    });
    expect(presentedResponse.statusCode).toBe(200);
    const presented = presentedResponse.json() as {
      status: string;
      version: number;
    };
    expect(presented.status).toBe("presented");

    const standardResponse = await app.inject({
      method: "POST",
      url: "/v1/evaluation-standards",
      headers,
      payload: {
        organizationId: organization.id,
        name: "Estándar inicial",
        version: 1,
        criteria: [
          {
            id: crypto.randomUUID(),
            code: "IMPACT",
            name: "Impacto",
            description: "La iniciativa demuestra un impacto institucional.",
            weight: 1,
          },
        ],
      },
    });
    expect(standardResponse.statusCode).toBe(201);
    const standard = standardResponse.json() as {
      id: string;
      criteria: { id: string }[];
    };
    const standardsResponse = await app.inject({
      method: "GET",
      url: `/v1/evaluation-standards?organizationId=${organization.id}`,
      headers: { cookie: headers.cookie },
    });
    expect(standardsResponse.statusCode).toBe(200);
    expect(standardsResponse.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: standard.id })]),
    );
    const activated = await app.inject({
      method: "POST",
      url: `/v1/evaluation-standards/${standard.id}/activate`,
      headers,
      payload: { organizationId: organization.id },
    });
    expect(activated.statusCode).toBe(204);

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/review?organizationId=${organization.id}`,
      headers,
      payload: {
        expectedVersion: presented.version,
        standardId: standard.id,
        results: [
          {
            criterionId: standard.criteria[0]!.id,
            assessment: "met",
            evidence: ["Indicador de espera validado."],
          },
        ],
      },
    });
    expect(reviewResponse.statusCode).toBe(200);
    const review = reviewResponse.json() as {
      evaluation: { id: string };
      initiative: { version: number };
    };
    const evaluationResponse = await app.inject({
      method: "GET",
      url: `/v1/evaluations/${review.evaluation.id}?organizationId=${organization.id}`,
      headers: { cookie: headers.cookie },
    });
    expect(evaluationResponse.statusCode).toBe(200);
    expect(evaluationResponse.json()).toMatchObject({
      id: review.evaluation.id,
      initiativeId: created.id,
    });
    const decisionResponse = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/decide?organizationId=${organization.id}`,
      headers,
      payload: {
        expectedVersion: review.initiative.version,
        evaluationId: review.evaluation.id,
        outcome: "approved",
        rationale: "Impacto y evidencia suficientes.",
        evidence: ["Acta de comité."],
      },
    });
    expect(decisionResponse.statusCode).toBe(200);
    const decision = decisionResponse.json() as { decision: { id: string } };
    expect(decision).toMatchObject({
      initiative: { status: "approved", allowedActions: [] },
    });
    const decisionDetailResponse = await app.inject({
      method: "GET",
      url: `/v1/decisions/${decision.decision.id}?organizationId=${organization.id}`,
      headers: { cookie: headers.cookie },
    });
    expect(decisionDetailResponse.statusCode).toBe(200);
    expect(decisionDetailResponse.json()).toMatchObject({
      id: decision.decision.id,
      initiativeId: created.id,
      outcome: "approved",
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: `/v1/initiatives/${created.id}/audit-events?organizationId=${organization.id}`,
      headers: { cookie: headers.cookie },
    });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "initiative.created.v1" }),
        expect.objectContaining({ eventType: "initiative.edited.v1" }),
        expect.objectContaining({ eventType: "initiative.presented.v1" }),
        expect.objectContaining({ eventType: "initiative.evaluated.v1" }),
        expect.objectContaining({ eventType: "initiative.decided.v2" }),
      ]),
    );
    for (const [resourceType, resourceId, action] of [
      ["initiative", created.id, "initiative.created.v1"],
      ["evaluation", review.evaluation.id, "initiative.evaluated.v1"],
      ["decision", decision.decision.id, "initiative.decided.v2"],
    ] as const) {
      const history = await app.inject({
        method: "GET",
        url: `/v1/audit-events?organizationId=${organization.id}&resourceType=${resourceType}&resourceId=${resourceId}`,
        headers: { cookie: headers.cookie },
      });
      expect(history.statusCode).toBe(200);
      expect(history.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action,
            actorId: "actor-123",
            result: "succeeded",
          }),
        ]),
      );
    }
    await app.close();
  });
});
