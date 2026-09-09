import { z } from "zod";

import { NonEmptyTextSchema, UuidSchema } from "./common.js";

export const InitiativeStatusSchema = z.enum([
  "draft",
  "presented",
  "under_review",
  "approved",
  "rejected",
  "withdrawn",
]);

export const CreateInitiativeDraftRequestSchema = z.object({
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  title: NonEmptyTextSchema.max(255),
  problemStatement: NonEmptyTextSchema.max(10_000),
  expectedOutcome: NonEmptyTextSchema.max(10_000),
  classification: z.enum(["internal", "confidential"]),
});

export const SubmitInitiativeRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

export const UpdateInitiativeRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  title: NonEmptyTextSchema.max(255),
  problemStatement: NonEmptyTextSchema.max(10_000),
  expectedOutcome: NonEmptyTextSchema.max(10_000),
  classification: z.enum(["internal", "confidential"]),
});

export const StartReviewRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

export const DecideInitiativeRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  decision: z.enum(["approved", "rejected"]),
});

export const InitiativeActionSchema = z.enum([
  "edit",
  "present",
  "review",
  "decide",
]);

export const InitiativeResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  title: z.string(),
  problemStatement: z.string(),
  expectedOutcome: z.string(),
  classification: z.enum(["internal", "confidential"]),
  status: InitiativeStatusSchema,
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  allowedActions: z.array(InitiativeActionSchema),
});

export const InitiativeAuditEventSchema = z.object({
  id: UuidSchema,
  eventType: z.string(),
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  initiativeId: UuidSchema,
  actorId: z.string(),
  correlationId: UuidSchema,
  occurredAt: z.string().datetime(),
  fromStatus: InitiativeStatusSchema.nullable(),
  toStatus: InitiativeStatusSchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
});

export type CreateInitiativeDraftRequest = z.infer<
  typeof CreateInitiativeDraftRequestSchema
>;
export type SubmitInitiativeRequest = z.infer<
  typeof SubmitInitiativeRequestSchema
>;
export type UpdateInitiativeRequest = z.infer<
  typeof UpdateInitiativeRequestSchema
>;
export type StartReviewRequest = z.infer<typeof StartReviewRequestSchema>;
export type DecideInitiativeRequest = z.infer<
  typeof DecideInitiativeRequestSchema
>;
export type InitiativeResponse = z.infer<typeof InitiativeResponseSchema>;
export type InitiativeAuditEvent = z.infer<typeof InitiativeAuditEventSchema>;
