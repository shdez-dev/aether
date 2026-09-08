import { describe, expect, it } from "vitest";

import {
  AuthService,
  createAesGcmCipher,
  type AuthSession,
  type AuthStore,
  type LoginTransaction,
  type OidcProvider,
} from "@aether/auth";

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
    return { subject: "actor-123" };
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
    const app = await buildServer({ config, auth });
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
});
