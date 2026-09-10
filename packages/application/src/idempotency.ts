/**
 * Puerto para recordar el resultado de una mutación HTTP. La llave se limita
 * al actor y a la operación para que nunca pueda reproducir una respuesta en
 * otro contexto institucional.
 */
export type IdempotencyResponse = Readonly<{
  statusCode: number;
  body: unknown;
}>;

export type IdempotencyReservation =
  | Readonly<{ kind: "claimed" }>
  | Readonly<{ kind: "completed"; response: IdempotencyResponse }>
  | Readonly<{ kind: "in_progress" }>
  | Readonly<{ kind: "key_reused" }>;

export interface IdempotencyStore {
  reserve(input: {
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyReservation>;
  complete(input: {
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
    response: IdempotencyResponse;
  }): Promise<void>;
  abandon(input: {
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
  }): Promise<void>;
}
