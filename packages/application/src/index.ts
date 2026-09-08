/** Casos de uso, puertos y fronteras transaccionales. */

export interface RequestMetadata {
  readonly actorId: string;
  readonly organizationId: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
}

export interface Command {
  readonly metadata: RequestMetadata;
}

export interface Query {
  readonly metadata: RequestMetadata;
}

export interface CommandHandler<Input extends Command, Output> {
  execute(command: Input): Promise<Output>;
}

export interface QueryHandler<Input extends Query, Output> {
  execute(query: Input): Promise<Output>;
}

export interface UnitOfWork {
  execute<T>(work: () => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface DomainEventPublisher {
  enqueue(event: {
    readonly type: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly organizationId: string;
    readonly correlationId: string;
    readonly occurredAt: Date;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}
