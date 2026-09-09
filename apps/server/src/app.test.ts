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
  TenantService,
} from "@aether/application";
import {
  InMemoryEvaluationStandardStore,
  InMemoryEvaluationStore,
  InMemoryInitiativeAuditStore,
  InMemoryAuditHistoryStore,
  InMemoryInitiativeStore,
  InMemoryTenantStore,
} from "@aether/testkit";

import { buildServer } from "./app.js";
import type { ServerConfig } from "./config.js";

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
  async revokeSession(sessionId: string, now: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) this.sessions.set(sessionId, { ...session, revokedAt: now });
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
  sessionEncryptionKey: "K5Ahk0FQ4+zxKxg4atlrPkS0vP0w+ZsSCx6x8v4hX3c=",
  sessionTtlSeconds: 3600,
  sessionRenewalWindowSeconds: 600,
  secureCookies: false,
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
    const app = await buildServer({
      config,
      auth,
      tenants,
      initiatives,
      evaluations,
      projects: {} as ProjectService,
      auditHistory,
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
