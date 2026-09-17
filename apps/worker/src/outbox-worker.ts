import type {
  DurableDomainEvent,
  DurableEventHandler,
} from "@aether/application";
import { OutboxWorker } from "@aether/application";
import { DurableEventEnvelopeSchema } from "@aether/contracts";
import { PostgresOutboxStore } from "@aether/database";
import { telemetryTracer, withinSpan } from "@aether/observability";
import type { Pool } from "pg";

const deferredWorkerEventTypes = new Set([
  "project.created.v1",
  "project.created_from_initiative.v1",
  "project.status_changed.v1",
  "project.milestone_added.v1",
  "project.next_action_added.v1",
  "project.deliverable_accepted.v1",
  "project.closed.v1",
]);

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

/**
 * Política central de ejecución asíncrona. Un evento durable sólo puede llegar
 * al handler que corresponde a su catálogo y los eventos aplazados se hacen
 * visibles, en vez de quedar como un caso implícito en el runtime.
 */
export class UnsupportedWorkerEventError extends Error {}
export function createWorkerEventHandler(input: {
  documentScans: DurableEventHandler;
  onDeferred?(event: DurableDomainEvent): void;
}): DurableEventHandler {
  return {
    async handle(event): Promise<void> {
      if (event.eventType === "document.scan_requested.v1") {
        await input.documentScans.handle(event);
        return;
      }
      if (deferredWorkerEventTypes.has(event.eventType)) {
        input.onDeferred?.(event);
        return;
      }
      throw new UnsupportedWorkerEventError(
        `Unsupported worker event ${event.eventType}`,
      );
    },
  };
}
