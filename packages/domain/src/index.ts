/** Reglas, valores e invariantes libres de infraestructura. */
export * from "./access.js";
export * from "./initiative.js";
export * from "./evaluation.js";

export type DomainEvent = Readonly<{
  type: string;
  occurredAt: Date;
}>;
