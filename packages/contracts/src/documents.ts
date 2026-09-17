import { z } from "zod";
import { UuidSchema } from "./common.js";

export const DocumentResourceTypeSchema = z.enum([
  "initiative",
  "evaluation",
  "decision",
  "project",
]);
export const DocumentClassificationSchema = z.enum([
  "internal",
  "confidential",
  "restricted",
]);
export const DocumentContentTypeSchema = z.enum([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
]);
export const BeginDocumentUploadRequestSchema = z.object({
  resourceType: DocumentResourceTypeSchema,
  resourceId: UuidSchema,
  classification: DocumentClassificationSchema,
  fileName: z.string().trim().min(1).max(255),
  contentType: DocumentContentTypeSchema,
  contentLength: z.number().int().positive(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export const DocumentListQuerySchema = z.object({
  resourceType: DocumentResourceTypeSchema,
  resourceId: UuidSchema,
});
export const RelocateDocumentRequestSchema = z.object({
  resourceType: DocumentResourceTypeSchema,
  resourceId: UuidSchema,
});
export const BeginDocumentReplacementRequestSchema = z.object({
  replacedVersionId: UuidSchema,
  fileName: z.string().trim().min(1).max(255),
  contentType: DocumentContentTypeSchema,
  contentLength: z.number().int().positive(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export const WithdrawDocumentVersionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
});
export const DocumentVersionResponseSchema = z.object({
  documentId: UuidSchema,
  versionId: UuidSchema,
  resourceType: DocumentResourceTypeSchema,
  resourceId: UuidSchema,
  classification: DocumentClassificationSchema,
  versionNumber: z.number().int().positive(),
  fileName: z.string(),
  contentType: DocumentContentTypeSchema,
  byteLength: z.number().int().positive(),
  sha256: z.string(),
  status: z.enum([
    "quarantined",
    "pending_scan",
    "published",
    "rejected",
    "withdrawn",
    "superseded",
    "purged",
  ]),
  evidenceStatus: z.enum(["pending", "valid", "withdrawn", "replaced"]),
  createdAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  retentionUntil: z.string().datetime().nullable(),
  supersedesVersionId: UuidSchema.nullable(),
});
export type BeginDocumentUploadRequest = z.infer<
  typeof BeginDocumentUploadRequestSchema
>;
