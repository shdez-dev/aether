# Proyecto y ejecución

## Conversión trazable

Solo un `owner` puede crear un proyecto desde una iniciativa `approved` y su
decisión aprobatoria exacta. La base de datos impide reutilizar la misma
iniciativa o decisión. El proyecto conserva ambos identificadores de origen,
por lo que la cadena iniciativa → decisión → proyecto puede consultarse sin
inferencias.

El comando exige un sponsor y un líder distintos, más la lista completa de
participantes. Todos deben ser miembros de la organización y se registra su rol
(`sponsor`, `lead`, `contributor` u `observer`); la conversión no asigna roles
implícitos.

La conversión es canónica por iniciativa: una carrera con los mismos datos
devuelve el proyecto ya persistido, sin un segundo evento ni auditoría. Si la
solicitud concurrente cambia decisión, nombre, sponsor, líder o participantes,
se rechaza con conflicto en vez de reinterpretar el proyecto existente.

## Ejecución

Los estados son `planned`, `active`, `blocked`, `completed` y `cancelled`.
Solo el líder, un `admin` o el `owner` cambian el estado o añaden hitos y
próximas acciones. Un hito registra título y vencimiento; una próxima acción
registra responsable y vencimiento.

La designación histórica de líder no sobrevive a una suspensión o revocación:
cada operación de ejecución vuelve a resolver la membresía organizacional
activa. Los grants temporales siguen su propio flujo de autorización y también
deben denegarse si la revocación aplicable los invalida.

Creación, cambios de estado, hitos y acciones producen eventos de auditoría con
actor, correlación y fecha. La migración `0005_projects_and_execution.sql`
persiste el agregado, ejecución y bitácora.

## Entregables

La aceptación conserva el identificador exacto de la versión publicada. El
documento debe pertenecer al mismo proyecto, organización y workspace; una
versión de otro proyecto, incluso dentro del mismo workspace, se trata como no
encontrada para no revelar ni reutilizar entregables ajenos.
