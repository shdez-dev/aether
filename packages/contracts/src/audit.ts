import { z } from "zod";

import { UuidSchema } from "./common.js";

export const AuditResourceTypeSchema = z.enum([
  "initiative",
  "evaluation",
  "decision",
  "project",
]);
export const AuditHistoryQuerySchema = z.object({
  organizationId: UuidSchema,
  resourceType: AuditResourceTypeSchema,
  resourceId: UuidSchema,
});
export const AuditHistoryEventSchema = z.object({
  id: UuidSchema,
  action: z.string(),
  resourceType: AuditResourceTypeSchema,
  resourceId: UuidSchema,
  actorId: z.string(),
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  occurredAt: z.string().datetime(),
  result: z.enum(["succeeded", "failed"]),
  correlationId: UuidSchema,
  causationId: UuidSchema.nullable(),
  asyncEventId: UuidSchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
});
export type AuditHistoryEvent = z.infer<typeof AuditHistoryEventSchema>;
