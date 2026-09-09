import type {
  DurableDomainEvent,
  DurableEventHandler,
} from "@aether/application";
import { OutboxWorker } from "@aether/application";
import { PostgresOutboxStore } from "@aether/database";
import type { Pool } from "pg";

export function createOutboxWorker(input: {
  pool: Pool;
  workerId: string;
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
    store: new PostgresOutboxStore(input.pool),
    handler,
    clock: { now: () => new Date() },
    workerId: input.workerId,
    consumer: "aether-worker.v1",
    maxAttempts: 5,
    lockTimeoutSeconds: 300,
  });
}
