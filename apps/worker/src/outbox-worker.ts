import type {
  DurableDomainEvent,
  DurableEventHandler,
} from "@aether/application";
import { OutboxWorker } from "@aether/application";
import { DurableEventEnvelopeSchema } from "@aether/contracts";
import { PostgresOutboxStore } from "@aether/database";
import { telemetryTracer, withinSpan } from "@aether/observability";
import type { Pool } from "pg";

export function createOutboxWorker(input: {
  pool: Pool;
  workerId: string;
  store?: import("@aether/application").OutboxStore;
  handler?: DurableEventHandler;
}) {
  const handler = input.handler ?? {
    async handle(event: DurableDomainEvent): Promise<void> {
      process.stdout.write(
        `Processed outbox event ${event.eventType} (${event.eventId})\n`,
      );
    },
  };
  return new OutboxWorker({
    store: input.store ?? new PostgresOutboxStore(input.pool),
    handler: {
      async handle(event) {
        assertValidDurableEvent(event);
        return withinSpan({
          tracer: telemetryTracer("aether-worker"),
          name: "outbox.process",
          attributes: {
            "messaging.message.id": event.eventId,
            "messaging.operation.type": "process",
            "messaging.destination.name": event.eventType,
            "aether.correlation_id": event.correlationId,
            "aether.causation_id": event.causationId ?? "none",
          },
          run: () => handler.handle(event),
        });
      },
    },
    clock: { now: () => new Date() },
    workerId: input.workerId,
    consumer: "aether-worker.v1",
    maxAttempts: 5,
    lockTimeoutSeconds: 300,
  });
}

export class InvalidDurableEventError extends Error {}
export function assertValidDurableEvent(event: DurableDomainEvent): void {
  const validated = DurableEventEnvelopeSchema.safeParse({
    ...event,
    occurredAt: event.occurredAt.toISOString(),
  });
  if (!validated.success)
    throw new InvalidDurableEventError(
      `Invalid durable event ${event.eventId}`,
    );
}
