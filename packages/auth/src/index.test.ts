import { describe, expect, it } from "vitest";

import {
  AuthService,
  createAesGcmCipher,
  hashOpaqueToken,
  type AuthSession,
  type AuthStore,
  type LoginTransaction,
  type OidcProvider,
} from "./index.js";

const testSessionEncryptionKey = Buffer.alloc(32).toString("base64");
class InMemoryAuthStore implements AuthStore {
  readonly sessions = new Map<string, AuthSession>();
  readonly transactions = new Map<string, LoginTransaction>();
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
});
