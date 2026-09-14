import { AccessDeniedError, type TenantStore } from "./tenancy.js";

export type OutboxDeadLetter = Readonly<{
  eventId: string;
  eventType: string;
  organizationId: string;
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;
  correlationId: string;
  attempts: number;
  failedAt: Date;
  lastError: string;
}>;
export interface OutboxAdministrationStore {
  listDeadLetters(input: {
    organizationId: string;
    limit: number;
  }): Promise<readonly OutboxDeadLetter[]>;
  replayDeadLetter(input: {
    replayId: string;
    eventId: string;
    organizationId: string;
    replayedByActorId: string;
    correlationId: string;
    reason: string;
    replayedAt: Date;
  }): Promise<boolean>;
}
export interface OutboxAdministrationClock {
  now(): Date;
}

/** Administrative recovery is deliberately organization-scoped and auditable. */
export class OutboxAdministrationService {
  constructor(
    private readonly dependencies: {
      store: OutboxAdministrationStore;
      tenancy: TenantStore;
      clock: OutboxAdministrationClock;
      ids: OutboxAdministrationIdGenerator;
    },
  ) {}

  async listDeadLetters(input: {
    actorId: string;
    organizationId: string;
    limit: number;
  }): Promise<readonly OutboxDeadLetter[]> {
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    return this.dependencies.store.listDeadLetters({
      organizationId: input.organizationId,
      limit: input.limit,
    });
  }
  async replayDeadLetter(input: {
    actorId: string;
    organizationId: string;
    eventId: string;
    correlationId: string;
    reason: string;
  }): Promise<void> {
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    const replayed = await this.dependencies.store.replayDeadLetter({
      replayId: this.dependencies.ids.next(),
      eventId: input.eventId,
      organizationId: input.organizationId,
      replayedByActorId: input.actorId,
      correlationId: input.correlationId,
      reason: input.reason,
      replayedAt: this.dependencies.clock.now(),
    });
    if (!replayed) throw new OutboxDeadLetterNotFoundError();
  }
  private async assertOrganizationManager(
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (role !== "owner" && role !== "admin")
      throw new AccessDeniedError("organization:manage");
  }
}
export interface OutboxAdministrationIdGenerator {
  next(): string;
}
export class OutboxDeadLetterNotFoundError extends Error {
  constructor() {
    super("OUTBOX_DEAD_LETTER_NOT_FOUND");
  }
}
