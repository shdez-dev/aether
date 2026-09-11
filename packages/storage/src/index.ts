import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  DocumentValidationError,
  type DocumentObjectStore,
} from "@aether/application";

export class S3DocumentObjectStore implements DocumentObjectStore {
  private readonly client: S3Client;
  constructor(
    private readonly config: {
      endpoint: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      maxBytes: number;
    },
  ) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  async createUploadUrl(input: {
    key: string;
    contentType: string;
    checksumSha256: string;
    expiresAt: Date;
  }) {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      Metadata: { sha256: input.checksumSha256 },
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: secondsUntil(input.expiresAt),
    });
    return {
      url,
      // El presigner incluye x-amz-meta-sha256 en la query. Reenviarlo como
      // header lo duplicaría y MinIO rechaza la firma resultante.
      headers: { "content-type": input.contentType },
    };
  }
  async inspectQuarantine(input: {
    key: string;
    expectedSha256: string;
    expectedByteLength: number;
    declaredContentType: string;
  }) {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: input.key }),
    );
    if (
      head.ContentLength !== undefined &&
      head.ContentLength > this.config.maxBytes
    )
      throw new DocumentValidationError("DOCUMENT_TOO_LARGE");
    if (
      head.ContentLength !== input.expectedByteLength ||
      head.ContentLength === undefined ||
      head.Metadata?.sha256 !== input.expectedSha256
    )
      throw new DocumentValidationError("DOCUMENT_CONTENT_MISMATCH");
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: input.key }),
    );
    let bytes: Buffer;
    try {
      bytes = await readBody(object.Body, this.config.maxBytes);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "S3 object exceeds maximum size"
      )
        throw new DocumentValidationError("DOCUMENT_TOO_LARGE");
      throw error;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      byteLength: bytes.byteLength,
      sha256,
      detectedContentType: detectContentType(bytes),
    };
  }
  async promote(input: { sourceKey: string; destinationKey: string }) {
    await this.copy(input);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: input.sourceKey,
      }),
    );
  }
  async copy(input: {
    sourceKey: string;
    destinationKey: string;
  }): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: input.destinationKey,
        CopySource: `${this.config.bucket}/${encodeURIComponent(input.sourceKey).replace(/%2F/g, "/")}`,
        MetadataDirective: "COPY",
      }),
    );
  }
  async createDownloadUrl(input: { key: string; expiresAt: Date }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: input.key }),
      { expiresIn: secondsUntil(input.expiresAt) },
    );
  }
  async readQuarantine(input: { key: string }): Promise<Uint8Array> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: input.key }),
    );
    return readBody(object.Body, this.config.maxBytes);
  }
  async delete(input: { key: string }): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: input.key }),
    );
  }
}
function secondsUntil(expiresAt: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1_000));
}
async function readBody(body: unknown, maxBytes: number): Promise<Buffer> {
  if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body))
    throw new Error("S3 object has no readable body");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error("S3 object exceeds maximum size");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function detectContentType(bytes: Buffer): string {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-")
    return "application/pdf";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length > 0 &&
    !bytes.includes(0) &&
    [...bytes].every(
      (byte) => byte === 9 || byte === 10 || byte === 13 || byte >= 32,
    )
  )
    return "text/plain";
  return "application/octet-stream";
}
