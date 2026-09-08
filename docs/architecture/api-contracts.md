# Contratos HTTP, errores y correlación

La fuente legible del contrato inicial está en `packages/contracts/openapi/aether.v1.yaml`. El servidor publica OpenAPI 3.1 y valida DTOs Zod en el borde. Los esquemas TypeScript se exportan desde `@aether/contracts`; no se duplican como tipos manuales en web y servidor.

## Errores

Todo error de API usa `application/problem+json` con los campos `type`, `title`, `status`, `code`, `detail` seguro, `instance`, `correlationId` y, para validaciones, `errors`. Nunca incluye stack traces, SQL, secretos ni nombres de recursos inaccesibles.

| Código                   | HTTP      | Uso                                                             |
| ------------------------ | --------- | --------------------------------------------------------------- |
| `VALIDATION_ERROR`       | 400       | Formato o dato de entrada inválido                              |
| `UNAUTHENTICATED`        | 401       | Sesión ausente o vencida                                        |
| `FORBIDDEN`              | 403 o 404 | Acción no permitida; 404 cuando revelar existencia sea sensible |
| `CONFLICT`               | 409       | Versión, idempotencia o transición incompatible                 |
| `PRECONDITION_FAILED`    | 412       | Guarda de negocio no satisfecha                                 |
| `DEPENDENCY_UNAVAILABLE` | 503       | Servicio externo recuperable                                    |

## Correlación

El borde acepta `X-Correlation-ID` UUID o genera uno. Lo devuelve siempre en el encabezado y en errores. Cada comando, auditoría, evento de outbox, log y traza conserva ese valor. Los eventos también incluyen `eventId`, `causationId`, versión de agregado, organización y versión de esquema. Un consumidor conserva el `eventId` o clave funcional para tolerar reentregas.
