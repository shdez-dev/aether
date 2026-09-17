# Auditoría y trazabilidad

`audit_events` es la línea temporal institucional única. Cada evento incluye actor, organización y workspace como contexto, acción, tipo e identificador de recurso, instante, resultado, correlación, causalidad, referencia al evento asíncrono y carga útil segura.

Las bitácoras de iniciativa y proyecto son las fuentes de escritura actuales. Triggers PostgreSQL las materializan en el historial común; una evaluación y una decisión se identifican por los IDs incluidos en su evento de iniciativa. Esto conserva los historiales ya existentes y permite consultar por `initiative`, `evaluation`, `decision` o `project` con `GET /v1/audit-events`.

Los comentarios conservan una bitácora local append-only: creación, edición,
resolución, reapertura y eliminación lógica se persisten atómicamente con la
mutación, sin copiar el contenido del comentario al evento.

La tabla común es append-only: un trigger rechaza `UPDATE` y `DELETE`. Las migraciones son la única vía controlada para una evolución estructural. Las mutaciones críticas de iniciativa, evaluación, decisión y proyecto registran una auditoría exitosa; las respuestas HTTP, el registro de auditoría y el outbox conservan el mismo `correlationId`. Cuando existe un evento de outbox del agregado, el historial vincula su `asyncEventId`.

El acceso al historial exige pertenencia organizacional. Owners y administradores pueden consultarlo en toda la organización; un miembro necesita pertenencia al workspace del evento.
