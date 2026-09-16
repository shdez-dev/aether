# Organizaciones, workspaces y autorización contextual

## Entidades y aislamiento

`Organization` es el límite primario de aislamiento. Todos los workspaces pertenecen exactamente a una organización y nunca pueden cambiarla. Las consultas de workspace reciben ambos identificadores: si el workspace no pertenece a la organización del contexto, se responde como inexistente.

| Entidad                   | Identidad                        | Regla central                                          |
| ------------------------- | -------------------------------- | ------------------------------------------------------ |
| Organización              | `organizationId`                 | Contiene membresías, workspaces e invitaciones.        |
| Workspace                 | `workspaceId` + `organizationId` | Aislado dentro de una única organización.              |
| Membresía de organización | actor + organización             | Define el rol institucional base.                      |
| Membresía de workspace    | actor + workspace                | Concede acceso acotado a un workspace.                 |
| Invitación                | token hash + organización        | Es de un solo uso, tiene correo objetivo y expiración. |

## Roles y acciones

| Ámbito       | Roles                       | Capacidades                                                                                      |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------ |
| Organización | `owner`, `admin`, `member`  | Owner/admin gestionan organización, crean workspaces e invitan; member sólo lee su organización. |
| Workspace    | `admin`, `member`, `viewer` | Admin administra; member y viewer pueden leer.                                                   |

Las capacidades se calculan con el contexto completo: identidad, organización y, cuando existe, workspace. El backend nunca infiere pertenencia desde una URL ni acepta un rol enviado por el cliente.

`AuthorizationMatrix` en `@aether/domain` es la representación ejecutable de
esta tabla para las acciones de tenencia. Sus pruebas recorren los roles
permitidos y denegados. Los permisos de iniciativa y proyecto añaden sus
invariantes de propiedad y estado, por lo que no pueden otorgarse sólo por un
rol de workspace.

## Invitaciones

La invitación almacena sólo el hash de su token, el correo normalizado, roles y workspaces concedidos, y vence entre 1 y 30 días. Al aceptarla, una transacción valida token, expiración y coincidencia con el correo OIDC autenticado; después crea membresías de organización y workspace, y marca la invitación como consumida.

El token de aceptación se reserva para el adaptador de correo/outbox; la API no lo devuelve. El envío de correo será una integración posterior, sin cambiar este modelo ni exponer el token en logs o URL.

## Transferencia de propiedad

Sólo la persona propietaria vigente puede transferir la propiedad a una
membresía existente mediante `POST /v1/organizations/{organizationId}/ownership-transfers`.
La operación es transaccional: primero promueve al destinatario y después
degrada a la persona anterior a `admin`. PostgreSQL impide por trigger retirar
o degradar al último `owner`, y registra un evento append-only con actor,
destinatario, fecha y correlación.

## Interfaz

## Archivado de workspace

Archivar no elimina ni cambia el `organizationId`: conserva el workspace, sus
recursos y su historial para lectura autorizada. Sólo un administrador del
workspace u organización puede hacerlo y la operación exige autenticación
reciente. Desde ese momento, los casos de uso de escritura de iniciativas,
evaluaciones, proyectos, documentos, evidencia y comentarios responden
`WORKSPACE_ARCHIVED`; las consultas siguen disponibles. El registro
`workspace.archived.v1` conserva actor, fecha y correlación.

`GET /v1/organizations/{organizationId}/capabilities` devuelve capacidades calculadas en servidor. La interfaz usa esas capacidades para mostrar u ocultar acciones mediante `canRenderWorkspaceAction`, pero la API repite la autorización en cada mutación y lectura.

## Políticas de residencia y retención

Cada organización nueva debe declarar una política explícita con región de
residencia y días de retención. Owner y admin pueden actualizarla mediante
`PUT /v1/organizations/{organizationId}/policy`. Los workspaces consultan la
política efectiva mediante el mismo recurso y `workspaceId`; cada valor incluye
su origen (`organization` o `workspace`).

Una excepción de workspace se configura con
`PUT /v1/organizations/{organizationId}/workspaces/{workspaceId}/policy-override`
y se retira con `DELETE` explícito. Requiere `workspace:manage`, conserva ambos
identificadores de tenencia y no puede cruzar organizaciones. Configurar,
actualizar y retirar políticas escribe un evento append-only correlacionado en
`tenancy_policy_audit_events` dentro de la misma transacción PostgreSQL.

Las organizaciones creadas antes de la migración de políticas pueden carecer de
configuración hasta que un owner o admin la establezca; la consulta devuelve un
problema seguro de recurso no disponible y nunca inventa valores por defecto.
