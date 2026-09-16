import { z } from "zod";

import { NonEmptyTextSchema, UuidSchema } from "./common.js";

export const TemporaryGrantResourceTypeSchema = z.enum([
  "workspace",
  "initiative",
  "evaluation",
  "decision",
  "project",
  "document",
]);
export const TemporaryGrantActionSchema = z.enum(["read", "contribute"]);
export const RequestTemporaryAccessGrantSchema = z.object({
  workspaceId: UuidSchema,
  resourceType: TemporaryGrantResourceTypeSchema,
  resourceId: UuidSchema,
  action: TemporaryGrantActionSchema,
  granteeActorId: z.string().trim().min(1).max(255),
  reason: NonEmptyTextSchema.max(2000),
  expiresInMinutes: z.number().int().min(1).max(480),
});
export const RevokeTemporaryAccessGrantSchema = z.object({
  reason: NonEmptyTextSchema.max(2000),
});
export const ApproveTemporaryAccessGrantSchema = z.object({}).strict();
export const TemporaryAccessGrantResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  resourceType: TemporaryGrantResourceTypeSchema,
  resourceId: UuidSchema,
  action: TemporaryGrantActionSchema,
  granteeActorId: z.string(),
  requestedByActorId: z.string(),
  approvedByActorId: z.string().nullable(),
  reason: z.string(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  revokedByActorId: z.string().nullable(),
  status: z.enum(["pending", "active", "expired", "revoked"]),
});

export type RequestTemporaryAccessGrant = z.infer<
  typeof RequestTemporaryAccessGrantSchema
>;
export type RevokeTemporaryAccessGrant = z.infer<
  typeof RevokeTemporaryAccessGrantSchema
>;
export type TemporaryAccessGrantResponse = z.infer<
  typeof TemporaryAccessGrantResponseSchema
>;
