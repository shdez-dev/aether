import { describe, expect, it } from "vitest";

import type {
  DurableDomainEvent,
  OutboxMessage,
  OutboxStore,
} from "@aether/application";
import { OutboxWorker } from "@aether/application";

import {
  assertValidDurableEvent,
  createWorkerEventHandler,
  UnsupportedWorkerEventError,
} from "./outbox-worker.js";

const event: DurableDomainEvent = {
  eventId: "00000000-0000-4000-8000-000000000001",
  eventType: "project.created.v1",
  occurredAt: new Date("2026-09-12T10:00:00.000Z"),
  aggregateId: "00000000-0000-4000-8000-000000000002",
  aggregateType: "project",
  aggregateVersion: 1,
  organizationId: "00000000-0000-4000-8000-000000000003",
  correlationId: "00000000-0000-4000-8000-000000000004",
  causationId: null,
  schemaVersion: 1,
  payload: {},
};

class InMemoryOutboxStore implements OutboxStore {
  message: OutboxMessage = {
    ...event,
    status: "pending",
    attempts: 0,
    availableAt: event.occurredAt,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
  };
  readonly consumptions = new Set<string>();
  deadLettered = false;
  async claim(input: {
    workerId: string;
    limit: number;
    now: Date;
    lockExpiredBefore: Date;
  }): Promise<readonly OutboxMessage[]> {
    const claimable =
      (this.message.status === "pending" &&
        this.message.availableAt <= input.now) ||
      (this.message.status === "processing" &&
        this.message.lockedAt !== null &&
        this.message.lockedAt < input.lockExpiredBefore);
    if (!claimable) return [];
    this.message = {
      ...this.message,
      status: "processing",
      attempts: this.message.attempts + 1,
      lockedAt: input.now,
      lockedBy: input.workerId,
    };
    return [this.message];
  }
  async markProcessed(input: {
    eventId: string;
    workerId: string;
    processedAt: Date;
  }): Promise<void> {
    if (this.message.lockedBy === input.workerId)
      this.message = {
        ...this.message,
        status: "processed",
        lockedAt: null,
        lockedBy: null,
      };
  }
  async scheduleRetry(input: {
    eventId: string;
    workerId: string;
    availableAt: Date;
    error: string;
  }): Promise<void> {
    if (this.message.lockedBy === input.workerId)
      this.message = {
        ...this.message,
        status: "pending",
        availableAt: input.availableAt,
        lastError: input.error,
        lockedAt: null,
        lockedBy: null,
      };
  }
  async deadLetter(input: {
    eventId: string;
    workerId: string;
    failedAt: Date;
    error: string;
  }): Promise<void> {
    if (this.message.lockedBy === input.workerId) {
      this.message = {
        ...this.message,
        status: "dead_letter",
        lastError: input.error,
        lockedAt: null,
        lockedBy: null,
      };
      this.deadLettered = true;
    }
  }
  async hasConsumption(input: {
    consumer: string;
    eventId: string;
  }): Promise<boolean> {
    return this.consumptions.has(`${input.consumer}:${input.eventId}`);
  }
  async recordConsumption(input: {
    consumer: string;
    eventId: string;
    processedAt: Date;
  }): Promise<boolean> {
    const key = `${input.consumer}:${input.eventId}`;
    if (this.consumptions.has(key)) return false;
    this.consumptions.add(key);
    return true;
  }
}

describe("outbox worker", () => {
  it("rejects an event outside the versioned durable-event catalog", async () => {
    expect(() =>
      assertValidDurableEvent({ ...event, eventType: "unknown.event.v1" }),
    ).toThrow("Invalid durable event");
  });
  it("routes document scans and makes deferred project events explicit", async () => {
    const handled: DurableDomainEvent[] = [];
    const deferred: DurableDomainEvent[] = [];
    const handler = createWorkerEventHandler({
      documentScans: {
        async handle(event) {
          handled.push(event);
        },
      },
      onDeferred(event) {
        deferred.push(event);
      },
    });
    const scan = {
      ...event,
      eventId: "00000000-0000-4000-8000-000000000010",
      eventType: "document.scan_requested.v1",
      aggregateId: "00000000-0000-4000-8000-000000000011",
      aggregateType: "document_version",
      payload: {
        documentId: "00000000-0000-4000-8000-000000000012",
        versionId: "00000000-0000-4000-8000-000000000011",
      },
    } satisfies DurableDomainEvent;
    await handler.handle(scan);
    await handler.handle(event);
    await expect(
      handler.handle({ ...event, eventType: "unknown.event.v1" }),
    ).rejects.toBeInstanceOf(UnsupportedWorkerEventError);
    expect(handled).toEqual([scan]);
    expect(deferred).toEqual([event]);
  });
  it("reintenta después de una caída del handler y procesa al recuperarse", async () => {
    const store = new InMemoryOutboxStore();
    let now = event.occurredAt;
    let calls = 0;
    const worker = new OutboxWorker({
      store,
      handler: {
        async handle() {
          calls++;
          if (calls === 1) throw new Error("dependency down");
        },
      },
      clock: { now: () => now },
      workerId: "worker-a",
      consumer: "test",
      maxAttempts: 3,
      lockTimeoutSeconds: 60,
    });
    await expect(worker.processOnce()).resolves.toEqual({
      processed: 0,
      retried: 1,
      deadLettered: 0,
    });
    expect(store.message.availableAt).toEqual(new Date(now.getTime() + 1_000));
    now = store.message.availableAt;
    await expect(worker.processOnce()).resolves.toEqual({
      processed: 1,
      retried: 0,
      deadLettered: 0,
    });
    expect(store.message.status).toBe("processed");
  });
  it("mueve a dead-letter cuando se agotan los reintentos", async () => {
    const store = new InMemoryOutboxStore();
    let now = event.occurredAt;
    const worker = new OutboxWorker({
      store,
      handler: {
        async handle() {
          throw new Error("permanent failure");
        },
      },
      clock: { now: () => now },
      workerId: "worker-a",
      consumer: "test",
      maxAttempts: 2,
      lockTimeoutSeconds: 60,
    });
    await worker.processOnce();
    now = store.message.availableAt;
    await worker.processOnce();
    expect(store.message.status).toBe("dead_letter");
    expect(store.deadLettered).toBe(true);
  });
  it("tolera una entrega duplicada cuando el consumidor ya registró el eventId", async () => {
    const store = new InMemoryOutboxStore();
    await store.recordConsumption({
      consumer: "test",
      eventId: event.eventId,
      processedAt: event.occurredAt,
    });
    let calls = 0;
    const worker = new OutboxWorker({
      store,
      handler: {
        async handle() {
          calls++;
        },
      },
      clock: { now: () => event.occurredAt },
      workerId: "worker-a",
      consumer: "test",
      maxAttempts: 3,
      lockTimeoutSeconds: 60,
    });
    await worker.processOnce();
    expect(calls).toBe(0);
    expect(store.message.status).toBe("processed");
  });
});
