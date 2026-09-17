# ADR-0011: ciclo de vida auditable de comentarios

## Estado

Aceptada.

## Contexto

Los comentarios permiten conversaciones contextualizadas, pero sus cambios no
dejaban evidencia durable. Editar o eliminar físicamente un comentario impediría
reconstruir la conversación institucional.

## Decisión

- El autor puede editar y eliminar lógicamente su propio comentario; owners y
  administradores pueden eliminarlo lógicamente.
- Resolver y reabrir exige acceso vigente al recurso padre.
- Cada creación, edición, resolución, reapertura y eliminación registra un
  evento append-only con actor, alcance y correlación.
- La mutación y su evento se guardan en una sola transacción PostgreSQL.

## Consecuencias

Los listados excluyen comentarios eliminados, mientras la bitácora conserva la
evidencia de la acción. El contenido anterior no se replica en la bitácora.
