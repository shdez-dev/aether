import { z } from "zod";

import { NonEmptyTextSchema, UuidSchema } from "./common.js";

export const RequestSupportAccessGrantSchema = z.object({
  organizationId: UuidSchema,
  reason: NonEmptyTextSchema.max(2000),
  expiresInMinutes: z.number().int().min(1).max(60),
});

export const SupportAccessGrantContextSchema = z.object({
  organizationId: UuidSchema,
});

export const RevokeSupportAccessGrantSchema = z.object({
  organizationId: UuidSchema,
  reason: NonEmptyTextSchema.max(2000),
});

export const SupportAccessGrantResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  supportActorId: z.string(),
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

export const OrganizationSupportDiagnosticResponseSchema = z.object({
  organizationId: UuidSchema,
  generatedAt: z.string().datetime(),
  workspaces: z.object({
    active: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
  }),
  memberships: z.object({
    active: z.number().int().nonnegative(),
    suspended: z.number().int().nonnegative(),
    revoked: z.number().int().nonnegative(),
  }),
  delivery: z.object({
    pendingOutboxEvents: z.number().int().nonnegative(),
    deadLetters: z.number().int().nonnegative(),
  }),
  policyConfigured: z.boolean(),
});

export type RequestSupportAccessGrant = z.infer<
  typeof RequestSupportAccessGrantSchema
>;
export type RevokeSupportAccessGrant = z.infer<
  typeof RevokeSupportAccessGrantSchema
>;
