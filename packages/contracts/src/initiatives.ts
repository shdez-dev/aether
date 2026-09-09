import { z } from "zod";

import { NonEmptyTextSchema, UuidSchema } from "./common.js";

export const InitiativeStatusSchema = z.enum([
  "draft",
  "presented",
  "under_review",
  "returned",
  "approved",
  "rejected",
  "cancelled",
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
  standardId: UuidSchema,
  results: z
    .array(
      z.object({
        criterionId: UuidSchema,
        assessment: z.enum(["met", "not_met", "not_applicable"]).nullable(),
        evidence: z.array(NonEmptyTextSchema.max(2_000)).max(50),
      }),
    )
    .max(100),
});

export const DecideInitiativeRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  evaluationId: UuidSchema,
  outcome: z.enum(["approved", "rejected", "returned", "cancelled"]),
  rationale: NonEmptyTextSchema.max(10_000),
  evidence: z.array(NonEmptyTextSchema.max(2_000)).max(50),
});

export const EvaluationCriterionInputSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1).max(64),
  name: NonEmptyTextSchema.max(255),
  description: NonEmptyTextSchema.max(2_000),
  weight: z.number().positive().max(1_000),
});
export const PublishEvaluationStandardRequestSchema = z.object({
  organizationId: UuidSchema,
  name: NonEmptyTextSchema.max(255),
  version: z.number().int().positive(),
  criteria: z.array(EvaluationCriterionInputSchema).min(1).max(100),
});
export const ActivateEvaluationStandardRequestSchema = z.object({
  organizationId: UuidSchema,
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
export const EvaluationStandardResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  name: z.string(),
  version: z.number().int().positive(),
  criteria: z.array(EvaluationCriterionInputSchema),
  isActive: z.boolean(),
  publishedAt: z.string().datetime(),
  publishedByActorId: z.string(),
});
export const InitiativeEvaluationResponseSchema = z.object({
  id: UuidSchema,
  initiativeId: UuidSchema,
  initiativeVersion: z.number().int().nonnegative(),
  standardId: UuidSchema,
  standardVersion: z.number().int().positive(),
  coverage: z.object({
    totalCriteria: z.number().int(),
    assessedCriteria: z.number().int(),
    percentage: z.number().int(),
  }),
  evaluatedByActorId: z.string(),
  evaluatedAt: z.string().datetime(),
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
export type PublishEvaluationStandardRequest = z.infer<
  typeof PublishEvaluationStandardRequestSchema
>;
export type InitiativeResponse = z.infer<typeof InitiativeResponseSchema>;
export type InitiativeAuditEvent = z.infer<typeof InitiativeAuditEventSchema>;
