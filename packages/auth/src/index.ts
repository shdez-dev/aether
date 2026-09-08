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

export interface AuthStore {
  createSession(session: AuthSession): Promise<void>;
  findActiveSession(tokenHash: string, now: Date): Promise<AuthSession | null>;
  renewSession(
    sessionId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<AuthSession | null>;
  revokeSession(sessionId: string, now: Date): Promise<void>;
  createLoginTransaction(transaction: LoginTransaction): Promise<void>;
  consumeLoginTransaction(input: {
    handleHash: string;
    stateHash: string;
    now: Date;
  }): Promise<LoginTransaction | null>;
}

export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export interface OidcProvider {
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
  }): Promise<{ subject: string }>;
}

export type AuthServiceOptions = Readonly<{
  store: AuthStore;
  cipher: SecretCipher;
  oidc: OidcProvider;
  issuer: string;
  sessionTtlSeconds: number;
  sessionRenewalWindowSeconds: number;
  loginTransactionTtlSeconds?: number;
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
      authorizationUrl: await this.options.oidc.buildAuthorizationUrl({
        state,
        nonce,
        codeChallenge: calculateCodeChallenge(codeVerifier),
      }),
    };
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
    const sessionToken = randomOpaqueToken();
    const session: AuthSession = {
      id: randomUUID(),
      tokenHash: hashOpaqueToken(sessionToken),
      actorId: identity.subject,
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

  async logout(sessionToken: string | undefined): Promise<void> {
    const session = await this.authenticate(sessionToken);
    if (session) await this.options.store.revokeSession(session.id, this.now());
  }
}

export class AuthenticationError extends Error {
  constructor(
    public readonly code: "INVALID_LOGIN_TRANSACTION" | "CSRF_REJECTED",
  ) {
    super(code);
    this.name = "AuthenticationError";
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
}): OidcProvider {
  const discovery = oidc.discovery(
    new URL(config.issuerUrl),
    config.clientId,
    config.clientSecret,
  );
  return {
    async buildAuthorizationUrl(input) {
      const client = await discovery;
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: "openid profile email",
        state: input.state,
        nonce: input.nonce,
        code_challenge: input.codeChallenge,
        code_challenge_method: "S256",
      }).href;
    },
    async exchangeAuthorizationCode(input) {
      const client = await discovery;
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
      return { subject };
    },
  };
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000);
}
