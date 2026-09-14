import { z } from "zod";

import { CorrelationIdSchema, UuidSchema } from "./common.js";

export const DurableEventTypeSchema = z.enum([
  "document.scan_requested.v1",
  "project.created.v1",
  "project.created_from_initiative.v1",
  "project.status_changed.v1",
  "project.milestone_added.v1",
  "project.next_action_added.v1",
  "project.deliverable_accepted.v1",
  "project.closed.v1",
]);
export type DurableEventType = z.infer<typeof DurableEventTypeSchema>;

export const DomainEventEnvelopeSchema = z.object({
  eventId: UuidSchema,
  eventType: z.string().regex(/^[a-z]+(?:\.[a-z_]+)+\.v\d+$/),
  occurredAt: z.string().datetime(),
  aggregateId: UuidSchema,
  aggregateType: z.string().min(1),
  aggregateVersion: z.number().int().positive(),
  organizationId: UuidSchema,
  correlationId: CorrelationIdSchema,
  causationId: UuidSchema.nullable().optional(),
  schemaVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelopeSchema>;

const DurableEventBaseSchema = DomainEventEnvelopeSchema.extend({
  eventType: DurableEventTypeSchema,
  causationId: UuidSchema.nullable(),
  schemaVersion: z.literal(1),
});
export const DurableEventEnvelopeSchema = z.discriminatedUnion("eventType", [
  DurableEventBaseSchema.extend({
    eventType: z.literal("document.scan_requested.v1"),
    aggregateType: z.literal("document_version"),
    payload: z.object({ documentId: UuidSchema, versionId: UuidSchema }),
  }),
  ...[
    "project.created.v1",
    "project.created_from_initiative.v1",
    "project.status_changed.v1",
    "project.milestone_added.v1",
    "project.next_action_added.v1",
    "project.deliverable_accepted.v1",
    "project.closed.v1",
  ].map((eventType) =>
    DurableEventBaseSchema.extend({
      eventType: z.literal(eventType),
      aggregateType: z.literal("project"),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
]);
export type DurableEventEnvelope = z.infer<typeof DurableEventEnvelopeSchema>;
