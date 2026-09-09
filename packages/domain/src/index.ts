/** Reglas, valores e invariantes libres de infraestructura. */
export * from "./access.js";

export type DomainEvent = Readonly<{
  type: string;
  occurredAt: Date;
}>;
