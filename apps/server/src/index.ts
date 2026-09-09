import { randomUUID } from "node:crypto";

import { TenantService } from "@aether/application";
import {
  AuthService,
  createAesGcmCipher,
  createKeycloakOidcProvider,
  hashOpaqueToken,
  randomOpaqueToken,
} from "@aether/auth";
import { PostgresAuthStore, PostgresTenantStore } from "@aether/database";
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
const app = await buildServer({ config, auth, tenants });
await app.listen({ port: config.port, host: "0.0.0.0" });
