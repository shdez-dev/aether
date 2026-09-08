/** Contratos de logs, métricas y trazas con datos redactados. */
export type TelemetryAttributes = Readonly<
  Record<string, string | number | boolean>
>;
