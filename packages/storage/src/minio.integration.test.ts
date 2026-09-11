import { createHash, randomUUID } from "node:crypto";

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { S3DocumentObjectStore } from "./index.js";

const withMinio = process.env.RUN_MINIO_INTEGRATION === "1" ? it : it.skip;

describe("MinIO document storage integration", () => {
  withMinio(
    "mantiene el objeto privado hasta que la inspección lo publica y emite una descarga temporal",
    async () => {
      const endpoint = "http://127.0.0.1:9000";
      const bucket = "aether-local";
      const accessKeyId = "aether-local";
      const secretAccessKey = "aether_local_only_minio_secret";
      const storage = new S3DocumentObjectStore({
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        maxBytes: 1_000_000,
      });
      const id = randomUUID();
      const quarantineKey = `integration/${id}/quarantine`;
      const objectKey = `integration/${id}/published`;
      const restoredQuarantineKey = `integration/${id}/restored-quarantine`;
      const bytes = Buffer.from("%PDF-1.7\nAether evidence\n");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const expiresAt = new Date(Date.now() + 120_000);
      const cleanup = new S3Client({
        endpoint,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      });
      try {
        const upload = await storage.createUploadUrl({
          key: quarantineKey,
          contentType: "application/pdf",
          checksumSha256: sha256,
          expiresAt,
        });
        const response = await fetch(upload.url, {
          method: "PUT",
          headers: upload.headers,
          body: bytes,
        });
        expect(response.status, await response.text()).toBeLessThan(300);
        await expect(
          storage.inspectQuarantine({
            key: quarantineKey,
            expectedSha256: sha256,
            expectedByteLength: bytes.byteLength,
            declaredContentType: "application/pdf",
          }),
        ).resolves.toEqual({
          byteLength: bytes.byteLength,
          sha256,
          detectedContentType: "application/pdf",
        });
        await storage.promote({
          sourceKey: quarantineKey,
          destinationKey: objectKey,
        });
        await storage.copy({
          sourceKey: objectKey,
          destinationKey: restoredQuarantineKey,
        });
        await expect(
          storage.inspectQuarantine({
            key: restoredQuarantineKey,
            expectedSha256: sha256,
            expectedByteLength: bytes.byteLength,
            declaredContentType: "application/pdf",
          }),
        ).resolves.toMatchObject({
          sha256,
          detectedContentType: "application/pdf",
        });
        const download = await storage.createDownloadUrl({
          key: objectKey,
          expiresAt,
        });
        const downloaded = await fetch(download);
        expect(downloaded.status).toBe(200);
        expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
        expect(
          new URL(download).searchParams.get("X-Amz-Expires"),
        ).toBeTruthy();
      } finally {
        await cleanup.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: quarantineKey }),
        );
        await cleanup.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
        );
        await cleanup.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: restoredQuarantineKey,
          }),
        );
      }
    },
  );
});
