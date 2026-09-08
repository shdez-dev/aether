# Convenciones de aplicación y puertos

## Comandos

Un comando cambia un agregado o inicia una operación de negocio. Se nombra con verbo imperativo y propósito único: `CreateInitiativeDraft`, `SubmitInitiative` o `AcceptOrganizationInvitation`. Incluye metadatos de actor, organización, correlación y hora observada. El handler valida autorización, carga estado, aplica invariantes, persiste dentro de una unidad de trabajo y escribe eventos en outbox.

Los comandos reintentables reciben una clave de idempotencia en el borde. No ejecutan correo, HTTP externo ni publicación de Redis antes del commit. Su resultado es explícito: éxito, validación, conflicto, precondición, no encontrado seguro o dependencia.

## Consultas

Una consulta no altera estado ni publica eventos. Se nombra según la proyección que devuelve: `GetInitiativeDetail`, `ListWorkspaceInitiatives` o `GetAuditTimeline`. Recibe contexto de acceso y aplica filtros de tenencia antes de leer o agregar. La paginación usa cursor estable; las métricas documentan denominador, período y datos faltantes.

## Casos de uso

Cada caso de uso implementa `CommandHandler` o `QueryHandler` y vive en `packages/application/<contexto>`. La entrada de aplicación no es un objeto `Request` HTTP ni una fila SQL. El borde convierte DTO validado a comando o consulta y convierte el resultado a contrato de respuesta.

## Puertos y adaptadores

Un puerto expresa una necesidad de aplicación: `InitiativeRepository`, `UnitOfWork`, `DomainEventPublisher`, `Clock` o `IdGenerator`. Vive junto al caso de uso y termina en `Port`. Un adaptador implementa ese puerto y describe su tecnología: `PostgresInitiativeRepository`, `PostgresUnitOfWork` o `S3ObjectStore`.

Los puertos no aceptan ni devuelven objetos del ORM. Las operaciones que deben ser atómicas reciben la misma transacción desde aplicación; ningún adaptador abre una segunda conexión por su cuenta.
