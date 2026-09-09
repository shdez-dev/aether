import { randomUUID } from "node:crypto";

import { InitiativeService, TenantService } from "@aether/application";
import {
  AuthService,
  createAesGcmCipher,
  createKeycloakOidcProvider,
  hashOpaqueToken,
  randomOpaqueToken,
} from "@aether/auth";
import {
  PostgresAuthStore,
  PostgresInitiativeAuditStore,
  PostgresInitiativeStore,
  PostgresTenantStore,
} from "@aether/database";
import { Pool } from "pg";

import { buildServer } from "./app.js";
import { readServerConfig } from "./config.js";

const config = readServerConfig();
const pool = new Pool({ connectionString: config.databaseUrl });
const auth = new AuthService({
  store: new PostgresAuthStore(pool),
  cipher: createAesGcmCipher(config.sessionEncryptionKey),
  oidc: createKeycloakOidcProvider({
    issuerUrl: config.oidcIssuerUrl,
    clientId: config.oidcClientId,
    clientSecret: config.oidcClientSecret,
    redirectUri: config.oidcRedirectUri,
  }),
  issuer: config.oidcIssuerUrl,
  sessionTtlSeconds: config.sessionTtlSeconds,
  sessionRenewalWindowSeconds: config.sessionRenewalWindowSeconds,
});
const tenants = new TenantService({
  store: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  tokens: { generate: randomOpaqueToken, hash: hashOpaqueToken },
  clock: { now: () => new Date() },
});
const initiatives = new InitiativeService({
  store: new PostgresInitiativeStore(pool),
  audit: new PostgresInitiativeAuditStore(pool),
  tenancy: new PostgresTenantStore(pool),
  ids: { next: randomUUID },
  clock: { now: () => new Date() },
});
const app = await buildServer({ config, auth, tenants, initiatives });
await app.listen({ port: config.port, host: "0.0.0.0" });
