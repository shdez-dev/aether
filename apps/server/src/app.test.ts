import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
  AuthService,
  createAesGcmCipher,
  hashOpaqueToken,
  OidcProviderUnavailableError,
  type AuthSession,
  type AuthStore,
  type LoginTransaction,
  type OidcProvider,
} from "@aether/auth";
import { ApiProblemSchema } from "@aether/contracts";
import { parse } from "yaml";
import {
  EvaluationService,
  DiagnosticService,
  IntakeService,
  TriageService,
  AuditHistoryService,
  InitiativeService,
  DocumentService,
  DocumentScanService,
  ProjectService,
  ProductMetricsService,
  type SecurityAuditStore,
  OutboxAdministrationService,
  TemporaryAccessGrantService,
  SupportAccessService,
  TenantService,
  CapacityService,
} from "@aether/application";
import {
  InMemoryEvaluationStandardStore,
  InMemoryEvaluationStore,
  InMemoryInitiativeAuditStore,
  InMemoryAuditHistoryStore,
  InMemoryInitiativeStore,
  InMemoryIntakeAssignmentStore,
  InMemoryIdempotencyStore,
  InMemoryTenantStore,
  InMemoryProductMetricsStore,
  InMemoryTemporaryAccessGrantStore,
  InMemorySupportAccessGrantStore,
  InMemorySupportOperatorDirectory,
  InMemoryDocumentObjectStore,
  InMemoryDocumentProjectAccess,
  InMemoryDocumentStore,
  InMemoryTriageStandardStore,
  InMemoryTriageStore,
} from "@aether/testkit";

import { buildServer, PublicHttpRoutes } from "./app.js";
import type { ServerConfig } from "./config.js";

const testSessionEncryptionKey = Buffer.alloc(32).toString("base64");
class InMemoryAuthStore implements AuthStore {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly transactions = new Map<string, LoginTransaction>();
  private readonly identities = new Map<string, string>();
  activeSessionLookups = 0;
  async resolveIdentity(input: {
    id: string;
    issuer: string;
    subject: string;
    email: string | null;
    authenticatedAt: Date;
  }): Promise<{ actorId: string }> {
    const key = `${input.issuer}:${input.subject}`;
    const actorId = this.identities.get(key) ?? input.id;
    this.identities.set(key, actorId);
    return { actorId };
  }
  async createSession(session: AuthSession): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSession | null> {
    this.activeSessionLookups++;
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
  async rotateSession(input: {
    actorId: string;
    sessionId: string;
    replacement: AuthSession;
    now: Date;
  }): Promise<boolean> {
    const current = this.sessions.get(input.sessionId);
    if (!current || current.actorId !== input.actorId || current.revokedAt)
      return false;
    this.sessions.set(current.id, { ...current, revokedAt: input.now });
    this.sessions.set(input.replacement.id, input.replacement);
    return true;
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
  recentAuthMaxAgeSeconds: 900,
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
  supportOperatorActorIds: [],
};
const oidc: OidcProvider = {
  async buildAuthorizationUrl({ state }) {
    return `https://identity.example/authorize?state=${state}`;
  },
  async exchangeAuthorizationCode() {
    return { subject: "actor-123", email: "actor@example.test" };
  },
};

async function createAuthenticatedSession(
  store: InMemoryAuthStore,
  input: { token: string; actorId: string; actorEmail: string },
): Promise<void> {
  const now = new Date();
  await store.createSession({
    id: crypto.randomUUID(),
    tokenHash: hashOpaqueToken(input.token),
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    issuer: config.oidcIssuerUrl,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + config.sessionTtlSeconds * 1_000),
    revokedAt: null,
  });
}

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
  it("deniega anónimos por defecto y conserva explícitas las rutas públicas", async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    await expect(
      app.inject({ method: "GET", url: "/health" }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(
      app.inject({ method: "GET", url: "/v1/organizations" }),
    ).resolves.toMatchObject({ statusCode: 401 });
    await expect(
      app.inject({ method: "GET", url: "/auth/sessions" }),
    ).resolves.toMatchObject({ statusCode: 401 });
    await createAuthenticatedSession(authStore, {
      token: "single-authentication-per-request",
      actorId: "authenticated-actor",
      actorEmail: "actor@example.test",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: {
            cookie: "aether_session=single-authentication-per-request",
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(authStore.activeSessionLookups).toBe(1);
    await app.close();
  });

  it("requires a session for every cookie-protected OpenAPI operation", async () => {
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    const spec = parse(
      await readFile(
        new URL(
          "../../../packages/contracts/openapi/aether.v1.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      paths: Record<
        string,
        Record<string, { security?: readonly Record<string, unknown>[] }>
      >;
    };
    const unsafeMethods = new Set(["post", "put", "patch", "delete"]);
    const protectedOperations = Object.entries(spec.paths).flatMap(
      ([path, operations]) =>
        Object.entries(operations).flatMap(([method, operation]) =>
          operation.security?.some((entry) => "cookieSession" in entry)
            ? [[method, path] as const]
            : [],
        ),
    );
    expect(protectedOperations.length).toBeGreaterThan(0);
    for (const [method, path] of protectedOperations) {
      const response = await app.inject({
        method: method.toUpperCase() as
          "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        url: path.replaceAll(
          /\{[^}]+\}/g,
          "00000000-0000-4000-8000-000000000001",
        ),
        ...(unsafeMethods.has(method)
          ? {
              headers: {
                origin: config.webOrigin,
                "x-csrf-token": "openapi-auth-boundary",
                cookie: "aether_csrf=openapi-auth-boundary",
              },
            }
          : {}),
      });
      expect(response.statusCode, `${method.toUpperCase()} ${path}`).toBe(401);
    }
    await app.close();
  });

  it("authenticates one valid session before processing every protected OpenAPI operation", async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    const spec = parse(
      await readFile(
        new URL(
          "../../../packages/contracts/openapi/aether.v1.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      paths: Record<
        string,
        Record<string, { security?: readonly Record<string, unknown>[] }>
      >;
    };
    const unsafeMethods = new Set(["post", "put", "patch", "delete"]);
    const protectedOperations = Object.entries(spec.paths).flatMap(
      ([path, operations]) =>
        Object.entries(operations).flatMap(([method, operation]) =>
          operation.security?.some((entry) => "cookieSession" in entry)
            ? [[method, path] as const]
            : [],
        ),
    );
    for (const [index, [method, path]] of protectedOperations.entries()) {
      const token = `authenticated-openapi-operation-${index}`;
      await createAuthenticatedSession(authStore, {
        token,
        actorId: `authenticated-actor-${index}`,
        actorEmail: `actor-${index}@example.test`,
      });
      const beforeLookups = authStore.activeSessionLookups;
      const response = await app.inject({
        method: method.toUpperCase() as
          "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        url: path.replaceAll(
          /\{[^}]+\}/g,
          "00000000-0000-4000-8000-000000000001",
        ),
        headers: {
          cookie: `aether_session=${token}; aether_csrf=openapi-auth-boundary`,
          ...(unsafeMethods.has(method)
            ? {
                origin: config.webOrigin,
                "x-csrf-token": "openapi-auth-boundary",
              }
            : {}),
        },
      });
      const operation = `${method.toUpperCase()} ${path}`;
      expect(authStore.activeSessionLookups - beforeLookups, operation).toBe(1);
      expect(response.statusCode, operation).not.toBe(401);
    }
    await app.close();
  });

  it("keeps public Fastify routes aligned with the OpenAPI security contract", async () => {
    const spec = parse(
      await readFile(
        new URL(
          "../../../packages/contracts/openapi/aether.v1.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      paths: Record<
        string,
        Record<string, { security?: readonly Record<string, unknown>[] }>
      >;
    };
    const publiclyReachablePaths = Object.entries(spec.paths).flatMap(
      ([path, operations]) =>
        Object.values(operations).some(
          (operation) =>
            operation.security?.length === 0 ||
            operation.security?.some((entry) => "metricsToken" in entry),
        )
          ? [path]
          : [],
    );
    expect([...PublicHttpRoutes].sort()).toEqual(publiclyReachablePaths.sort());
  });

  it("expone indisponibilidad de OIDC sin iniciar una transacción ni una sesión", async () => {
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc: {
        async buildAuthorizationUrl() {
          throw new OidcProviderUnavailableError();
        },
        async exchangeAuthorizationCode() {
          throw new OidcProviderUnavailableError();
        },
      },
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    const response = await app.inject({ method: "GET", url: "/auth/login" });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.json()).toMatchObject({
      code: "OIDC_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(responseCookies(response)).toEqual([]);
    await app.close();
  });

  it("publica la capacidad y redirige sólo al portal de cuenta OIDC configurado", async () => {
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const dependencies = {
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    };
    const unavailableApp = await buildServer({ config, ...dependencies });

    const unavailableStatus = await unavailableApp.inject({
      method: "GET",
      url: "/auth/account-management/status",
    });
    expect(unavailableStatus.statusCode).toBe(200);
    expect(unavailableStatus.json()).toEqual({
      available: false,
      authority: "oidc-provider",
    });
    const unavailableRedirect = await unavailableApp.inject({
      method: "GET",
      url: "/auth/account-management",
    });
    expect(unavailableRedirect.statusCode).toBe(404);
    expect(unavailableRedirect.json()).toMatchObject({
      code: "ACCOUNT_MANAGEMENT_UNAVAILABLE",
    });
    await unavailableApp.close();

    const accountManagementUrl = "https://identity.example/realms/test/account";
    const availableApp = await buildServer({
      config: { ...config, oidcAccountManagementUrl: accountManagementUrl },
      ...dependencies,
    });
    const availableStatus = await availableApp.inject({
      method: "GET",
      url: "/auth/account-management/status",
    });
    expect(availableStatus.statusCode).toBe(200);
    expect(availableStatus.json()).toEqual({
      available: true,
      authority: "oidc-provider",
    });
    const redirect = await availableApp.inject({
      method: "GET",
      url: "/auth/account-management",
    });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe(accountManagementUrl);
    await availableApp.close();
  });

  it("aplica autorización contextual y aislamiento de organizaciones en los endpoints de tenencia", async () => {
    const authStore = new InMemoryAuthStore();
    const securityAuditEvents: Array<
      Parameters<SecurityAuditStore["record"]>[0]
    > = [];
    const tenants = new TenantService({
      store: new InMemoryTenantStore(),
      ids: { next: () => crypto.randomUUID() },
      tokens: {
        generate: () => "x".repeat(43),
        hash: (value) => `hash:${value}`,
      },
      clock: { now: () => new Date("2026-09-08T12:00:00.000Z") },
    });
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const app = await buildServer({
      config,
      auth,
      tenants,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
      securityAudit: {
        async record(event) {
          securityAuditEvents.push(event);
        },
      },
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Organización A",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Workspace A",
      mode: "team",
    });
    const ownerToken = "owner-session-token";
    const ownerCsrf = "owner-csrf-token";
    await createAuthenticatedSession(authStore, {
      token: ownerToken,
      actorId: "owner",
      actorEmail: "owner@example.test",
    });
    const createdTeam = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/workspaces/${workspace.id}/teams`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": ownerCsrf,
        "idempotency-key": "create-team-key",
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
      payload: { name: "Método", memberActorIds: ["owner"] },
    });
    expect(createdTeam.statusCode).toBe(201);
    const replayedTeam = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/workspaces/${workspace.id}/teams`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": ownerCsrf,
        "idempotency-key": "create-team-key",
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
      payload: { name: "Método", memberActorIds: ["owner"] },
    });
    expect(replayedTeam.statusCode).toBe(201);
    expect(replayedTeam.headers["idempotent-replayed"]).toBe("true");
    expect(replayedTeam.json()).toMatchObject({ id: createdTeam.json().id });
    const replaceTeamMembers = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organization.id}/workspaces/${workspace.id}/teams/${createdTeam.json().id}/members`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": ownerCsrf,
        "idempotency-key": "replace-team-members-key",
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
      payload: { memberActorIds: ["owner"] },
    });
    expect(replaceTeamMembers.statusCode).toBe(204);
    const replayedTeamMembers = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organization.id}/workspaces/${workspace.id}/teams/${createdTeam.json().id}/members`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": ownerCsrf,
        "idempotency-key": "replace-team-members-key",
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
      payload: { memberActorIds: ["owner"] },
    });
    expect(replayedTeamMembers.statusCode).toBe(204);
    expect(replayedTeamMembers.headers["idempotent-replayed"]).toBe("true");
    const invitationKey = crypto.randomUUID();
    const createdInvitation = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/invitations`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": ownerCsrf,
        "idempotency-key": invitationKey,
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
      payload: {
        email: "idempotent-invitation@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "viewer",
        expiresInDays: 7,
      },
    });
    expect(createdInvitation.statusCode).toBe(201);
    const replayedInvitation = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/invitations`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": ownerCsrf,
        "idempotency-key": invitationKey,
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
      payload: {
        email: "idempotent-invitation@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "viewer",
        expiresInDays: 7,
      },
    });
    expect(replayedInvitation.statusCode).toBe(201);
    expect(replayedInvitation.headers["idempotent-replayed"]).toBe("true");
    expect(replayedInvitation.json()).toMatchObject({
      id: createdInvitation.json().id,
    });
    const invitation = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "viewer@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    const originalViewerToken = "viewer-session-token";
    const originalViewerCsrf = "viewer-csrf-token";
    await createAuthenticatedSession(authStore, {
      token: originalViewerToken,
      actorId: "viewer",
      actorEmail: "viewer@example.test",
    });
    const invitationAccepted = await app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": originalViewerCsrf,
        "idempotency-key": "accept-invitation-key",
        cookie: `aether_session=${originalViewerToken}; aether_csrf=${originalViewerCsrf}`,
      },
      payload: { token: invitation.deliveryToken },
    });
    expect(invitationAccepted.statusCode).toBe(200);
    const rotatedCookies = responseCookies(invitationAccepted);
    const rotatedSessionCookie = [...rotatedCookies]
      .reverse()
      .find((cookie) => cookie.startsWith("aether_session="));
    if (!rotatedSessionCookie)
      throw new Error("Rotated session cookie not found");
    const viewerToken = rotatedSessionCookie
      .split(";")[0]!
      .slice("aether_session=".length);
    const viewerCsrf = cookieValue(rotatedCookies, "aether_csrf");
    expect(viewerToken).not.toBe(originalViewerToken);
    expect(viewerCsrf).not.toBe(originalViewerCsrf);
    const replayedInvitationAcceptance = await app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": viewerCsrf,
        "idempotency-key": "accept-invitation-key",
        cookie: `aether_session=${viewerToken}; aether_csrf=${viewerCsrf}`,
      },
      payload: { token: invitation.deliveryToken },
    });
    expect(replayedInvitationAcceptance.statusCode).toBe(200);
    expect(replayedInvitationAcceptance.headers["idempotent-replayed"]).toBe(
      "true",
    );
    expect(replayedInvitationAcceptance.json()).toEqual(
      invitationAccepted.json(),
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: { cookie: `aether_session=${originalViewerToken}` },
        })
      ).statusCode,
    ).toBe(401);
    const rejectedInvitation = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "rejecting-viewer@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    const rejectingToken = "rejecting-viewer-session";
    const rejectingCsrf = "rejecting-viewer-csrf";
    await createAuthenticatedSession(authStore, {
      token: rejectingToken,
      actorId: "rejecting-viewer",
      actorEmail: "rejecting-viewer@example.test",
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/invitations/reject",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": rejectingCsrf,
        "idempotency-key": "reject-invitation-key",
        cookie: `aether_session=${rejectingToken}; aether_csrf=${rejectingCsrf}`,
      },
      payload: { token: rejectedInvitation.deliveryToken },
    });
    expect(rejected.statusCode).toBe(204);
    const replayedRejection = await app.inject({
      method: "POST",
      url: "/v1/invitations/reject",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": rejectingCsrf,
        "idempotency-key": "reject-invitation-key",
        cookie: `aether_session=${rejectingToken}; aether_csrf=${rejectingCsrf}`,
      },
      payload: { token: rejectedInvitation.deliveryToken },
    });
    expect(replayedRejection.statusCode).toBe(204);
    expect(replayedRejection.headers["idempotent-replayed"]).toBe("true");
    const rejectedAcceptance = await app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": rejectingCsrf,
        cookie: `aether_session=${rejectingToken}; aether_csrf=${rejectingCsrf}`,
      },
      payload: { token: rejectedInvitation.deliveryToken },
    });
    expect(rejectedAcceptance.statusCode).toBe(400);
    expect(rejectedAcceptance.json()).toMatchObject({
      code: "INVITATION_INVALID_OR_EXPIRED",
    });
    const revokedInvitation = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "revoked-viewer@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    const forbiddenRevocation = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/${organization.id}/invitations/${revokedInvitation.invitation.id}`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": viewerCsrf,
        cookie: `aether_session=${viewerToken}; aether_csrf=${viewerCsrf}`,
      },
    });
    expect(forbiddenRevocation.statusCode).toBe(403);
    const revoked = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/${organization.id}/invitations/${revokedInvitation.invitation.id}`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": ownerCsrf,
        "idempotency-key": "revoke-invitation-key",
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
    });
    expect(revoked.statusCode).toBe(204);
    const replayedRevocation = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/${organization.id}/invitations/${revokedInvitation.invitation.id}`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": ownerCsrf,
        "idempotency-key": "revoke-invitation-key",
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
    });
    expect(replayedRevocation.statusCode).toBe(204);
    expect(replayedRevocation.headers["idempotent-replayed"]).toBe("true");
    const otherOrganization = await tenants.createOrganization({
      actorId: "other-owner",
      actorEmail: "other-owner@example.test",
      name: "Organización B",
      timezone: "UTC",
      locale: "es-CL",
    });
    const otherWorkspace = await tenants.createWorkspace({
      actorId: "other-owner",
      organizationId: otherOrganization.id,
      name: "Workspace B",
      mode: "team",
    });
    const viewerCookie = `aether_session=${viewerToken}; aether_csrf=${viewerCsrf}`;
    const mutationHeaders = {
      origin: config.webOrigin,
      "x-csrf-token": viewerCsrf,
      cookie: viewerCookie,
    };

    const capabilities = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.id}/capabilities?workspaceId=${workspace.id}`,
      headers: { cookie: viewerCookie },
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toEqual({
      accessLevels: ["READ"],
      canReadOrganization: true,
      canManageOrganization: false,
      canCreateWorkspace: false,
      canReadWorkspace: true,
      canManageWorkspace: false,
      canInviteMembers: false,
    });
    const visibleWorkspaces = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.id}/workspaces`,
      headers: { cookie: viewerCookie },
    });
    expect(visibleWorkspaces.statusCode).toBe(200);
    expect(visibleWorkspaces.json()).toEqual([
      expect.objectContaining({ id: workspace.id }),
    ]);
    const readableWorkspace = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}?organizationId=${organization.id}`,
      headers: { cookie: viewerCookie },
    });
    expect(readableWorkspace.statusCode).toBe(200);
    const visibleTeams = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.id}/workspaces/${workspace.id}/teams`,
      headers: { cookie: viewerCookie },
    });
    expect(visibleTeams.statusCode).toBe(200);
    expect(visibleTeams.json()).toEqual([
      expect.objectContaining({
        id: createdTeam.json().id,
        memberActorIds: ["owner"],
      }),
    ]);
    const deniedTeamCreation = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/workspaces/${workspace.id}/teams`,
      headers: mutationHeaders,
      payload: { name: "No permitido", memberActorIds: [] },
    });
    expect(deniedTeamCreation.statusCode).toBe(403);

    const deniedWorkspaceCreation = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: mutationHeaders,
      payload: {
        organizationId: organization.id,
        name: "No permitido",
        mode: "team",
      },
    });
    expect(deniedWorkspaceCreation.statusCode).toBe(403);
    const deniedWorkspaceProblem = ApiProblemSchema.parse(
      deniedWorkspaceCreation.json(),
    );
    expect(deniedWorkspaceProblem).toMatchObject({
      code: "FORBIDDEN",
      detail: "No tiene autorización para realizar esta operación.",
      type: "https://aether.local/problems/authorization",
    });
    expect(deniedWorkspaceCreation.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(deniedWorkspaceProblem.correlationId).toBe(
      deniedWorkspaceCreation.headers["x-correlation-id"],
    );
    const invalidWorkspaceCreation = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: mutationHeaders,
      payload: {
        organizationId: organization.id,
        name: "",
        mode: "team",
      },
    });
    expect(invalidWorkspaceCreation.statusCode).toBe(400);
    expect(
      ApiProblemSchema.parse(invalidWorkspaceCreation.json()),
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      retryable: false,
      type: "https://aether.local/problems/validation",
      errors: [
        {
          field: "name",
          message: "El valor no cumple el formato requerido.",
        },
      ],
    });
    const deniedInvitation = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/invitations`,
      headers: mutationHeaders,
      payload: {
        email: "blocked@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "viewer",
        expiresInDays: 7,
      },
    });
    expect(deniedInvitation.statusCode).toBe(403);
    const deniedArchive = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/workspaces/${workspace.id}/archive`,
      headers: mutationHeaders,
    });
    expect(deniedArchive.statusCode).toBe(403);
    const hiddenWorkspace = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${otherWorkspace.id}?organizationId=${organization.id}`,
      headers: { cookie: viewerCookie },
    });
    expect(hiddenWorkspace.statusCode).toBe(404);
    const forbiddenOrganization = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${otherWorkspace.id}?organizationId=${otherOrganization.id}`,
      headers: { cookie: viewerCookie },
    });
    expect(forbiddenOrganization.statusCode).toBe(403);
    expect(securityAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "viewer",
          action: "security.authorization_denied.v1",
          method: "POST",
          path: "/v1/workspaces",
          statusCode: 403,
          metadata: {},
        }),
        expect.objectContaining({
          actorId: "viewer",
          action: "security.authorization_denied.v1",
          method: "GET",
          path: `/v1/workspaces/${otherWorkspace.id}`,
          statusCode: 403,
          correlationId: forbiddenOrganization.headers["x-correlation-id"],
          metadata: {},
        }),
      ]),
    );
    await app.close();
  });

  it("uses HttpOnly opaque cookies and requires Origin plus double-submit CSRF on logout", async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
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
      clock: { now: () => new Date("2026-09-08T12:00:00.000Z") },
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
    const authenticatedActorId = (
      await app.inject({
        method: "GET",
        url: "/auth/session",
        headers: { cookie: `aether_session=${session}` },
      })
    ).json().actorId as string;
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
      payload: {
        name: "Aether Test",
        organizationType: "institutional",
        timezone: "UTC",
        locale: "es-CL",
        policy: { dataResidencyRegion: "cl", retentionDays: 365 },
      },
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
      payload: {
        name: "Aether Test",
        organizationType: "institutional",
        timezone: "UTC",
        locale: "es-CL",
        policy: { dataResidencyRegion: "cl", retentionDays: 365 },
      },
    });
    expect(organization.statusCode).toBe(201);
    expect(organization.json()).toMatchObject({
      organizationType: "institutional",
    });
    const workspace = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: {
        organizationId: organization.json().id,
        name: "Archivo",
        mode: "team",
      },
    });
    expect(workspace.statusCode).toBe(201);
    const effectivePolicy = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.json().id}/policy?workspaceId=${workspace.json().id}`,
      headers: { cookie: `aether_session=${session}` },
    });
    expect(effectivePolicy.statusCode).toBe(200);
    expect(effectivePolicy.json()).toMatchObject({
      dataResidencyRegion: { value: "cl", origin: "organization" },
      retentionDays: { value: 365, origin: "organization" },
      businessHours: {
        value: { mode: "disabled", timezone: "UTC", windows: [] },
        origin: "organization",
      },
      workspaceOverride: null,
    });
    const updatedOrganizationPolicy = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organization.json().id}/policy`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "update-organization-policy-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { dataResidencyRegion: "cl", retentionDays: 365 },
    });
    expect(updatedOrganizationPolicy.statusCode).toBe(200);
    const replayedOrganizationPolicy = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organization.json().id}/policy`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "update-organization-policy-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { dataResidencyRegion: "cl", retentionDays: 365 },
    });
    expect(replayedOrganizationPolicy.statusCode).toBe(200);
    expect(replayedOrganizationPolicy.headers["idempotent-replayed"]).toBe(
      "true",
    );
    expect(replayedOrganizationPolicy.json()).toEqual(
      updatedOrganizationPolicy.json(),
    );
    const override = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organization.json().id}/workspaces/${workspace.json().id}/policy-override`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "set-workspace-policy-override-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { dataResidencyRegion: "eu", retentionDays: null },
    });
    expect(override.statusCode).toBe(200);
    const replayedOverride = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organization.json().id}/workspaces/${workspace.json().id}/policy-override`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "set-workspace-policy-override-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { dataResidencyRegion: "eu", retentionDays: null },
    });
    expect(replayedOverride.statusCode).toBe(200);
    expect(replayedOverride.headers["idempotent-replayed"]).toBe("true");
    expect(replayedOverride.json()).toEqual(override.json());
    const overriddenPolicy = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.json().id}/policy?workspaceId=${workspace.json().id}`,
      headers: { cookie: `aether_session=${session}` },
    });
    expect(overriddenPolicy.json()).toMatchObject({
      dataResidencyRegion: { value: "eu", origin: "workspace" },
      retentionDays: { value: 365, origin: "organization" },
    });
    const clearedOverride = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/${organization.json().id}/workspaces/${workspace.json().id}/policy-override`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "clear-workspace-policy-override-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
    });
    expect(clearedOverride.statusCode).toBe(204);
    const replayedClearedOverride = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/${organization.json().id}/workspaces/${workspace.json().id}/policy-override`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "clear-workspace-policy-override-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
    });
    expect(replayedClearedOverride.statusCode).toBe(204);
    expect(replayedClearedOverride.headers["idempotent-replayed"]).toBe("true");
    const archivedWorkspace = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/workspaces/${workspace.json().id}/archive`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "archive-workspace-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
    });
    expect(archivedWorkspace.statusCode).toBe(204);
    const replayedArchivedWorkspace = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/workspaces/${workspace.json().id}/archive`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "archive-workspace-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
    });
    expect(replayedArchivedWorkspace.statusCode).toBe(204);
    expect(replayedArchivedWorkspace.headers["idempotent-replayed"]).toBe(
      "true",
    );
    const archivedWorkspaceDetail = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.json().id}?organizationId=${organization.json().id}`,
      headers: { cookie: `aether_session=${session}` },
    });
    expect(archivedWorkspaceDetail.json()).toMatchObject({
      status: "archived",
      archivedByActorId: authenticatedActorId,
    });
    const invitation = await tenants.invite({
      actorId: authenticatedActorId,
      organizationId: organization.json().id,
      email: "next-owner@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "next-owner",
      actorEmail: "next-owner@example.test",
    });
    const staleSession = "stale-administrator-session";
    const staleSessionCreatedAt = new Date(
      Date.now() - (config.recentAuthMaxAgeSeconds + 1) * 1_000,
    );
    await authStore.createSession({
      id: crypto.randomUUID(),
      tokenHash: hashOpaqueToken(staleSession),
      actorId: authenticatedActorId,
      actorEmail: "actor@example.test",
      issuer: config.oidcIssuerUrl,
      createdAt: staleSessionCreatedAt,
      lastSeenAt: staleSessionCreatedAt,
      expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
      revokedAt: null,
    });
    const staleOwnershipTransfer = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/ownership-transfers`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${staleSession}; aether_csrf=${csrf}`,
      },
      payload: { targetActorId: "next-owner" },
    });
    expect(staleOwnershipTransfer.statusCode).toBe(403);
    expect(staleOwnershipTransfer.json()).toMatchObject({
      code: "RECENT_AUTH_REQUIRED",
    });
    const ownershipTransfer = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/ownership-transfers`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "transfer-organization-ownership-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { targetActorId: "next-owner" },
    });
    expect(ownershipTransfer.statusCode).toBe(204);
    const replayedOwnershipTransfer = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/ownership-transfers`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "transfer-organization-ownership-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { targetActorId: "next-owner" },
    });
    expect(replayedOwnershipTransfer.statusCode).toBe(204);
    expect(replayedOwnershipTransfer.headers["idempotent-replayed"]).toBe(
      "true",
    );
    await expect(
      tenants.capabilities({
        actorId: "next-owner",
        organizationId: organization.json().id,
      }),
    ).resolves.toMatchObject({ canManageOrganization: true });
    const repeatTransfer = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/ownership-transfers`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { targetActorId: "next-owner" },
    });
    expect(repeatTransfer.statusCode).toBe(403);
    const memberInvitation = await tenants.invite({
      actorId: authenticatedActorId,
      organizationId: organization.json().id,
      email: "suspended@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: memberInvitation.deliveryToken,
      actorId: "suspended-member",
      actorEmail: "suspended@example.test",
    });
    const staleReassignment = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/members/suspended-member/reassignments`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${staleSession}; aether_csrf=${csrf}`,
      },
      payload: { replacementActorId: "next-owner" },
    });
    expect(staleReassignment.statusCode).toBe(403);
    expect(staleReassignment.json()).toMatchObject({
      code: "RECENT_AUTH_REQUIRED",
    });
    const reassignment = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/members/suspended-member/reassignments`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "reassign-member-responsibilities-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { replacementActorId: "next-owner" },
    });
    expect(reassignment.statusCode).toBe(204);
    const replayedReassignment = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/members/suspended-member/reassignments`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "reassign-member-responsibilities-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { replacementActorId: "next-owner" },
    });
    expect(replayedReassignment.statusCode).toBe(204);
    expect(replayedReassignment.headers["idempotent-replayed"]).toBe("true");
    const staleSuspension = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/${organization.json().id}/members/suspended-member/status`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${staleSession}; aether_csrf=${csrf}`,
      },
      payload: { status: "suspended" },
    });
    expect(staleSuspension.statusCode).toBe(403);
    expect(staleSuspension.json()).toMatchObject({
      code: "RECENT_AUTH_REQUIRED",
    });
    const suspension = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/${organization.json().id}/members/suspended-member/status`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "change-membership-status-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { status: "suspended" },
    });
    expect(suspension.statusCode).toBe(204);
    const replayedSuspension = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/${organization.json().id}/members/suspended-member/status`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        "idempotency-key": "change-membership-status-key",
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { status: "suspended" },
    });
    expect(replayedSuspension.statusCode).toBe(204);
    expect(replayedSuspension.headers["idempotent-replayed"]).toBe("true");
    await expect(
      tenants.capabilities({
        actorId: "suspended-member",
        organizationId: organization.json().id,
      }),
    ).resolves.toMatchObject({ canReadOrganization: false });
    const enforcedOrganization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: {
        name: "Horario exigido",
        organizationType: "business",
        timezone: "UTC",
        locale: "es-CL",
        policy: {
          dataResidencyRegion: "cl",
          retentionDays: 365,
          businessHours: {
            mode: "enforce",
            timezone: "UTC",
            windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
          },
        },
      },
    });
    expect(enforcedOrganization.statusCode).toBe(201);
    const blockedWorkspace = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: {
        organizationId: enforcedOrganization.json().id,
        name: "Fuera de ventana",
        mode: "team",
      },
    });
    expect(blockedWorkspace.statusCode).toBe(403);
    expect(blockedWorkspace.json()).toMatchObject({
      code: "BUSINESS_HOURS_ENFORCED",
    });
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
    const intake = new IntakeService({
      assignments: new InMemoryIntakeAssignmentStore(
        initiativeStore,
        auditStore,
      ),
      initiatives: initiativeStore,
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
    const triage = new TriageService({
      standards: new InMemoryTriageStandardStore(),
      triages: new InMemoryTriageStore(auditStore),
      initiatives: initiativeStore,
      tenancy: tenancyStore,
      ids: { next: () => crypto.randomUUID() },
      clock: { now: () => new Date() },
    });
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
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
      intake,
      evaluations,
      triage,
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
    const authenticatedActorId = (
      await app.inject({
        method: "GET",
        url: "/auth/session",
        headers: { cookie: `aether_session=${session}` },
      })
    ).json().actorId as string;
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
      payload: {
        name: "Aether Test",
        organizationType: "institutional",
        timezone: "UTC",
        locale: "es-CL",
        policy: { dataResidencyRegion: "cl", retentionDays: 365 },
      },
    });
    expect(organizationResponse.statusCode).toBe(201);
    const organization = organizationResponse.json() as { id: string };
    const replayedOrganization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers,
      payload: {
        name: "Aether Test",
        organizationType: "institutional",
        timezone: "UTC",
        locale: "es-CL",
        policy: { dataResidencyRegion: "cl", retentionDays: 365 },
      },
    });
    expect(replayedOrganization.statusCode).toBe(201);
    expect(replayedOrganization.headers["idempotent-replayed"]).toBe("true");
    expect(replayedOrganization.json()).toMatchObject({ id: organization.id });
    const suspendedInvitation = await tenants.invite({
      actorId: authenticatedActorId,
      organizationId: organization.id,
      email: "suspended-api@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: suspendedInvitation.deliveryToken,
      actorId: "suspended-api",
      actorEmail: "suspended-api@example.test",
    });
    await tenants.changeMembershipStatus({
      actorId: authenticatedActorId,
      organizationId: organization.id,
      targetActorId: "suspended-api",
      status: "suspended",
      correlationId: crypto.randomUUID(),
    });
    const suspendedToken = "suspended-session-token";
    const now = new Date();
    await authStore.createSession({
      id: crypto.randomUUID(),
      tokenHash: hashOpaqueToken(suspendedToken),
      actorId: "suspended-api",
      actorEmail: "suspended-api@example.test",
      issuer: config.oidcIssuerUrl,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      revokedAt: null,
    });
    const suspendedAccess = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.id}/capabilities`,
      headers: { cookie: `aether_session=${suspendedToken}` },
    });
    expect(suspendedAccess.statusCode).toBe(200);
    expect(suspendedAccess.json()).toMatchObject({
      canReadOrganization: false,
      canReadWorkspace: false,
      canManageOrganization: false,
    });
    const suspendedWorkspaceList = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organization.id}/workspaces`,
      headers: { cookie: `aether_session=${suspendedToken}` },
    });
    expect(suspendedWorkspaceList.statusCode).toBe(403);
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
    const staleReplaySession = "stale-outbox-administrator-session";
    const staleReplayCreatedAt = new Date(
      Date.now() - (config.recentAuthMaxAgeSeconds + 1) * 1_000,
    );
    await authStore.createSession({
      id: crypto.randomUUID(),
      tokenHash: hashOpaqueToken(staleReplaySession),
      actorId: authenticatedActorId,
      actorEmail: "actor@example.test",
      issuer: config.oidcIssuerUrl,
      createdAt: staleReplayCreatedAt,
      lastSeenAt: staleReplayCreatedAt,
      expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
      revokedAt: null,
    });
    const staleReplayResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/outbox/dead-letters/${deadLetterId}/replay`,
      headers: {
        ...headers,
        cookie: `aether_session=${staleReplaySession}; aether_csrf=${csrf}`,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {
        organizationId: organization.id,
        reason: "La sesión requiere autenticación reciente.",
      },
    });
    expect(staleReplayResponse.statusCode).toBe(403);
    expect(staleReplayResponse.json()).toMatchObject({
      code: "RECENT_AUTH_REQUIRED",
    });
    expect(deadLetters.has(deadLetterId)).toBe(true);
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
    const foreignWorkspaceId = crypto.randomUUID();
    const foreignRequests = await Promise.all([
      app.inject({
        method: "GET",
        url: `/v1/organizations/${foreignOrganizationId}/workspaces`,
        headers: { cookie: headers.cookie },
      }),
      app.inject({
        method: "GET",
        url: `/v1/initiatives?organizationId=${foreignOrganizationId}&workspaceId=${foreignWorkspaceId}`,
        headers: { cookie: headers.cookie },
      }),
      app.inject({
        method: "GET",
        url: `/v1/audit-events?organizationId=${foreignOrganizationId}&resourceType=initiative&resourceId=${crypto.randomUUID()}`,
        headers: { cookie: headers.cookie },
      }),
    ]);
    expect(foreignRequests.map((response) => response.statusCode)).toEqual([
      403, 404, 403,
    ]);
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
    const replayedWorkspace = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers,
      payload: {
        organizationId: organization.id,
        name: "Estrategia",
        mode: "institutional",
      },
    });
    expect(replayedWorkspace.statusCode).toBe(201);
    expect(replayedWorkspace.headers["idempotent-replayed"]).toBe("true");
    expect(replayedWorkspace.json()).toMatchObject({ id: workspace.id });
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
        requestedPriority: "high",
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
        requestedPriority: "high",
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
        requestedPriority: "high",
      },
    });
    expect(reusedKey.statusCode).toBe(409);
    expect(reusedKey.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const priorityResponse = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/operational-priority`,
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      payload: {
        organizationId: organization.id,
        expectedVersion: created.version,
        operationalPriority: "high",
      },
    });
    expect(priorityResponse.statusCode).toBe(200);
    const prioritized = priorityResponse.json() as {
      requestedPriority: string;
      operationalPriority: string | null;
      version: number;
    };
    expect(prioritized).toMatchObject({
      requestedPriority: "high",
      operationalPriority: "high",
    });

    const concurrentEditPayload = {
      expectedVersion: prioritized.version,
      title: "Reducir tiempos de espera en atención",
      problemStatement: "La atención tarda demasiado.",
      expectedOutcome: "Reducir la mediana de espera en el piloto.",
      classification: "internal",
    };
    const concurrentEdits = await Promise.all(
      [crypto.randomUUID(), crypto.randomUUID()].map((idempotencyKey) =>
        app.inject({
          method: "PATCH",
          url: `/v1/initiatives/${created.id}?organizationId=${organization.id}`,
          headers: { ...headers, "idempotency-key": idempotencyKey },
          payload: concurrentEditPayload,
        }),
      ),
    );
    expect(
      concurrentEdits.map((response) => response.statusCode).sort(),
    ).toEqual([200, 409]);
    expect(
      concurrentEdits.find((response) => response.statusCode === 409)?.json(),
    ).toMatchObject({ code: "CONFLICT" });
    const edited = concurrentEdits
      .find((response) => response.statusCode === 200)!
      .json() as { version: number };

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

    const unassignedBefore = await app.inject({
      method: "GET",
      url: `/v1/intake-exceptions?organizationId=${organization.id}`,
      headers: { cookie: headers.cookie },
    });
    expect(unassignedBefore.statusCode).toBe(200);
    expect(unassignedBefore.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          initiativeId: created.id,
          updatedAt: expect.any(String),
        }),
      ]),
    );
    expect(unassignedBefore.json()[0]).not.toHaveProperty("presentedAt");
    const intakeAssignmentResponse = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/intake-assignments`,
      headers: {
        ...headers,
        "idempotency-key": "assign-intake-responsibility",
      },
      payload: {
        organizationId: organization.id,
        expectedVersion: presented.version,
        responsibleActorId: authenticatedActorId,
        nextReviewOn: "2026-09-24",
      },
    });
    expect(intakeAssignmentResponse.statusCode).toBe(201);
    expect(intakeAssignmentResponse.json()).toMatchObject({
      initiativeId: created.id,
      responsibleActorId: authenticatedActorId,
      nextReviewOn: "2026-09-24",
    });
    const replayedIntakeAssignment = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/intake-assignments`,
      headers: {
        ...headers,
        "idempotency-key": "assign-intake-responsibility",
      },
      payload: {
        organizationId: organization.id,
        expectedVersion: presented.version,
        responsibleActorId: authenticatedActorId,
        nextReviewOn: "2026-09-24",
      },
    });
    expect(replayedIntakeAssignment.statusCode).toBe(201);
    expect(replayedIntakeAssignment.headers["idempotent-replayed"]).toBe(
      "true",
    );
    const unassignedAfter = await app.inject({
      method: "GET",
      url: `/v1/intake-exceptions?organizationId=${organization.id}`,
      headers: { cookie: headers.cookie },
    });
    expect(unassignedAfter.statusCode).toBe(200);
    expect(unassignedAfter.json()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ initiativeId: created.id }),
      ]),
    );

    const standardResponse = await app.inject({
      method: "POST",
      url: "/v1/evaluation-standards",
      headers: {
        ...headers,
        "idempotency-key": "publish-evaluation-standard-key",
      },
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
    const replayedStandardResponse = await app.inject({
      method: "POST",
      url: "/v1/evaluation-standards",
      headers: {
        ...headers,
        "idempotency-key": "publish-evaluation-standard-key",
      },
      payload: {
        organizationId: organization.id,
        name: "Estándar inicial",
        version: 1,
        criteria: [
          {
            id: standard.criteria[0]!.id,
            code: "IMPACT",
            name: "Impacto",
            description: "La iniciativa demuestra un impacto institucional.",
            weight: 1,
          },
        ],
      },
    });
    expect(replayedStandardResponse.statusCode).toBe(201);
    expect(replayedStandardResponse.headers["idempotent-replayed"]).toBe(
      "true",
    );
    expect(replayedStandardResponse.json()).toEqual(standardResponse.json());
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

    const triageCriterionId = crypto.randomUUID();
    const triageStandardResponse = await app.inject({
      method: "POST",
      url: "/v1/triage-standards",
      headers: { ...headers, "idempotency-key": "publish-triage-standard" },
      payload: {
        organizationId: organization.id,
        name: "Triage inicial",
        version: 1,
        criteria: [
          {
            id: triageCriterionId,
            code: "SCOPE",
            name: "Alcance",
            description: "La iniciativa tiene alcance verificable.",
            required: true,
          },
        ],
      },
    });
    expect(triageStandardResponse.statusCode).toBe(201);
    const triageStandard = triageStandardResponse.json() as { id: string };
    const triageActivation = await app.inject({
      method: "POST",
      url: `/v1/triage-standards/${triageStandard.id}/activate`,
      headers: { ...headers, "idempotency-key": "activate-triage-standard" },
      payload: { organizationId: organization.id },
    });
    expect(triageActivation.statusCode).toBe(204);
    const triageResponse = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/triage?organizationId=${organization.id}`,
      headers: { ...headers, "idempotency-key": "triage-initiative" },
      payload: {
        expectedVersion: presented.version,
        standardId: triageStandard.id,
        results: [
          {
            criterionId: triageCriterionId,
            assessment: "pass",
            justification: ["El alcance está delimitado."],
          },
        ],
      },
    });
    expect(triageResponse.statusCode).toBe(201);
    const triageResult = triageResponse.json() as {
      id: string;
      initiativeVersion: number;
      standardVersion: number;
    };
    expect(triageResult).toMatchObject({
      initiativeVersion: presented.version,
      standardVersion: 1,
    });
    const triageReplay = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/triage?organizationId=${organization.id}`,
      headers: { ...headers, "idempotency-key": "triage-initiative" },
      payload: {
        expectedVersion: presented.version,
        standardId: triageStandard.id,
        results: [
          {
            criterionId: triageCriterionId,
            assessment: "pass",
            justification: ["El alcance está delimitado."],
          },
        ],
      },
    });
    expect(triageReplay.statusCode).toBe(201);
    expect(triageReplay.headers["idempotent-replayed"]).toBe("true");
    const triageGet = await app.inject({
      method: "GET",
      url: `/v1/triage-results/${triageResult.id}?organizationId=${organization.id}`,
      headers: { cookie: headers.cookie },
    });
    expect(triageGet.statusCode).toBe(200);
    expect(triageGet.json()).toMatchObject({ id: triageResult.id });

    const reviewerInvitation = await tenants.invite({
      actorId: authenticatedActorId,
      organizationId: organization.id,
      email: "reviewer@example.test",
      organizationRole: "admin",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: reviewerInvitation.deliveryToken,
      actorId: "reviewer",
      actorEmail: "reviewer@example.test",
    });
    await createAuthenticatedSession(authStore, {
      token: "independent-reviewer-session",
      actorId: "reviewer",
      actorEmail: "reviewer@example.test",
    });
    const reviewerCsrf = "independent-reviewer-csrf";
    const reviewerHeaders = {
      origin: config.webOrigin,
      "x-csrf-token": reviewerCsrf,
      "idempotency-key": crypto.randomUUID(),
      cookie: `aether_session=independent-reviewer-session; aether_csrf=${reviewerCsrf}`,
    };
    const assignmentResponse = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/review-assignments`,
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      payload: {
        organizationId: organization.id,
        reviewerActorId: "reviewer",
      },
    });
    expect(assignmentResponse.statusCode).toBe(201);
    const assignment = assignmentResponse.json() as { id: string };
    expect(assignment).toMatchObject({
      initiativeId: created.id,
      assignedActorId: "reviewer",
      status: "assigned",
    });
    const abstentionResponse = await app.inject({
      method: "POST",
      url: `/v1/evaluation-review-assignments/${assignment.id}/abstentions`,
      headers: { ...reviewerHeaders, "idempotency-key": crypto.randomUUID() },
      payload: {
        organizationId: organization.id,
        reason: "Debo abstenerme de esta revisión.",
      },
    });
    expect(abstentionResponse.statusCode).toBe(200);
    expect(abstentionResponse.json()).toMatchObject({ status: "abstained" });
    const reassignmentResponse = await app.inject({
      method: "POST",
      url: `/v1/evaluation-review-assignments/${assignment.id}/reassignments`,
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      payload: {
        organizationId: organization.id,
        reviewerActorId: "reviewer",
        reason: "La revisión se reasigna después de resolver la abstención.",
      },
    });
    expect(reassignmentResponse.statusCode).toBe(200);
    expect(reassignmentResponse.json()).toMatchObject({
      assignedActorId: "reviewer",
      status: "assigned",
    });

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/review?organizationId=${organization.id}`,
      headers: reviewerHeaders,
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
      annulledByActorId: null,
      annulledAt: null,
      annulmentReason: null,
    });
    const conflictDecisionResponse = await app.inject({
      method: "POST",
      url: `/v1/initiatives/${created.id}/decide?organizationId=${organization.id}`,
      headers: {
        ...reviewerHeaders,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {
        expectedVersion: review.initiative.version,
        evaluationId: review.evaluation.id,
        outcome: "approved",
        rationale: "No debe poder decidir su propia evaluación.",
        evidence: ["Acta de comité."],
      },
    });
    expect(conflictDecisionResponse.statusCode).toBe(403);
    expect(conflictDecisionResponse.json()).toMatchObject({
      code: "CONFLICT_OF_INTEREST",
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
        conditions: [
          {
            description: "Verificar la adopción inicial.",
            responsibleActorId: authenticatedActorId,
            dueOn: "2026-10-01",
          },
          {
            description: "Formalizar el alcance inicial.",
            responsibleActorId: authenticatedActorId,
            dueOn: "2026-10-02",
          },
        ],
      },
    });
    expect(decisionResponse.statusCode).toBe(200);
    const decision = decisionResponse.json() as {
      decision: { id: string; conditions: { id: string; status: string }[] };
    };
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
      conditions: expect.arrayContaining([
        expect.objectContaining({ status: "pending" }),
      ]),
    });
    const fulfillmentResponse = await app.inject({
      method: "POST",
      url: `/v1/decisions/${decision.decision.id}/conditions/${decision.decision.conditions[0]!.id}/fulfillments?organizationId=${organization.id}`,
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      payload: { note: "La adopción inicial fue verificada." },
    });
    expect(fulfillmentResponse.statusCode).toBe(200);
    expect(fulfillmentResponse.json()).toMatchObject({
      decision: {
        conditions: expect.arrayContaining([
          expect.objectContaining({
            status: "fulfilled",
            resolvedByActorId: authenticatedActorId,
            resolutionNote: "La adopción inicial fue verificada.",
          }),
        ]),
      },
    });
    const staleExemptionSession = "stale-condition-exemption-session";
    const staleExemptionCreatedAt = new Date(
      Date.now() - (config.recentAuthMaxAgeSeconds + 1) * 1_000,
    );
    await authStore.createSession({
      id: crypto.randomUUID(),
      tokenHash: hashOpaqueToken(staleExemptionSession),
      actorId: authenticatedActorId,
      actorEmail: "actor@example.test",
      issuer: config.oidcIssuerUrl,
      createdAt: staleExemptionCreatedAt,
      lastSeenAt: staleExemptionCreatedAt,
      expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
      revokedAt: null,
    });
    const staleExemptionResponse = await app.inject({
      method: "POST",
      url: `/v1/decisions/${decision.decision.id}/conditions/${decision.decision.conditions[1]!.id}/exemptions?organizationId=${organization.id}`,
      headers: {
        ...headers,
        cookie: `aether_session=${staleExemptionSession}; aether_csrf=${csrf}`,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: { reason: "No debe llegar a la exención." },
    });
    expect(staleExemptionResponse.statusCode).toBe(403);
    expect(staleExemptionResponse.json()).toMatchObject({
      code: "RECENT_AUTH_REQUIRED",
    });
    const exemptionResponse = await app.inject({
      method: "POST",
      url: `/v1/decisions/${decision.decision.id}/conditions/${decision.decision.conditions[1]!.id}/exemptions?organizationId=${organization.id}`,
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      payload: { reason: "La validación quedó incorporada en el alcance." },
    });
    expect(exemptionResponse.statusCode).toBe(200);
    expect(exemptionResponse.json()).toMatchObject({
      decision: {
        conditions: [
          {
            status: "fulfilled",
          },
          {
            status: "exempted",
            resolvedByActorId: authenticatedActorId,
            resolutionNote: "La validación quedó incorporada en el alcance.",
          },
        ],
      },
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
        expect.objectContaining({
          eventType: "initiative.decision_condition_fulfilled.v1",
        }),
        expect.objectContaining({
          eventType: "initiative.decision_condition_exempted.v1",
        }),
      ]),
    );
    for (const [resourceType, resourceId, action, actorId] of [
      ["initiative", created.id, "initiative.created.v1", authenticatedActorId],
      [
        "evaluation",
        review.evaluation.id,
        "initiative.evaluated.v1",
        "reviewer",
      ],
      [
        "decision",
        decision.decision.id,
        "initiative.decided.v2",
        authenticatedActorId,
      ],
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
            actorId,
            result: "succeeded",
          }),
        ]),
      );
    }
    await app.close();
  });

  it("aprueba, revalida y revoca por HTTP un acceso temporal exacto", async () => {
    const authStore = new InMemoryAuthStore();
    const tenantStore = new InMemoryTenantStore();
    const grantStore = new InMemoryTemporaryAccessGrantStore();
    const ids = { next: () => crypto.randomUUID() };
    const clock = { now: () => new Date() };
    const accessGrants = new TemporaryAccessGrantService({
      store: grantStore,
      resources: grantStore,
      tenancy: tenantStore,
      ids,
      clock,
    });
    const tenants = new TenantService({
      store: tenantStore,
      ids,
      tokens: {
        generate: () => crypto.randomUUID().replaceAll("-", "").padEnd(43, "x"),
        hash: (value) => `grant-test:${value}`,
      },
      clock,
      accessGrants,
    });
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const app = await buildServer({
      config,
      auth,
      tenants,
      accessGrants,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    const organization = await tenants.createOrganization({
      actorId: "grant-owner",
      actorEmail: "grant-owner@example.test",
      name: "Accesos temporales",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "grant-owner",
      organizationId: organization.id,
      name: "Revisión externa",
      mode: "institutional",
    });
    grantStore.addResource({
      resourceType: "workspace",
      resourceId: workspace.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    const invitation = await tenants.invite({
      actorId: "grant-owner",
      organizationId: organization.id,
      email: "requester@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "viewer",
      expiresInDays: 1,
    });
    await tenants.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "grant-requester",
      actorEmail: "requester@example.test",
    });
    for (const identity of [
      ["owner-token", "grant-owner", "grant-owner@example.test"],
      ["requester-token", "grant-requester", "requester@example.test"],
      ["reviewer-token", "grant-reviewer", "reviewer@example.test"],
    ] as const)
      await createAuthenticatedSession(authStore, {
        token: identity[0],
        actorId: identity[1],
        actorEmail: identity[2],
      });
    const csrf = "temporary-access-csrf";
    const mutationHeaders = (token: string) => ({
      origin: config.webOrigin,
      "x-csrf-token": csrf,
      cookie: `aether_session=${token}; aether_csrf=${csrf}`,
    });
    const deniedBeforeApproval = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}?organizationId=${organization.id}`,
      headers: { cookie: "aether_session=reviewer-token" },
    });
    expect(deniedBeforeApproval.statusCode).toBe(403);
    const requested = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/temporary-access-grants`,
      headers: {
        ...mutationHeaders("requester-token"),
        "idempotency-key": "temporary-workspace-read",
      },
      payload: {
        workspaceId: workspace.id,
        resourceType: "workspace",
        resourceId: workspace.id,
        action: "read",
        granteeActorId: "grant-reviewer",
        reason: "Revisión independiente acotada",
        expiresInMinutes: 60,
      },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json()).toMatchObject({ status: "pending" });
    const approved = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/temporary-access-grants/${requested.json().id}/approve`,
      headers: mutationHeaders("owner-token"),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "active" });
    const allowed = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}?organizationId=${organization.id}`,
      headers: { cookie: "aether_session=reviewer-token" },
    });
    expect(allowed.statusCode).toBe(200);
    const revoked = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.id}/temporary-access-grants/${requested.json().id}/revoke`,
      headers: mutationHeaders("owner-token"),
      payload: { reason: "Revisión finalizada" },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ status: "revoked" });
    const deniedAfterRevocation = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspace.id}?organizationId=${organization.id}`,
      headers: { cookie: "aether_session=reviewer-token" },
    });
    expect(deniedAfterRevocation.statusCode).toBe(403);
    expect(grantStore.auditEvents.map((event) => event.eventType)).toEqual([
      "temporary_access_grant.requested.v1",
      "temporary_access_grant.approved.v1",
      "temporary_access_grant.used.v1",
      "temporary_access_grant.revoked.v1",
    ]);
    await app.close();
  });

  it("limita el JIT de soporte a diagnóstico agregado, aprobado y auditable", async () => {
    const authStore = new InMemoryAuthStore();
    const tenantStore = new InMemoryTenantStore();
    const supportStore = new InMemorySupportAccessGrantStore();
    const ids = { next: () => crypto.randomUUID() };
    const clock = { now: () => new Date() };
    const tenants = new TenantService({
      store: tenantStore,
      ids,
      tokens: {
        generate: () => crypto.randomUUID().replaceAll("-", "").padEnd(43, "x"),
        hash: (value) => `support-test:${value}`,
      },
      clock,
    });
    const supportAccess = new SupportAccessService({
      store: supportStore,
      operators: new InMemorySupportOperatorDirectory(
        new Set(["support-operator"]),
      ),
      tenancy: tenantStore,
      ids,
      clock,
    });
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const app = await buildServer({
      config,
      auth,
      tenants,
      supportAccess,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    const organization = await tenants.createOrganization({
      actorId: "support-owner",
      actorEmail: "support-owner@example.test",
      name: "Support diagnostics",
      timezone: "UTC",
      locale: "es-CL",
    });
    supportStore.addOrganization(organization.id, {
      workspaces: { active: 3, archived: 1 },
      memberships: { active: 5, suspended: 1, revoked: 2 },
      delivery: { pendingOutboxEvents: 2, deadLetters: 1 },
      policyConfigured: true,
    });
    await createAuthenticatedSession(authStore, {
      token: "support-owner-token",
      actorId: "support-owner",
      actorEmail: "support-owner@example.test",
    });
    await createAuthenticatedSession(authStore, {
      token: "support-operator-token",
      actorId: "support-operator",
      actorEmail: "support-operator@example.test",
    });
    const csrf = "support-jit-csrf";
    const mutationHeaders = (token: string) => ({
      origin: config.webOrigin,
      "x-csrf-token": csrf,
      cookie: `aether_session=${token}; aether_csrf=${csrf}`,
    });
    const diagnosticUrl = `/v1/admin/support/organizations/${organization.id}/diagnostics`;
    expect(
      (
        await app.inject({
          method: "GET",
          url: diagnosticUrl,
          headers: { cookie: "aether_session=support-operator-token" },
        })
      ).statusCode,
    ).toBe(403);
    const requested = await app.inject({
      method: "POST",
      url: "/v1/admin/support-access-grants",
      headers: {
        ...mutationHeaders("support-operator-token"),
        "idempotency-key": "support-jit-request",
      },
      payload: {
        organizationId: organization.id,
        reason: "Analizar cola detenida",
        expiresInMinutes: 30,
      },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json()).toMatchObject({ status: "pending" });
    const approved = await app.inject({
      method: "POST",
      url: `/v1/admin/support-access-grants/${requested.json().id}/approve`,
      headers: mutationHeaders("support-owner-token"),
      payload: { organizationId: organization.id },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "active" });
    const diagnostic = await app.inject({
      method: "GET",
      url: diagnosticUrl,
      headers: { cookie: "aether_session=support-operator-token" },
    });
    expect(diagnostic.statusCode).toBe(200);
    expect(diagnostic.json()).toEqual({
      organizationId: organization.id,
      generatedAt: expect.any(String),
      workspaces: { active: 3, archived: 1 },
      memberships: { active: 5, suspended: 1, revoked: 2 },
      delivery: { pendingOutboxEvents: 2, deadLetters: 1 },
      policyConfigured: true,
    });
    expect(JSON.stringify(diagnostic.json())).not.toContain("email");
    expect(JSON.stringify(diagnostic.json())).not.toContain("document");
    const revoked = await app.inject({
      method: "POST",
      url: `/v1/admin/support-access-grants/${requested.json().id}/revoke`,
      headers: mutationHeaders("support-owner-token"),
      payload: {
        organizationId: organization.id,
        reason: "Diagnóstico terminado",
      },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ status: "revoked" });
    expect(
      (
        await app.inject({
          method: "GET",
          url: diagnosticUrl,
          headers: { cookie: "aether_session=support-operator-token" },
        })
      ).statusCode,
    ).toBe(403);
    expect(supportStore.auditEvents.map((event) => event.eventType)).toEqual([
      "support_access_grant.requested.v1",
      "support_access_grant.approved.v1",
      "support_access_grant.used.v1",
      "support_access_grant.revoked.v1",
    ]);
    await app.close();
  });
});

describe("Project conversion idempotency", () => {
  it("rechaza una misma clave con un payload de conversión distinto", async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const organizationId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const initiativeId = crypto.randomUUID();
    const decisionId = crypto.randomUUID();
    const calls: unknown[] = [];
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {
        async createFromInitiative(input) {
          calls.push(input);
          return {
            id: crypto.randomUUID(),
            organizationId,
            workspaceId,
            sourceInitiativeId: initiativeId,
            sourceDecisionId: decisionId,
            name: input.name,
            sponsorActorId: input.sponsorActorId,
            leadActorId: input.leadActorId,
            participants: input.participants,
            status: "planned",
            version: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      } as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    await createAuthenticatedSession(authStore, {
      token: "project-idempotency-session",
      actorId: "owner",
      actorEmail: "owner@example.test",
    });
    const headers = {
      origin: config.webOrigin,
      "x-csrf-token": "project-idempotency-csrf",
      "idempotency-key": "project-conversion-key",
      cookie:
        "aether_session=project-idempotency-session; aether_csrf=project-idempotency-csrf",
    };
    const payload = {
      organizationId,
      initiativeId,
      decisionId,
      name: "Proyecto inicial",
      objective: "Reducir tiempos de atención.",
      boundaries: "Alcance inicial del proyecto.",
      successCriteria: "Mejorar el servicio medido.",
      nextMilestone: "Preparar el piloto.",
      sponsorActorId: "sponsor",
      leadActorId: "lead",
      participants: [
        { actorId: "sponsor", role: "sponsor" as const },
        { actorId: "lead", role: "lead" as const },
      ],
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers,
      payload,
    });
    expect(created.statusCode).toBe(201);

    const conflicting = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers,
      payload: { ...payload, name: "Proyecto alterado" },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(calls).toHaveLength(1);
  });
});

describe("Project lead replacement endpoint", () => {
  it("requires an explicit reason and routes the versioned replacement", async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const organizationId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const calls: unknown[] = [];
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {
        async replaceLead(input: Parameters<ProjectService["replaceLead"]>[0]) {
          calls.push(input);
          return {
            id: projectId,
            organizationId,
            workspaceId,
            sourceInitiativeId: crypto.randomUUID(),
            sourceDecisionId: crypto.randomUUID(),
            name: "Proyecto con relevo",
            objective: "Mantener la continuidad operativa.",
            boundaries: "Alcance del proyecto vigente.",
            successCriteria: "Continuidad del responsable.",
            nextMilestone: "Completar el relevo.",
            sponsorActorId: "sponsor",
            leadActorId: input.leadActorId,
            participants: [
              { actorId: "former-lead", role: "contributor" as const },
              { actorId: input.leadActorId, role: "lead" as const },
            ],
            status: "active" as const,
            version: input.expectedVersion + 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      } as unknown as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    await createAuthenticatedSession(authStore, {
      token: "project-replacement-session",
      actorId: "owner",
      actorEmail: "owner@example.test",
    });
    const headers = {
      origin: config.webOrigin,
      "x-csrf-token": "project-replacement-csrf",
      "idempotency-key": "project-replacement-key",
      cookie:
        "aether_session=project-replacement-session; aether_csrf=project-replacement-csrf",
    };
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/lead-replacements`,
      headers,
      payload: {
        organizationId,
        expectedVersion: 4,
        leadActorId: "successor",
        reason: "Relevo documentado del responsable.",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      leadActorId: "successor",
      version: 5,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        actorId: "owner",
        organizationId,
        projectId,
        expectedVersion: 4,
        leadActorId: "successor",
        reason: "Relevo documentado del responsable.",
      }),
    ]);
    const invalid = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/lead-replacements`,
      headers: { ...headers, "idempotency-key": "project-replacement-invalid" },
      payload: {
        organizationId,
        expectedVersion: 5,
        leadActorId: "another-successor",
        reason: " ",
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(calls).toHaveLength(1);
    await app.close();
  });
});

describe("Initiative diagnostic endpoints", () => {
  it("validates evidence, serializes dates and replays a diagnostic save", async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const organizationId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const initiativeId = crypto.randomUUID();
    const savedAt = new Date("2026-09-19T12:00:00.000Z");
    const calls: unknown[] = [];
    const diagnostic = {
      id: crypto.randomUUID(),
      organizationId,
      workspaceId,
      initiativeId,
      version: 0,
      beneficiaries: ["Personas usuarias"],
      causes: [
        {
          kind: "evidence" as const,
          text: "Demora documentada",
          source: "Registro",
        },
      ],
      constraints: [],
      previousAttempts: [],
      hypotheses: [],
      scope: "Atención interna",
      risks: [],
      resources: [],
      nextExperiment: null,
      savedByActorId: "owner",
      savedAt,
    };
    const diagnostics = {
      async get() {
        return null;
      },
      async save(input: unknown) {
        calls.push(input);
        return diagnostic;
      },
    } as unknown as DiagnosticService;
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      diagnostics,
      idempotency: new InMemoryIdempotencyStore(),
    });
    await createAuthenticatedSession(authStore, {
      token: "diagnostic-session",
      actorId: "owner",
      actorEmail: "owner@example.test",
    });
    const headers = {
      origin: config.webOrigin,
      "x-csrf-token": "diagnostic-csrf",
      "idempotency-key": "diagnostic-key",
      cookie: "aether_session=diagnostic-session; aether_csrf=diagnostic-csrf",
    };
    const payload = {
      organizationId,
      expectedVersion: null,
      beneficiaries: ["Personas usuarias"],
      causes: [
        { kind: "evidence", text: "Demora documentada", source: "Registro" },
      ],
      constraints: [],
      previousAttempts: [],
      hypotheses: [],
      scope: "Atención interna",
      risks: [],
      resources: [],
      nextExperiment: null,
    };
    const invalid = await app.inject({
      method: "PUT",
      url: `/v1/initiatives/${initiativeId}/diagnostic`,
      headers: { ...headers, "idempotency-key": "diagnostic-invalid" },
      payload: {
        ...payload,
        causes: [{ kind: "evidence", text: "Sin fuente", source: null }],
      },
    });
    expect(invalid.statusCode).toBe(400);
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/initiatives/${initiativeId}/diagnostic`,
      headers,
      payload,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      id: diagnostic.id,
      savedAt: savedAt.toISOString(),
    });
    const replayed = await app.inject({
      method: "PUT",
      url: `/v1/initiatives/${initiativeId}/diagnostic`,
      headers,
      payload,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.headers["idempotent-replayed"]).toBe("true");
    expect(calls).toEqual([
      expect.objectContaining({
        actorId: "owner",
        organizationId,
        initiativeId,
      }),
    ]);
    await app.close();
  });
});

describe("Evaluation annulment endpoint", () => {
  it("preserva la fecha en ISO y repite idempotentemente la anulación", async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const organizationId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const initiativeId = crypto.randomUUID();
    const evaluationId = crypto.randomUUID();
    const calls: Array<{
      actorId: string;
      organizationId: string;
      evaluationId: string;
      reason: string;
      correlationId: string;
    }> = [];
    const annulledAt = new Date("2026-09-19T12:00:00.000Z");
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {
        async annulEvaluation(input: (typeof calls)[number]) {
          calls.push(input);
          return {
            id: evaluationId,
            organizationId,
            workspaceId,
            initiativeId,
            initiativeVersion: 3,
            standardId: crypto.randomUUID(),
            standardVersion: 1,
            criteria: [],
            coverage: {
              totalCriteria: 0,
              applicableCriteria: 0,
              assessedCriteria: 0,
              notApplicableCriteria: 0,
              percentage: 0,
            },
            quality: null,
            evaluatedByActorId: "reviewer",
            evaluatedAt: new Date("2026-09-19T11:00:00.000Z"),
            annulledByActorId: input.actorId,
            annulledAt,
            annulmentReason: input.reason,
          };
        },
      } as unknown as EvaluationService,
      projects: {} as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    await createAuthenticatedSession(authStore, {
      token: "evaluation-annulment-session",
      actorId: "owner",
      actorEmail: "owner@example.test",
    });
    const headers = {
      origin: config.webOrigin,
      "x-csrf-token": "evaluation-annulment-csrf",
      "idempotency-key": "evaluation-annulment-key",
      cookie:
        "aether_session=evaluation-annulment-session; aether_csrf=evaluation-annulment-csrf",
    };
    const payload = {
      organizationId,
      reason: "La evidencia debe revisarse antes de decidir.",
    };
    const created = await app.inject({
      method: "POST",
      url: `/v1/evaluations/${evaluationId}/annulments`,
      headers,
      payload,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      id: evaluationId,
      annulledAt: annulledAt.toISOString(),
      annulmentReason: payload.reason,
    });
    const replayed = await app.inject({
      method: "POST",
      url: `/v1/evaluations/${evaluationId}/annulments`,
      headers,
      payload,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.headers["idempotent-replayed"]).toBe("true");
    expect(calls).toEqual([
      expect.objectContaining({
        actorId: "owner",
        organizationId,
        evaluationId,
        reason: payload.reason,
      }),
    ]);
    await app.close();
  });
});

describe("document relocation endpoint", () => {
  it("requires recent authentication and exposes only a same-workspace relocation", async () => {
    const ids = { next: () => crypto.randomUUID() };
    const clock = { now: () => new Date("2026-09-17T12:00:00.000Z") };
    const tenantStore = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenantStore,
      ids,
      tokens: { generate: () => "x".repeat(43), hash: (value) => value },
      clock,
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Documentos",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Equipo",
      mode: "team",
    });
    const otherWorkspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Otro equipo",
      mode: "team",
    });
    const documentStore = new InMemoryDocumentStore();
    const sourceId = ids.next();
    const targetId = ids.next();
    const otherWorkspaceTargetId = ids.next();
    documentStore.addResource("initiative", sourceId, {
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    documentStore.addResource("project", targetId, {
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    documentStore.addResource("initiative", otherWorkspaceTargetId, {
      organizationId: organization.id,
      workspaceId: otherWorkspace.id,
    });
    const documents = new DocumentService({
      store: documentStore,
      audit: documentStore,
      objects: new InMemoryDocumentObjectStore(),
      tenancy: tenantStore,
      ids,
      clock,
      maxBytes: 1_000,
      urlTtlSeconds: 60,
    });
    const started = await documents.beginUpload({
      actorId: "owner",
      correlationId: ids.next(),
      resourceType: "initiative",
      resourceId: sourceId,
      classification: "confidential",
      fileName: "acta.pdf",
      contentType: "application/pdf",
      contentLength: 10,
      sha256: "a".repeat(64),
    });
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const app = await buildServer({
      config,
      auth,
      tenants,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      documents,
      idempotency: new InMemoryIdempotencyStore(),
    });
    const session = "document-owner-session";
    const csrf = "document-owner-csrf";
    await createAuthenticatedSession(authStore, {
      token: session,
      actorId: "owner",
      actorEmail: "owner@example.test",
    });
    const headers = (key: string) => ({
      origin: config.webOrigin,
      "x-csrf-token": csrf,
      "idempotency-key": key,
      cookie: `aether_session=${session}; aether_csrf=${csrf}`,
    });
    const relocated = await app.inject({
      method: "POST",
      url: `/v1/documents/${started.document.id}/relocate`,
      headers: headers("document-relocation-1"),
      payload: { resourceType: "project", resourceId: targetId },
    });
    expect(relocated.statusCode).toBe(200);
    expect(relocated.json()).toEqual({
      documentId: started.document.id,
      resourceType: "project",
      resourceId: targetId,
      classification: "confidential",
    });
    const crossWorkspace = await app.inject({
      method: "POST",
      url: `/v1/documents/${started.document.id}/relocate`,
      headers: headers("document-relocation-2"),
      payload: {
        resourceType: "initiative",
        resourceId: otherWorkspaceTargetId,
      },
    });
    expect(crossWorkspace.statusCode).toBe(403);
    expect(documentStore.documents.get(started.document.id)).toMatchObject({
      resourceType: "project",
      resourceId: targetId,
    });
    await app.close();
  });
});

describe("document project authorization endpoints", () => {
  it("denies a workspace member until they participate in the project", async () => {
    const ids = { next: () => crypto.randomUUID() };
    const clock = { now: () => new Date("2026-09-17T12:00:00.000Z") };
    const tenantStore = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenantStore,
      ids,
      tokens: { generate: () => "x".repeat(43), hash: (value) => value },
      clock,
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Documentos de proyecto",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Equipo",
      mode: "team",
    });
    const invitation = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "member@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "member",
      expiresInDays: 1,
    });
    await tenants.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "member",
      actorEmail: "member@example.test",
    });
    const documentStore = new InMemoryDocumentStore();
    const objects = new InMemoryDocumentObjectStore();
    const projectAccess = new InMemoryDocumentProjectAccess();
    const projectId = ids.next();
    documentStore.addResource("project", projectId, {
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    const documents = new DocumentService({
      store: documentStore,
      audit: documentStore,
      objects,
      tenancy: tenantStore,
      projectAccess,
      ids,
      clock,
      maxBytes: 1_000,
      urlTtlSeconds: 60,
    });
    const started = await documents.beginUpload({
      actorId: "owner",
      correlationId: ids.next(),
      resourceType: "project",
      resourceId: projectId,
      classification: "internal",
      fileName: "entrega.pdf",
      contentType: "application/pdf",
      contentLength: 10,
      sha256: "a".repeat(64),
    });
    objects.putQuarantined(started.version.quarantineKey, {
      bytes: 10,
      sha256: "a".repeat(64),
      contentType: "application/pdf",
    });
    await documents.completeUpload({
      actorId: "owner",
      correlationId: ids.next(),
      documentId: started.document.id,
      versionId: started.version.id,
    });
    await new DocumentScanService({
      store: documentStore,
      audit: documentStore,
      objects,
      scanner: {
        async scan() {
          return { clean: true, signature: null };
        },
      },
      ids,
      clock,
      retentionDays: { internal: 1, confidential: 1, restricted: 1 },
    }).handle(documentStore.events[0]!);
    const pending = await documents.beginUpload({
      actorId: "owner",
      correlationId: ids.next(),
      resourceType: "project",
      resourceId: projectId,
      classification: "internal",
      fileName: "pendiente.pdf",
      contentType: "application/pdf",
      contentLength: 10,
      sha256: "c".repeat(64),
    });
    objects.putQuarantined(pending.version.quarantineKey, {
      bytes: 10,
      sha256: "c".repeat(64),
      contentType: "application/pdf",
    });
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const app = await buildServer({
      config,
      auth,
      tenants,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      documents,
      idempotency: new InMemoryIdempotencyStore(),
    });
    await createAuthenticatedSession(authStore, {
      token: "member-project-document-session",
      actorId: "member",
      actorEmail: "member@example.test",
    });
    const csrf = "member-project-document-csrf";
    const headers = (key: string) => ({
      origin: config.webOrigin,
      "x-csrf-token": csrf,
      "idempotency-key": key,
      cookie: `aether_session=member-project-document-session; aether_csrf=${csrf}`,
    });
    const payload = {
      replacedVersionId: started.version.id,
      fileName: "entrega-corregida.pdf",
      contentType: "application/pdf",
      contentLength: 10,
      sha256: "b".repeat(64),
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/documents/${started.document.id}/replacements`,
          headers: headers("project-document-denied"),
          payload,
        })
      ).statusCode,
    ).toBe(403);
    const downloadUrl = `/v1/documents/${started.document.id}/versions/${started.version.id}/download`;
    const deniedDownload = await app.inject({
      method: "GET",
      url: downloadUrl,
      headers: { cookie: "aether_session=member-project-document-session" },
    });
    expect(deniedDownload.statusCode).toBe(403);
    expect(deniedDownload.json()).not.toHaveProperty("url");
    const documentListUrl = `/v1/documents?resourceType=project&resourceId=${projectId}`;
    const deniedList = await app.inject({
      method: "GET",
      url: documentListUrl,
      headers: { cookie: "aether_session=member-project-document-session" },
    });
    expect(deniedList.statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/documents/${pending.document.id}/versions/${pending.version.id}/complete`,
          headers: headers("project-document-complete-denied"),
        })
      ).statusCode,
    ).toBe(403);
    const withdrawUrl = `/v1/documents/${started.document.id}/versions/${started.version.id}/withdraw`;
    expect(
      (
        await app.inject({
          method: "POST",
          url: withdrawUrl,
          headers: headers("project-document-withdraw-denied"),
          payload: { reason: "No debe retirarse sin participación" },
        })
      ).statusCode,
    ).toBe(403);
    projectAccess.grant(projectId, "member");
    const allowedDownload = await app.inject({
      method: "GET",
      url: downloadUrl,
      headers: { cookie: "aether_session=member-project-document-session" },
    });
    expect(allowedDownload.statusCode).toBe(200);
    expect(allowedDownload.json()).toMatchObject({
      url: expect.any(String),
      expiresAt: expect.any(String),
    });
    const allowedList = await app.inject({
      method: "GET",
      url: documentListUrl,
      headers: { cookie: "aether_session=member-project-document-session" },
    });
    expect(allowedList.statusCode).toBe(200);
    expect(allowedList.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentId: started.document.id }),
      ]),
    );
    const allowedComplete = await app.inject({
      method: "POST",
      url: `/v1/documents/${pending.document.id}/versions/${pending.version.id}/complete`,
      headers: headers("project-document-complete-allowed"),
    });
    expect(allowedComplete.statusCode).toBe(200);
    expect(allowedComplete.json()).toMatchObject({ status: "pending_scan" });
    const allowedWithdraw = await app.inject({
      method: "POST",
      url: withdrawUrl,
      headers: headers("project-document-withdraw-allowed"),
      payload: { reason: "Sustituir por versión corregida" },
    });
    expect(allowedWithdraw.statusCode).toBe(200);
    expect(allowedWithdraw.json()).toMatchObject({ status: "withdrawn" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/documents/${started.document.id}/replacements`,
          headers: headers("project-document-allowed"),
          payload,
        })
      ).statusCode,
    ).toBe(201);
    await app.close();
  });

  it("declara y consulta capacidad con contratos explícitos", async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const projectId = "00000000-0000-4000-8000-000000000002";
    const period = { startsOn: "2026-10-01", endsOn: "2026-10-07" };
    const capacity: Pick<
      CapacityService,
      "declareAvailability" | "allocate" | "balance"
    > = {
      async declareAvailability(input) {
        expect(input).toMatchObject({
          actorId: "owner",
          organizationId,
          availableActorId: "person",
          unit: "hours",
          period,
          availableEffort: 20,
        });
        return {
          id: "00000000-0000-4000-8000-000000000003",
          organizationId,
          actorId: input.availableActorId,
          unit: input.unit,
          period: input.period,
          availableEffort: input.availableEffort,
          declaredByActorId: input.actorId,
          declaredAt: new Date("2026-09-20T00:00:00.000Z"),
        };
      },
      async allocate(input) {
        expect(input).toMatchObject({
          actorId: "owner",
          organizationId,
          projectId,
          allocatedActorId: "person",
          unit: "hours",
          period,
          allocatedEffort: 15,
        });
        return {
          id: "00000000-0000-4000-8000-000000000004",
          organizationId,
          workspaceId: "00000000-0000-4000-8000-000000000005",
          projectId: input.projectId,
          actorId: input.allocatedActorId,
          unit: input.unit,
          period: input.period,
          allocatedEffort: input.allocatedEffort,
          declaredByActorId: input.actorId,
          declaredAt: new Date("2026-09-20T00:00:00.000Z"),
        };
      },
      async balance(input) {
        expect(input).toMatchObject({
          actorId: "owner",
          organizationId,
          capacityActorId: "person",
          unit: "hours",
          period,
        });
        return {
          availability: {
            id: "00000000-0000-4000-8000-000000000003",
            organizationId,
            actorId: "person",
            unit: "hours",
            period,
            availableEffort: 20,
            declaredByActorId: "owner",
            declaredAt: new Date("2026-09-20T00:00:00.000Z"),
          },
          allocatedEffort: 27,
          remainingEffort: 0,
          overloadEffort: 7,
        };
      },
    };
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: {} as ProjectService,
      capacity: capacity as CapacityService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    await createAuthenticatedSession(authStore, {
      token: "capacity-session",
      actorId: "owner",
      actorEmail: "owner@example.test",
    });
    const csrf = "capacity-csrf";
    const headers = (key: string) => ({
      origin: config.webOrigin,
      "x-csrf-token": csrf,
      "idempotency-key": key,
      cookie: `aether_session=capacity-session; aether_csrf=${csrf}`,
    });
    const availability = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/capacity-availability`,
      headers: headers("capacity-availability"),
      payload: {
        availableActorId: "person",
        unit: "hours",
        period,
        availableEffort: 20,
      },
    });
    expect(availability.statusCode).toBe(201);
    expect(availability.json()).toMatchObject({
      availableEffort: 20,
      declaredAt: "2026-09-20T00:00:00.000Z",
    });
    const allocation = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/capacity-allocations`,
      headers: headers("capacity-allocation"),
      payload: {
        organizationId,
        allocatedActorId: "person",
        unit: "hours",
        period,
        allocatedEffort: 15,
      },
    });
    expect(allocation.statusCode).toBe(201);
    const balance = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/capacity-balance?capacityActorId=person&unit=hours&periodStartsOn=2026-10-01&periodEndsOn=2026-10-07`,
      headers: { cookie: "aether_session=capacity-session" },
    });
    expect(balance.statusCode).toBe(200);
    expect(balance.json()).toMatchObject({
      allocatedEffort: 27,
      overloadEffort: 7,
      availability: { availableEffort: 20 },
    });
    await app.close();
  });

  it("reorders project tasks through session, CSRF and idempotency controls", async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({
      store: authStore,
      cipher: createAesGcmCipher(config.sessionEncryptionKey),
      oidc,
      issuer: config.oidcIssuerUrl,
      sessionTtlSeconds: config.sessionTtlSeconds,
      sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
    });
    const projectId = "00000000-0000-4000-8000-000000000010";
    const actionId = "00000000-0000-4000-8000-000000000011";
    const organizationId = "00000000-0000-4000-8000-000000000012";
    let calls = 0;
    let collaboratorAdds = 0;
    const projects: Pick<
      ProjectService,
      | "reorderNextAction"
      | "claimNextAction"
      | "listMyWork"
      | "addNextActionCollaborator"
    > = {
      async reorderNextAction(input) {
        calls++;
        expect(input).toMatchObject({
          actorId: "owner",
          projectId,
          actionId,
          organizationId,
          expectedVersion: 4,
          position: 2,
        });
        return {
          id: actionId,
          projectId,
          description: "Reordenada",
          ownerActorId: "owner",
          executorTeamId: null,
          reviewerActorId: null,
          dueOn: null,
          priority: "medium",
          estimatedEffort: null,
          effortUnit: null,
          periodStartOn: null,
          periodEndOn: null,
          workflowStatus: "to_do",
          position: 2,
          blockedReason: null,
          unblockResponsibleActorId: null,
          completedAt: null,
          version: 5,
          createdByActorId: "owner",
          createdAt: new Date("2026-09-22T00:00:00.000Z"),
        };
      },
      async claimNextAction(input) {
        expect(input).toMatchObject({
          actorId: "owner",
          projectId,
          actionId,
          organizationId,
          expectedVersion: 4,
        });
        return {
          id: actionId,
          projectId,
          description: "Tomada",
          ownerActorId: "owner",
          executorTeamId: "00000000-0000-4000-8000-000000000013",
          reviewerActorId: null,
          dueOn: null,
          priority: "medium",
          estimatedEffort: null,
          effortUnit: null,
          periodStartOn: null,
          periodEndOn: null,
          workflowStatus: "to_do",
          position: 2,
          blockedReason: null,
          unblockResponsibleActorId: null,
          completedAt: null,
          version: 5,
          createdByActorId: "owner",
          createdAt: new Date("2026-09-22T00:00:00.000Z"),
        };
      },
      async listMyWork(input) {
        expect(input).toMatchObject({ actorId: "owner", organizationId });
        return [
          {
            action: {
              id: actionId,
              projectId,
              description: "Tomada",
              ownerActorId: "owner",
              executorTeamId: null,
              reviewerActorId: null,
              dueOn: null,
              priority: "medium",
              estimatedEffort: null,
              effortUnit: null,
              periodStartOn: null,
              periodEndOn: null,
              workflowStatus: "to_do",
              position: 1,
              blockedReason: null,
              unblockResponsibleActorId: null,
              completedAt: null,
              version: 5,
              createdByActorId: "owner",
              createdAt: new Date("2026-09-22T00:00:00.000Z"),
            },
            kinds: ["owned"],
          },
        ];
      },
      async addNextActionCollaborator(input) {
        collaboratorAdds++;
        expect(input).toMatchObject({
          actorId: "owner",
          organizationId,
          projectId,
          actionId,
          collaboratorActorId: "colleague",
          expectedVersion: 5,
        });
      },
    };
    const app = await buildServer({
      config,
      auth,
      tenants: {} as TenantService,
      initiatives: {} as InitiativeService,
      evaluations: {} as EvaluationService,
      projects: projects as ProjectService,
      idempotency: new InMemoryIdempotencyStore(),
    });
    await createAuthenticatedSession(authStore, {
      token: "task-reorder-session",
      actorId: "owner",
      actorEmail: "owner@example.test",
    });
    const csrf = "task-reorder-csrf";
    const headers = {
      origin: config.webOrigin,
      "x-csrf-token": csrf,
      "idempotency-key": "task-reorder-key",
      cookie: `aether_session=task-reorder-session; aether_csrf=${csrf}`,
    };
    const request = {
      method: "POST" as const,
      url: `/v1/projects/${projectId}/next-actions/${actionId}/reorder`,
      headers,
      payload: { organizationId, expectedVersion: 4, position: 2 },
    };
    const [first, replay] = await Promise.all([
      app.inject(request),
      app.inject(request),
    ]);
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ position: 2, version: 5 });
    expect(calls).toBe(1);
    const claim = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/next-actions/${actionId}/claim`,
      headers: { ...headers, "idempotency-key": "task-claim-key" },
      payload: { organizationId, expectedVersion: 4 },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({ ownerActorId: "owner", version: 5 });
    const myWorkUrl = `/v1/organizations/${organizationId}/my-work`;
    expect(
      (await app.inject({ method: "GET", url: myWorkUrl })).statusCode,
    ).toBe(401);
    const myWork = await app.inject({
      method: "GET",
      url: myWorkUrl,
      headers: { cookie: headers.cookie },
    });
    expect(myWork.statusCode).toBe(200);
    expect(myWork.json()).toMatchObject([
      { action: { id: actionId }, kinds: ["owned"] },
    ]);
    const collaboratorRequest = {
      method: "POST" as const,
      url: `/v1/projects/${projectId}/next-actions/${actionId}/collaborators`,
      headers: { ...headers, "idempotency-key": "task-collaborator-key" },
      payload: { organizationId, actorId: "colleague", expectedVersion: 5 },
    };
    const collaboratorResponse = await app.inject(collaboratorRequest);
    expect(collaboratorResponse.statusCode).toBe(204);
    expect((await app.inject(collaboratorRequest)).statusCode).toBe(204);
    expect(collaboratorAdds).toBe(1);
    expect(
      (
        await app.inject({
          ...collaboratorRequest,
          headers: {
            ...collaboratorRequest.headers,
            "x-csrf-token": "invalid",
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          ...request,
          headers: { ...headers, "x-csrf-token": "incorrect" },
        })
      ).statusCode,
    ).toBe(403);
    await app.close();
  });
});
