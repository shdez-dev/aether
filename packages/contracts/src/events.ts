import { z } from "zod";

import { CorrelationIdSchema, UuidSchema } from "./common.js";

export const DomainEventEnvelopeSchema = z.object({
  eventId: UuidSchema,
  eventType: z.string().regex(/^[a-z]+(?:\.[a-z_]+)+\.v\d+$/),
  occurredAt: z.string().datetime(),
  aggregateId: UuidSchema,
  aggregateType: z.string().min(1),
  aggregateVersion: z.number().int().positive(),
  organizationId: UuidSchema,
  correlationId: CorrelationIdSchema,
  causationId: UuidSchema.optional(),
  schemaVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelopeSchema>;
