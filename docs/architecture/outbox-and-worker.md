# Outbox y trabajos asíncronos

PostgreSQL es la fuente confiable para los eventos de negocio asíncronos. Una mutación que emite un evento persiste el agregado y la fila de `outbox_events` en la misma transacción. Redis se reserva para caché, presencia e invalidación; nunca confirma ni transporta una decisión de negocio.

## Eventos iniciales

La conversión de una iniciativa aprobada y el cambio de estado de un proyecto generan, respectivamente, `project.created.v1` y `project.status_changed.v1`. Cada evento incluye identificador, tipo y versión de esquema, agregado y versión del agregado, organización, correlación, causalidad, instante y carga útil. El identificador del evento es estable y es la clave de idempotencia del consumidor.

La conversión persiste proyecto, evento de outbox y auditoría de creación en una
sola transacción. Si el commit falla no queda estado parcial; si se pierde la
respuesta después del commit, el mismo comando canónico devuelve el proyecto
existente sin duplicar efectos. La política está registrada en
[ADR-0010](../adr/0010-conversion-atomica-y-recuperable.md).

## Ciclo de procesamiento

El worker reclama lotes con `FOR UPDATE SKIP LOCKED`. Una fila pasa por `pending`, `processing`, `processed` o `dead_letter`; conserva intentos, bloqueo, fecha disponible y último error. Un bloqueo vencido puede ser reclamado por otro worker tras cinco minutos.

Los fallos se reintentan con backoff exponencial de 1, 2, 4… segundos, limitado a una hora. Tras cinco intentos el worker deja el evento en `dead_letter` y guarda una copia de diagnóstico en `outbox_dead_letters`.

La entrega es al menos una vez. `outbox_consumptions` evita reprocesar un `eventId` ya confirmado por el mismo consumidor. Todo handler que produzca un efecto externo debe además ser idempotente con ese `eventId`, porque una caída entre el efecto y su confirmación puede provocar una nueva entrega.

## Operación

El proceso `@aether/worker` exige `DATABASE_URL`; `WORKER_ID` es opcional y `OUTBOX_POLL_INTERVAL_MS` tiene un valor predeterminado de 1000 ms. Los handlers de publicación concretos se registran en el worker, no en los casos de uso ni dentro de transacciones de negocio.
