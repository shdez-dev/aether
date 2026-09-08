import { z } from "zod";

import { NonEmptyTextSchema, UuidSchema } from "./common.js";

export const InitiativeStatusSchema = z.enum([
  "draft",
  "presented",
  "in_triage",
  "in_evaluation",
  "pending_decision",
  "approved",
  "rejected",
  "paused",
  "converted",
  "withdrawn",
]);

export const CreateInitiativeDraftRequestSchema = z.object({
  workspaceId: UuidSchema,
  title: NonEmptyTextSchema.max(255),
  problemStatement: NonEmptyTextSchema.max(10_000),
  expectedOutcome: NonEmptyTextSchema.max(10_000),
  classification: z.enum(["internal", "confidential"]),
});

export const SubmitInitiativeRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

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
});

export type CreateInitiativeDraftRequest = z.infer<
  typeof CreateInitiativeDraftRequestSchema
>;
export type SubmitInitiativeRequest = z.infer<
  typeof SubmitInitiativeRequestSchema
>;
export type InitiativeResponse = z.infer<typeof InitiativeResponseSchema>;
