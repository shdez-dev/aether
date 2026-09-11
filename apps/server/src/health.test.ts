import { describe, expect, it } from "vitest";

import {
  EvaluationService,
  InitiativeService,
  ProjectService,
  TenantService,
} from "@aether/application";
import { AuthService } from "@aether/auth";
import { InMemoryIdempotencyStore } from "@aether/testkit";

import { buildServer } from "./app.js";
import type { ServerConfig } from "./config.js";

const testSessionEncryptionKey = Buffer.alloc(32).toString("base64");
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
  maxRequestBodyBytes: 1_024,
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
};

function dependencies(serverConfig: ServerConfig = config) {
  return {
    config: serverConfig,
    auth: {} as AuthService,
    tenants: {} as TenantService,
    initiatives: {} as InitiativeService,
    evaluations: {} as EvaluationService,
    projects: {} as ProjectService,
    idempotency: new InMemoryIdempotencyStore(),
  };
}

describe("health endpoints", () => {
  it("separates liveness from dependency readiness", async () => {
    const app = await buildServer({
      ...dependencies(),
      readinessCheck: async () => undefined,
    });
    expect((await app.inject("/health")).json()).toEqual({ status: "ok" });
    expect((await app.inject("/ready")).json()).toEqual({ status: "ready" });
    await app.close();
  });

  it("does not report ready when a required dependency is unavailable", async () => {
    const app = await buildServer({
      ...dependencies(),
      readinessCheck: async () => {
        throw new Error("database unavailable");
      },
    });
    const response = await app.inject("/ready");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    await app.close();
  });

  it("exposes aggregate operational metrics only with its infrastructure token", async () => {
    const metricsToken = "m".repeat(32);
    const app = await buildServer(dependencies({ ...config, metricsToken }));
    await app.inject("/health");
    expect((await app.inject("/metrics")).statusCode).toBe(401);
    const metrics = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${metricsToken}` },
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json()).toMatchObject({
      http: expect.objectContaining({ requests: expect.any(Number) }),
      outbox: { processed: 0, retried: 0, deadLettered: 0 },
    });
    await app.close();
  });

  it("restricts browser origins and emits security headers", async () => {
    const app = await buildServer(dependencies());
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: config.webOrigin },
    });
    expect(response.headers["access-control-allow-origin"]).toBe(
      config.webOrigin,
    );
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    const rejectedOrigin = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://untrusted.example" },
    });
    expect(
      rejectedOrigin.headers["access-control-allow-origin"],
    ).toBeUndefined();
    await app.close();
  });

  it("limits abusive requests and rejects oversized bodies", async () => {
    const app = await buildServer(
      dependencies({ ...config, rateLimitMax: 2, maxRequestBodyBytes: 1_024 }),
    );
    await app.inject("/health");
    await app.inject("/health");
    const limited = await app.inject("/health");
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    await app.close();

    const bodyLimited = await buildServer(
      dependencies({ ...config, maxRequestBodyBytes: 1_024 }),
    );
    const oversized = await bodyLimited.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: {
        origin: config.webOrigin,
        "content-type": "application/json",
      },
      payload: JSON.stringify({ name: "x".repeat(2_000) }),
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await bodyLimited.close();
  });
});
