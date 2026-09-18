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
  InMemoryTemporaryAccessGrantStore,
  InMemorySupportAccessGrantStore,
  InMemorySupportOperatorDirectory,
  InMemoryDocumentObjectStore,
  InMemoryDocumentProjectAccess,
  InMemoryDocumentStore,
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
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
      payload: { name: "Método", memberActorIds: ["owner"] },
    });
    expect(createdTeam.statusCode).toBe(201);
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
        cookie: `aether_session=${rejectingToken}; aether_csrf=${rejectingCsrf}`,
      },
      payload: { token: rejectedInvitation.deliveryToken },
    });
    expect(rejected.statusCode).toBe(204);
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
        cookie: `aether_session=${ownerToken}; aether_csrf=${ownerCsrf}`,
      },
    });
    expect(revoked.statusCode).toBe(204);
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
    });
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
    const override = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organization.json().id}/workspaces/${workspace.json().id}/policy-override`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { dataResidencyRegion: "eu", retentionDays: null },
    });
    expect(override.statusCode).toBe(200);
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
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
    });
    expect(clearedOverride.statusCode).toBe(204);
    const archivedWorkspace = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organization.json().id}/workspaces/${workspace.json().id}/archive`,
      headers: {
        origin: config.webOrigin,
        "x-csrf-token": csrf,
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
    });
    expect(archivedWorkspace.statusCode).toBe(204);
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
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { targetActorId: "next-owner" },
    });
    expect(ownershipTransfer.statusCode).toBe(204);
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
        cookie: `aether_session=${session}; aether_csrf=${csrf}`,
      },
      payload: { status: "suspended" },
    });
    expect(suspension.statusCode).toBe(204);
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
    const evaluations = new EvaluationService({
      standards: new InMemoryEvaluationStandardStore(),
      evaluations: new InMemoryEvaluationStore(),
      initiatives: initiativeStore,
      audit: auditStore,
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
});
