import type {
  IdempotencyReservation,
  IdempotencyResponse,
  IdempotencyStore,
} from "@aether/application";

type RecordValue = Readonly<{
  requestHash: string;
  status: "pending" | "completed";
  response: IdempotencyResponse | null;
  expiresAt: Date;
}>;

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, RecordValue>();

  async reserve(input: {
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyReservation> {
    const identifier = this.identifier(input);
    const existing = this.records.get(identifier);
    if (!existing || existing.expiresAt <= new Date()) {
      this.records.set(identifier, {
        requestHash: input.requestHash,
        status: "pending",
        response: null,
        expiresAt: input.expiresAt,
      });
      return { kind: "claimed" };
    }
    if (existing.requestHash !== input.requestHash)
      return { kind: "key_reused" };
    if (existing.status === "pending") return { kind: "in_progress" };
    return { kind: "completed", response: existing.response! };
  }

  async complete(input: {
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
    response: IdempotencyResponse;
  }): Promise<void> {
    const identifier = this.identifier(input);
    const current = this.records.get(identifier);
    if (!current || current.requestHash !== input.requestHash)
      throw new Error("Idempotency record cannot be completed");
    this.records.set(identifier, {
      ...current,
      status: "completed",
      response: input.response,
    });
  }

  async abandon(input: {
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
  }): Promise<void> {
    const identifier = this.identifier(input);
    const current = this.records.get(identifier);
    if (
      current?.requestHash === input.requestHash &&
      current.status === "pending"
    )
      this.records.delete(identifier);
  }

  private identifier(input: {
    actorId: string;
    operation: string;
    key: string;
  }) {
    return `${input.actorId}\u0000${input.operation}\u0000${input.key}`;
  }
}
