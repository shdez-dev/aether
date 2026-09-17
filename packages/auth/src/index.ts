import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import * as oidc from "openid-client";

/** Contexto mínimo que el resto de la aplicación usa para autorizar. */
export type AccessContext = Readonly<{
  actorId: string;
  organizationId: string;
}>;

export type AuthSession = Readonly<{
  id: string;
  tokenHash: string;
  actorId: string;
  actorEmail: string | null;
  issuer: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}>;

export type LoginTransaction = Readonly<{
  id: string;
  handleHash: string;
  stateHash: string;
  codeVerifierCiphertext: string;
  nonceCiphertext: string;
  expiresAt: Date;
}>;

export type AuthSessionAuditEvent = Readonly<{
  id: string;
  action:
    | "auth.session_logged_out.v1"
    | "auth.session_revoked.v1"
    | "auth.sessions_revoked_others.v1"
    | "auth.session_rotated.v1";
  actorId: string;
  targetSessionId: string | null;
  correlationId: string;
  occurredAt: Date;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface AuthStore {
  resolveIdentity(input: {
    id: string;
    issuer: string;
    subject: string;
    email: string | null;
    authenticatedAt: Date;
  }): Promise<{ actorId: string }>;
  createSession(session: AuthSession): Promise<void>;
  findActiveSession(tokenHash: string, now: Date): Promise<AuthSession | null>;
  renewSession(
    sessionId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<AuthSession | null>;
  listActiveSessions(input: {
    actorId: string;
    now: Date;
  }): Promise<readonly AuthSession[]>;
  revokeOwnedSession(input: {
    actorId: string;
    sessionId: string;
    now: Date;
  }): Promise<boolean>;
  revokeOtherSessions(input: {
    actorId: string;
    exceptSessionId: string;
    now: Date;
  }): Promise<number>;
  rotateSession(input: {
    actorId: string;
    sessionId: string;
    replacement: AuthSession;
    now: Date;
  }): Promise<boolean>;
  createLoginTransaction(transaction: LoginTransaction): Promise<void>;
  consumeLoginTransaction(input: {
    handleHash: string;
    stateHash: string;
    now: Date;
  }): Promise<LoginTransaction | null>;
}

export interface AuthSessionAuditStore {
  recordSessionAudit(event: AuthSessionAuditEvent): Promise<void>;
}

export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export interface OidcProvider {
  checkAvailability?(): Promise<void>;
  buildAuthorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string>;
  exchangeAuthorizationCode(input: {
    callbackUrl: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<{ subject: string; email: string | null }>;
}

export type AuthServiceOptions = Readonly<{
  store: AuthStore;
  cipher: SecretCipher;
  oidc: OidcProvider;
  issuer: string;
  sessionTtlSeconds: number;
  sessionRenewalWindowSeconds: number;
  loginTransactionTtlSeconds?: number;
  audit?: AuthSessionAuditStore;
  now?: () => Date;
}>;

export type LoginStart = Readonly<{
  transactionHandle: string;
  authorizationUrl: string;
}>;
export type LoginCompletion = Readonly<{
  sessionToken: string;
  session: AuthSession;
}>;

/** Coordina OIDC y sólo entrega al navegador identificadores opacos. */
export class AuthService {
  private readonly loginTransactionTtlSeconds: number;
  private readonly now: () => Date;

  constructor(private readonly options: AuthServiceOptions) {
    this.loginTransactionTtlSeconds = options.loginTransactionTtlSeconds ?? 600;
    this.now = options.now ?? (() => new Date());
  }

  async beginLogin(): Promise<LoginStart> {
    const now = this.now();
    const handle = randomOpaqueToken();
    const state = randomOpaqueToken();
    const nonce = randomOpaqueToken();
    const codeVerifier = randomOpaqueToken();
    const authorizationUrl = await this.options.oidc.buildAuthorizationUrl({
      state,
      nonce,
      codeChallenge: calculateCodeChallenge(codeVerifier),
    });
    await this.options.store.createLoginTransaction({
      id: randomUUID(),
      handleHash: hashOpaqueToken(handle),
      stateHash: hashOpaqueToken(state),
      codeVerifierCiphertext: this.options.cipher.encrypt(codeVerifier),
      nonceCiphertext: this.options.cipher.encrypt(nonce),
      expiresAt: addSeconds(now, this.loginTransactionTtlSeconds),
    });
    return {
      transactionHandle: handle,
      authorizationUrl,
    };
  }

  async checkIdentityProviderAvailability(): Promise<void> {
    await this.options.oidc.checkAvailability?.();
  }

  async completeLogin(input: {
    transactionHandle: string;
    state: string;
    callbackUrl: string;
  }): Promise<LoginCompletion> {
    const now = this.now();
    const transaction = await this.options.store.consumeLoginTransaction({
      handleHash: hashOpaqueToken(input.transactionHandle),
      stateHash: hashOpaqueToken(input.state),
      now,
    });
    if (!transaction)
      throw new AuthenticationError("INVALID_LOGIN_TRANSACTION");
    const identity = await this.options.oidc.exchangeAuthorizationCode({
      callbackUrl: input.callbackUrl,
      state: input.state,
      nonce: this.options.cipher.decrypt(transaction.nonceCiphertext),
      codeVerifier: this.options.cipher.decrypt(
        transaction.codeVerifierCiphertext,
      ),
    });
    const actor = await this.options.store.resolveIdentity({
      id: randomUUID(),
      issuer: this.options.issuer,
      subject: identity.subject,
      email: identity.email,
      authenticatedAt: now,
    });
    const sessionToken = randomOpaqueToken();
    const session: AuthSession = {
      id: randomUUID(),
      tokenHash: hashOpaqueToken(sessionToken),
      actorId: actor.actorId,
      actorEmail: identity.email,
      issuer: this.options.issuer,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: addSeconds(now, this.options.sessionTtlSeconds),
      revokedAt: null,
    };
    await this.options.store.createSession(session);
    return { sessionToken, session };
  }

  async authenticate(
    sessionToken: string | undefined,
  ): Promise<AuthSession | null> {
    if (!sessionToken) return null;
    const now = this.now();
    const session = await this.options.store.findActiveSession(
      hashOpaqueToken(sessionToken),
      now,
    );
    if (!session) return null;
    if (
      session.expiresAt <=
      addSeconds(now, this.options.sessionRenewalWindowSeconds)
    ) {
      return this.options.store.renewSession(
        session.id,
        addSeconds(now, this.options.sessionTtlSeconds),
        now,
      );
    }
    return session;
  }

  async listSessions(actorId: string, currentSessionId: string) {
    const sessions = await this.options.store.listActiveSessions({
      actorId,
      now: this.now(),
    });
    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      isCurrent: session.id === currentSessionId,
    }));
  }

  async revokeSession(input: {
    actorId: string;
    sessionId: string;
    correlationId: string;
  }): Promise<boolean> {
    const now = this.now();
    const revoked = await this.options.store.revokeOwnedSession({
      actorId: input.actorId,
      sessionId: input.sessionId,
      now,
    });
    if (revoked)
      await this.recordSessionAudit({
        id: randomUUID(),
        action: "auth.session_revoked.v1",
        actorId: input.actorId,
        targetSessionId: input.sessionId,
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {},
      });
    return revoked;
  }

  async revokeOtherSessions(input: {
    actorId: string;
    currentSessionId: string;
    correlationId: string;
  }): Promise<number> {
    const now = this.now();
    const revoked = await this.options.store.revokeOtherSessions({
      actorId: input.actorId,
      exceptSessionId: input.currentSessionId,
      now,
    });
    if (revoked > 0)
      await this.recordSessionAudit({
        id: randomUUID(),
        action: "auth.sessions_revoked_others.v1",
        actorId: input.actorId,
        targetSessionId: input.currentSessionId,
        correlationId: input.correlationId,
        occurredAt: now,
        payload: { revokedSessions: revoked },
      });
    return revoked;
  }

  async rotateSession(input: {
    currentSession: AuthSession;
    correlationId: string;
  }): Promise<LoginCompletion> {
    const now = this.now();
    const sessionToken = randomOpaqueToken();
    const session: AuthSession = {
      id: randomUUID(),
      tokenHash: hashOpaqueToken(sessionToken),
      actorId: input.currentSession.actorId,
      actorEmail: input.currentSession.actorEmail,
      issuer: input.currentSession.issuer,
      // createdAt representa la autenticación OIDC más reciente, no la emisión
      // del token. Así una rotación por elevación no satisface recent-auth.
      createdAt: input.currentSession.createdAt,
      lastSeenAt: now,
      expiresAt: addSeconds(now, this.options.sessionTtlSeconds),
      revokedAt: null,
    };
    const rotated = await this.options.store.rotateSession({
      actorId: input.currentSession.actorId,
      sessionId: input.currentSession.id,
      replacement: session,
      now,
    });
    if (!rotated) throw new AuthenticationError("SESSION_NOT_ACTIVE");
    await this.recordSessionAudit({
      id: randomUUID(),
      action: "auth.session_rotated.v1",
      actorId: session.actorId,
      targetSessionId: input.currentSession.id,
      correlationId: input.correlationId,
      occurredAt: now,
      payload: { reason: "privilege_elevation" },
    });
    return { sessionToken, session };
  }

  async logout(
    sessionToken: string | undefined,
    correlationId: string = randomUUID(),
  ): Promise<void> {
    const session = await this.authenticate(sessionToken);
    if (!session) return;
    const now = this.now();
    const revoked = await this.options.store.revokeOwnedSession({
      actorId: session.actorId,
      sessionId: session.id,
      now,
    });
    if (revoked)
      await this.recordSessionAudit({
        id: randomUUID(),
        action: "auth.session_logged_out.v1",
        actorId: session.actorId,
        targetSessionId: session.id,
        correlationId,
        occurredAt: now,
        payload: {},
      });
  }

  private async recordSessionAudit(
    event: AuthSessionAuditEvent,
  ): Promise<void> {
    if (this.options.audit) await this.options.audit.recordSessionAudit(event);
  }
}

export class AuthenticationError extends Error {
  constructor(
    public readonly code:
      "INVALID_LOGIN_TRANSACTION" | "CSRF_REJECTED" | "SESSION_NOT_ACTIVE",
  ) {
    super(code);
    this.name = "AuthenticationError";
  }
}

/** El proveedor no puede atender un flujo de autenticación en este momento. */
export class OidcProviderUnavailableError extends Error {
  constructor() {
    super("OIDC_PROVIDER_UNAVAILABLE");
    this.name = "OidcProviderUnavailableError";
  }
}

export function hashOpaqueToken(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
export function randomOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}
export function calculateCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function createAesGcmCipher(base64Key: string): SecretCipher {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32)
    throw new Error("SESSION_ENCRYPTION_KEY must decode to 32 bytes");
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return [
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },
    decrypt(ciphertext) {
      const [ivValue, tagValue, encryptedValue] = ciphertext.split(".");
      if (!ivValue || !tagValue || !encryptedValue)
        throw new Error("Invalid encrypted value");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivValue, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

export function createKeycloakOidcProvider(config: {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowInsecureRequests?: boolean;
}): OidcProvider {
  let discovery: ReturnType<typeof oidc.discovery> | undefined;
  const discover = async () => {
    if (!discovery) {
      const pending = oidc.discovery(
        new URL(config.issuerUrl),
        config.clientId,
        config.clientSecret,
        undefined,
        config.allowInsecureRequests
          ? { execute: [oidc.allowInsecureRequests] }
          : undefined,
      );
      discovery = pending;
      try {
        return await pending;
      } catch (error) {
        if (discovery === pending) discovery = undefined;
        throw error;
      }
    }
    return discovery;
  };
  return {
    async checkAvailability() {
      try {
        await discover();
      } catch (error) {
        throw oidcProviderError(error);
      }
    },
    async buildAuthorizationUrl(input) {
      try {
        const client = await discover();
        return oidc.buildAuthorizationUrl(client, {
          redirect_uri: config.redirectUri,
          response_type: "code",
          scope: "openid profile email",
          state: input.state,
          nonce: input.nonce,
          code_challenge: input.codeChallenge,
          code_challenge_method: "S256",
        }).href;
      } catch (error) {
        throw oidcProviderError(error);
      }
    },
    async exchangeAuthorizationCode(input) {
      try {
        const client = await discover();
        const tokens = await oidc.authorizationCodeGrant(
          client,
          new URL(input.callbackUrl),
          {
            expectedState: input.state,
            expectedNonce: input.nonce,
            pkceCodeVerifier: input.codeVerifier,
            idTokenExpected: true,
          },
        );
        const subject = tokens.claims()?.sub;
        if (typeof subject !== "string" || subject.length === 0)
          throw new Error("OIDC subject missing");
        const email = tokens.claims()?.email;
        return { subject, email: typeof email === "string" ? email : null };
      } catch (error) {
        throw oidcProviderError(error);
      }
    },
  };
}

function oidcProviderError(error: unknown): unknown {
  return isOidcConnectivityError(error)
    ? new OidcProviderUnavailableError()
    : error;
}

function isOidcConnectivityError(error: unknown): boolean {
  const networkCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
  ]);
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const details = current as { code?: unknown; cause?: unknown };
    if (typeof details.code === "string" && networkCodes.has(details.code))
      return true;
    if (current instanceof TypeError && current.message === "fetch failed")
      return true;
    current = details.cause;
  }
  return false;
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000);
}
