export type DurableDomainEvent = Readonly<{
  eventId: string;
  eventType: string;
  occurredAt: Date;
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;
  organizationId: string;
  correlationId: string;
  causationId: string | null;
  schemaVersion: number;
  payload: Readonly<Record<string, unknown>>;
}>;
export type OutboxStatus =
  "pending" | "processing" | "processed" | "dead_letter";
export type OutboxMessage = DurableDomainEvent &
  Readonly<{
    status: OutboxStatus;
    attempts: number;
    availableAt: Date;
    lockedAt: Date | null;
    lockedBy: string | null;
    lastError: string | null;
  }>;
export interface OutboxStore {
  claim(input: {
    workerId: string;
    limit: number;
    now: Date;
    lockExpiredBefore: Date;
  }): Promise<readonly OutboxMessage[]>;
  markProcessed(input: {
    eventId: string;
    workerId: string;
    processedAt: Date;
  }): Promise<void>;
  scheduleRetry(input: {
    eventId: string;
    workerId: string;
    availableAt: Date;
    error: string;
  }): Promise<void>;
  deadLetter(input: {
    eventId: string;
    workerId: string;
    failedAt: Date;
    error: string;
  }): Promise<void>;
  hasConsumption(input: {
    consumer: string;
    eventId: string;
  }): Promise<boolean>;
  recordConsumption(input: {
    consumer: string;
    eventId: string;
    processedAt: Date;
  }): Promise<boolean>;
}
export interface DurableEventHandler {
  handle(event: DurableDomainEvent): Promise<void>;
}
export interface OutboxClock {
  now(): Date;
}

export class OutboxWorker {
  constructor(
    private readonly dependencies: {
      store: OutboxStore;
      handler: DurableEventHandler;
      clock: OutboxClock;
      workerId: string;
      consumer: string;
      maxAttempts: number;
      lockTimeoutSeconds: number;
    },
  ) {}
  async processOnce(
    limit = 25,
  ): Promise<{ processed: number; retried: number; deadLettered: number }> {
    const now = this.dependencies.clock.now();
    const events = await this.dependencies.store.claim({
      workerId: this.dependencies.workerId,
      limit,
      now,
      lockExpiredBefore: new Date(
        now.getTime() - this.dependencies.lockTimeoutSeconds * 1_000,
      ),
    });
    let processed = 0,
      retried = 0,
      deadLettered = 0;
    for (const event of events) {
      try {
        if (
          !(await this.dependencies.store.hasConsumption({
            consumer: this.dependencies.consumer,
            eventId: event.eventId,
          }))
        ) {
          await this.dependencies.handler.handle(event);
          await this.dependencies.store.recordConsumption({
            consumer: this.dependencies.consumer,
            eventId: event.eventId,
            processedAt: this.dependencies.clock.now(),
          });
        }
        await this.dependencies.store.markProcessed({
          eventId: event.eventId,
          workerId: this.dependencies.workerId,
          processedAt: this.dependencies.clock.now(),
        });
        processed++;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message.slice(0, 2_000)
            : "Unknown outbox processing error";
        if (event.attempts >= this.dependencies.maxAttempts) {
          await this.dependencies.store.deadLetter({
            eventId: event.eventId,
            workerId: this.dependencies.workerId,
            failedAt: this.dependencies.clock.now(),
            error: message,
          });
          deadLettered++;
        } else {
          const backoffSeconds = Math.min(
            3_600,
            2 ** Math.max(0, event.attempts - 1),
          );
          await this.dependencies.store.scheduleRetry({
            eventId: event.eventId,
            workerId: this.dependencies.workerId,
            availableAt: new Date(
              this.dependencies.clock.now().getTime() + backoffSeconds * 1_000,
            ),
            error: message,
          });
          retried++;
        }
      }
    }
    return { processed, retried, deadLettered };
  }
}
export class OutboxProcessingError extends Error {}
