# Outbox, workers y recuperación

Las mutaciones que producen efectos posteriores al commit escriben el hecho durable en `outbox_events` dentro de la misma transacción. PostgreSQL es el canal confiable: Redis no participa en la entrega de hechos de negocio.

## Contrato y consumo

Los eventos durables pertenecen a un catálogo versionado en `@aether/contracts`. El worker vuelve a validar el sobre y el payload antes de invocar un handler; un tipo o payload desconocido no se reconoce como procesado y sigue la política de reintentos hasta dead-letter. Cada consumidor registra `consumer + event_id`, con lo cual reentregas posteriores al registro se reconocen sin repetir el handler.

El único handler de producto activo mientras F5 permanece suspendido es `document.scan_requested.v1`. Antes de promover o rechazar el binario, el worker vuelve a comprobar que el tenant, agregado y versión recuperados coincidan exactamente con el sobre durable; un evento fuera de ese alcance falla sin tocar el recurso. Los eventos de proyecto se validan y se reconocen explícitamente, pero no disparan correo ni exportaciones hasta reactivar F5.

## Recuperación

Un evento que supera el máximo de intentos pasa a `dead_letter` y conserva el error seguro y el payload. Solo `owner` y `admin` de la misma organización pueden listar `GET /v1/admin/outbox/dead-letters` o solicitar `POST /v1/admin/outbox/dead-letters/{eventId}/replay`.

El replay exige motivo y autenticación reciente, usa idempotencia HTTP, restablece el evento a `pending` y registra de manera inmutable actor, correlación, fecha y motivo en `outbox_replays`. No permite cruzar organizaciones ni reactivar un evento que no esté en dead-letter.
