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

const fakeOidc: OidcProvider = {
  async buildAuthorizationUrl({ state }) {
    return `https://identity.example/authorize?state=${state}`;
  },
  async exchangeAuthorizationCode() {
    return { subject: "actor-123" };
  },
};

describe("AuthService", () => {
  it("emite una sesión opaca, impide replay y renueva o revoca en el servidor", async () => {
    const store = new InMemoryAuthStore();
    let now = new Date("2026-09-08T12:00:00.000Z");
    const auth = new AuthService({
      store,
      cipher: createAesGcmCipher(
        "K5Ahk0FQ4+zxKxg4atlrPkS0vP0w+ZsSCx6x8v4hX3c=",
      ),
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
