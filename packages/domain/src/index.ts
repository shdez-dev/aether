/** Reglas, valores e invariantes libres de infraestructura. */
export type DomainEvent = Readonly<{
  type: string;
  occurredAt: Date;
}>;
