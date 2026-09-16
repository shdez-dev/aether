import { describe, expect, it } from "vitest";

import { readServerConfig } from "./config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://unused",
  SERVER_PUBLIC_URL: "http://127.0.0.1:4000",
  WEB_ORIGIN: "http://127.0.0.1:3000",
  OIDC_ISSUER_URL: "https://identity.example/realms/test",
  OIDC_CLIENT_ID: "test",
  OIDC_CLIENT_SECRET: "test",
  OIDC_REDIRECT_URI: "http://127.0.0.1:4000/auth/callback",
  SESSION_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_BUCKET: "aether-test",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
};

describe("server configuration", () => {
  it("acepta un portal de cuenta bajo el origen del emisor OIDC", () => {
    const accountManagementUrl = "https://identity.example/realms/test/account";
    const config = readServerConfig({
      ...baseEnvironment,
      OIDC_ACCOUNT_MANAGEMENT_URL: accountManagementUrl,
    });

    expect(config.oidcAccountManagementUrl).toBe(accountManagementUrl);
  });

  it.each([
    "https://accounts.example/realms/test/account",
    "https://user:password@identity.example/realms/test/account",
    "https://identity.example/realms/test/account?ref=aether",
    "https://identity.example/realms/test/account#security",
  ])("rechaza un portal de cuenta no confiable: %s", (accountManagementUrl) => {
    expect(() =>
      readServerConfig({
        ...baseEnvironment,
        OIDC_ACCOUNT_MANAGEMENT_URL: accountManagementUrl,
      }),
    ).toThrow(/OIDC_ACCOUNT_MANAGEMENT_URL/);
  });

  it("exige HTTPS para el portal de cuenta en producción", () => {
    expect(() =>
      readServerConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        SERVER_PUBLIC_URL: "https://aether.example",
        WEB_ORIGIN: "https://aether.example",
        OIDC_ISSUER_URL: "http://identity.example/realms/production",
        OIDC_REDIRECT_URI: "https://aether.example/auth/callback",
        OIDC_ACCOUNT_MANAGEMENT_URL:
          "http://identity.example/realms/production/account",
        METRICS_TOKEN: "x".repeat(32),
      }),
    ).toThrow("OIDC_ACCOUNT_MANAGEMENT_URL must use HTTPS in production");
  });
});
