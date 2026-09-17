import { describe, expect, it } from "vitest";

import {
  AuthService,
  createAesGcmCipher,
  hashOpaqueToken,
  OidcProviderUnavailableError,
  type AuthSession,
  type AuthStore,
  type LoginTransaction,
  type OidcProvider,
} from "./index.js";

const testSessionEncryptionKey = Buffer.alloc(32).toString("base64");
class InMemoryAuthStore implements AuthStore {
  readonly sessions = new Map<string, AuthSession>();
  readonly transactions = new Map<string, LoginTransaction>();
  readonly identities = new Map<
    string,
    { actorId: string; email: string | null; authenticatedAt: Date }
  >();
  async resolveIdentity(input: {
    id: string;
    issuer: string;
    subject: string;
    email: string | null;
    authenticatedAt: Date;
  }): Promise<{ actorId: string }> {
    const key = `${input.issuer}:${input.subject}`;
    const existing = this.identities.get(key);
    const identity = {
      actorId: existing?.actorId ?? input.id,
      email: input.email,
      authenticatedAt: input.authenticatedAt,
    };
    this.identities.set(key, identity);
    return { actorId: identity.actorId };
  }
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
    if (!session || session.revokedAt) return null;
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

const fakeOidc: OidcProvider = {
  async buildAuthorizationUrl({ state }) {
    return `https://identity.example/authorize?state=${state}`;
  },
  async exchangeAuthorizationCode() {
    return { subject: "actor-123", email: "actor@example.test" };
  },
};

describe("AuthService", () => {
  it("no conserva transacciones ni crea sesiones cuando OIDC no está disponible", async () => {
    const store = new InMemoryAuthStore();
    const unavailableOidc: OidcProvider = {
      async buildAuthorizationUrl() {
        throw new OidcProviderUnavailableError();
      },
      async exchangeAuthorizationCode() {
        throw new OidcProviderUnavailableError();
      },
    };
    const auth = new AuthService({
      store,
      cipher: createAesGcmCipher(testSessionEncryptionKey),
      oidc: unavailableOidc,
      issuer: "https://identity.example",
      sessionTtlSeconds: 3600,
      sessionRenewalWindowSeconds: 600,
    });
    await expect(auth.beginLogin()).rejects.toBeInstanceOf(
      OidcProviderUnavailableError,
    );
    expect(store.transactions.size).toBe(0);
    expect(store.sessions.size).toBe(0);
  });

  it("expone la indisponibilidad del proveedor para readiness sin crear estado", async () => {
    const store = new InMemoryAuthStore();
    const auth = new AuthService({
      store,
      cipher: createAesGcmCipher(testSessionEncryptionKey),
      oidc: {
        async checkAvailability() {
          throw new OidcProviderUnavailableError();
        },
        async buildAuthorizationUrl({ state }) {
          return `https://identity.example/authorize?state=${state}`;
        },
        async exchangeAuthorizationCode() {
          return { subject: "actor-123", email: "actor@example.test" };
        },
      },
      issuer: "https://identity.example",
      sessionTtlSeconds: 3600,
      sessionRenewalWindowSeconds: 600,
    });
    await expect(
      auth.checkIdentityProviderAvailability(),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
    expect(store.transactions.size).toBe(0);
    expect(store.sessions.size).toBe(0);
  });

  it("consume el intento y no crea sesión si OIDC falla durante el canje", async () => {
    const store = new InMemoryAuthStore();
    const auth = new AuthService({
      store,
      cipher: createAesGcmCipher(testSessionEncryptionKey),
      oidc: {
        async buildAuthorizationUrl({ state }) {
          return `https://identity.example/authorize?state=${state}`;
        },
        async exchangeAuthorizationCode() {
          throw new OidcProviderUnavailableError();
        },
      },
      issuer: "https://identity.example",
      sessionTtlSeconds: 3600,
      sessionRenewalWindowSeconds: 600,
    });
    const started = await auth.beginLogin();
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    await expect(
      auth.completeLogin({
        transactionHandle: started.transactionHandle,
        state,
        callbackUrl: `https://app.example/auth/callback?code=code&state=${state}`,
      }),
    ).rejects.toBeInstanceOf(OidcProviderUnavailableError);
    expect(store.transactions.size).toBe(0);
    expect(store.sessions.size).toBe(0);
  });

  it("emite una sesión opaca, impide replay y renueva o revoca en el servidor", async () => {
    const store = new InMemoryAuthStore();
    let now = new Date("2026-09-08T12:00:00.000Z");
    const auth = new AuthService({
      store,
      cipher: createAesGcmCipher(testSessionEncryptionKey),
      oidc: fakeOidc,
      issuer: "https://identity.example",
      sessionTtlSeconds: 3600,
      sessionRenewalWindowSeconds: 600,
      now: () => now,
    });
    const started = await auth.beginLogin();
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();
    const completed = await auth.completeLogin({
      transactionHandle: started.transactionHandle,
      state: state!,
      callbackUrl: `https://app.example/auth/callback?code=code&state=${state}`,
    });
    expect(completed.sessionToken).not.toContain(".");
    expect(completed.session.actorId).not.toBe("actor-123");
    expect(store.identities).toHaveLength(1);
    expect([...store.sessions.values()][0]?.tokenHash).toBe(
      hashOpaqueToken(completed.sessionToken),
    );
    await expect(
      auth.completeLogin({
        transactionHandle: started.transactionHandle,
        state: state!,
        callbackUrl: "https://app.example/auth/callback?code=replay",
      }),
    ).rejects.toMatchObject({ code: "INVALID_LOGIN_TRANSACTION" });
    now = new Date("2026-09-08T12:55:00.000Z");
    expect(
      (
        await auth.authenticate(completed.sessionToken)
      )?.expiresAt.toISOString(),
    ).toBe("2026-09-08T13:55:00.000Z");
    await auth.logout(completed.sessionToken);
    await expect(auth.authenticate(completed.sessionToken)).resolves.toBeNull();
  });

  it("rota el token al elevar privilegios sin alterar la antigüedad de autenticación", async () => {
    const store = new InMemoryAuthStore();
    const authenticatedAt = new Date("2026-09-08T12:00:00.000Z");
    let now = authenticatedAt;
    const auth = new AuthService({
      store,
      cipher: createAesGcmCipher(testSessionEncryptionKey),
      oidc: fakeOidc,
      issuer: "https://identity.example",
      sessionTtlSeconds: 3600,
      sessionRenewalWindowSeconds: 600,
      now: () => now,
    });
    const started = await auth.beginLogin();
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const completed = await auth.completeLogin({
      transactionHandle: started.transactionHandle,
      state,
      callbackUrl: `https://app.example/auth/callback?code=code&state=${state}`,
    });
    now = new Date("2026-09-08T12:20:00.000Z");
    const rotated = await auth.rotateSession({
      currentSession: completed.session,
      correlationId: "00000000-0000-4000-8000-000000000001",
    });
    expect(rotated.sessionToken).not.toBe(completed.sessionToken);
    await expect(auth.authenticate(completed.sessionToken)).resolves.toBeNull();
    await expect(
      auth.authenticate(rotated.sessionToken),
    ).resolves.toMatchObject({
      id: rotated.session.id,
      createdAt: authenticatedAt,
      lastSeenAt: now,
    });
  });
});
