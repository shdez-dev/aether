/** Reglas, valores e invariantes libres de infraestructura. */
export * from "./access.js";
export * from "./initiative.js";
export * from "./evaluation.js";
export * from "./project.js";
export * from "./document.js";
export * from "./evidence.js";
export * from "./business-hours.js";

export type DomainEvent = Readonly<{
  type: string;
  occurredAt: Date;
}>;
