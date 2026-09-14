import { z } from "zod";

import { UuidSchema } from "./common.js";
import { DurableEventTypeSchema } from "./events.js";

export const OutboxDeadLetterQuerySchema = z.object({
  organizationId: UuidSchema,
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const ReplayOutboxDeadLetterRequestSchema = z.object({
  organizationId: UuidSchema,
  reason: z.string().trim().min(3).max(500),
});
export const OutboxDeadLetterResponseSchema = z.object({
  eventId: UuidSchema,
  eventType: DurableEventTypeSchema,
  organizationId: UuidSchema,
  aggregateId: UuidSchema,
  aggregateType: z.string().min(1),
  aggregateVersion: z.number().int().positive(),
  correlationId: UuidSchema,
  attempts: z.number().int().positive(),
  failedAt: z.string().datetime(),
  lastError: z.string(),
});
export type OutboxDeadLetterResponse = z.infer<
  typeof OutboxDeadLetterResponseSchema
>;
