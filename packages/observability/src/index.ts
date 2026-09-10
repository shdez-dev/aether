import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

/** Atributos permitidos: nunca cuerpos, cookies, tokens ni datos personales. */
export type TelemetryAttributes = Readonly<
  Record<string, string | number | boolean>
>;

export type TelemetryRuntime = Readonly<{
  tracer: Tracer;
  shutdown(): Promise<void>;
}>;
export type TelemetrySpan = Span;

let runtime: TelemetryRuntime | undefined;

/**
 * Inicializa el proveedor de trazas una vez por proceso.
 * Sin endpoint OTLP las trazas siguen siendo no-op, útil para pruebas y desarrollo
 * sin introducir un recolector obligatorio.
 */
export function initializeTelemetry(input: {
  serviceName: string;
  otlpEndpoint?: string;
}): TelemetryRuntime {
  if (runtime) return runtime;
  const spanProcessors = input.otlpEndpoint
    ? [
        new BatchSpanProcessor(
          new OTLPTraceExporter({ url: input.otlpEndpoint }),
        ),
      ]
    : [];
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": input.serviceName }),
    spanProcessors,
  });
  provider.register();
  runtime = {
    tracer: trace.getTracer(input.serviceName),
    async shutdown() {
      await provider.shutdown();
      runtime = undefined;
    },
  };
  return runtime;
}

export function telemetryTracer(name = "aether"): Tracer {
  return trace.getTracer(name);
}

export async function withinSpan<T>(input: {
  tracer?: Tracer;
  name: string;
  attributes?: TelemetryAttributes;
  run(): Promise<T>;
}): Promise<T> {
  const tracer = input.tracer ?? telemetryTracer();
  const options = input.attributes
    ? { attributes: input.attributes as Attributes }
    : {};
  return tracer.startActiveSpan(
    input.name,
    options,
    async (span) => {
      try {
        const value = await input.run();
        span.setStatus({ code: SpanStatusCode.OK });
        return value;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        if (error instanceof Error) span.recordException(error);
        throw error;
      } finally {
        span.end();
      }
    },
  ) as Promise<T>;
}

export type OperationalMetrics = Readonly<{
  recordHttpRequest(input: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void;
  recordOutboxCycle(input: {
    processed: number;
    retried: number;
    deadLettered: number;
  }): void;
  snapshot(): Readonly<{
    startedAt: string;
    http: Readonly<{
      requests: number;
      failures: number;
      durationMsTotal: number;
    }>;
    outbox: Readonly<{
      processed: number;
      retried: number;
      deadLettered: number;
    }>;
  }>;
}>;

/** Métricas de proceso agregadas; sin rutas, usuarios ni contenido sensible. */
export function createOperationalMetrics(
  meterName = "aether",
): OperationalMetrics {
  const meter = metrics.getMeter(meterName);
  const requestCounter = meter.createCounter("aether.http.requests", {
    description: "Solicitudes HTTP finalizadas",
  });
  const requestDuration = meter.createHistogram("aether.http.duration", {
    description: "Duración de solicitudes HTTP en milisegundos",
    unit: "ms",
  });
  const outboxCounter = meter.createCounter("aether.outbox.events", {
    description: "Eventos outbox por resultado",
  });
  const startedAt = new Date();
  let requests = 0;
  let failures = 0;
  let durationMsTotal = 0;
  let processed = 0;
  let retried = 0;
  let deadLettered = 0;
  return {
    recordHttpRequest(input) {
      const outcome = input.statusCode >= 500 ? "error" : "success";
      requestCounter.add(1, {
        "http.request.method": input.method,
        "http.response.status_code": input.statusCode,
        outcome,
      });
      requestDuration.record(input.durationMs, {
        "http.request.method": input.method,
        outcome,
      });
      requests++;
      durationMsTotal += input.durationMs;
      if (input.statusCode >= 500) failures++;
    },
    recordOutboxCycle(input) {
      if (input.processed > 0)
        outboxCounter.add(input.processed, { outcome: "processed" });
      if (input.retried > 0)
        outboxCounter.add(input.retried, { outcome: "retried" });
      if (input.deadLettered > 0)
        outboxCounter.add(input.deadLettered, { outcome: "dead_lettered" });
      processed += input.processed;
      retried += input.retried;
      deadLettered += input.deadLettered;
    },
    snapshot() {
      return {
        startedAt: startedAt.toISOString(),
        http: { requests, failures, durationMsTotal },
        outbox: { processed, retried, deadLettered },
      };
    },
  };
}
