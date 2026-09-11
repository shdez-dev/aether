import { describe, expect, it } from "vitest";

import { S3DocumentObjectStore } from "./index.js";

describe("S3DocumentObjectStore", () => {
  it("emite URLs firmadas con vencimiento y sin hacer público el bucket", async () => {
    const storage = new S3DocumentObjectStore({
      endpoint: "http://127.0.0.1:9000",
      bucket: "aether-test",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      maxBytes: 1_000_000,
    });
    const expiresAt = new Date(Date.now() + 120_000);
    const url = await storage.createDownloadUrl({
      key: "documents/org/document/v1",
      expiresAt,
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toContain("aether-test/documents/org/document/v1");
    expect(Number(parsed.searchParams.get("X-Amz-Expires"))).toBeGreaterThan(0);
    expect(
      Number(parsed.searchParams.get("X-Amz-Expires")),
    ).toBeLessThanOrEqual(120);
  });
});
