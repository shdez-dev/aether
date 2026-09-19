# Ciclo de vida de la iniciativa institucional

## Modelo mínimo

Una iniciativa describe una necesidad que la institución puede evaluar: título,
problema, resultado esperado, clasificación, organización y workspace. El
agregado conserva quién la creó, versión optimista y sus marcas de tiempo.

La prioridad solicitada (`low`, `medium` o `high`) se registra al crear la
iniciativa y conserva la urgencia expresada por quien la propone. La prioridad
operativa es independiente, inicialmente nula y sólo puede fijarla o cambiarla
un `owner` o `admin` de organización. Cada cambio operativo exige versión,
queda auditado y no altera la solicitud original. Los registros previos a esta
capacidad conservan prioridad solicitada nula, en vez de inventar un dato
histórico.

El workspace y la organización siempre se validan juntos; una iniciativa no
puede leerse ni modificarse desde otro contexto.

## Estados y transiciones

```text
draft -> presented -> under_review -> approved
                 |                 -> rejected
                 |                 -> returned -> presented
                 |                 -> cancelled
draft -----------------> cancelled
presented -------------> cancelled
```

Mientras permanece `presented`, la iniciativa puede recibir un resultado de
triage versionado; ese resultado no introduce un estado adicional ni muta la
transición de la iniciativa.

`approved`, `rejected` y `cancelled` son terminales. `returned` permite editar
y presentar nuevamente; no se confunde con una aprobación pendiente.
No existen estados de "aprobación pendiente", "proyecto" o equivalentes: la
conversión a proyecto es una decisión posterior y explícita (ADR-0003). El
triage es un resultado versionado previo a `under_review`, no un estado nuevo
ni una evaluación formal.

## Responsabilidades explícitas

| Acción             | Estado de origen | Actores permitidos                                               |
| ------------------ | ---------------- | ---------------------------------------------------------------- |
| Crear              | —                | `owner`/`admin` de organización, o `admin`/`member` de workspace |
| Editar o presentar | `draft`          | Creador, `owner`/`admin` de organización o `admin` de workspace  |
| Evaluar            | `presented`      | `owner` o `admin` de organización                                |
| Decidir            | `under_review`   | Solo `owner` de organización                                     |

Estas reglas se calculan en el servidor y se entregan al cliente como
`allowedActions`. La interfaz usa esa lista únicamente para presentar acciones;
la autorización y las transiciones se vuelven a comprobar en el caso de uso y
en el dominio.

## Auditoría y concurrencia

Crear, editar, presentar, iniciar revisión y decidir generan eventos de
auditoría con actor, correlación, estados anterior/posterior y fecha. La tabla
de iniciativa usa `version`; los comandos requieren `expectedVersion` y
responden con conflicto si otra operación ya modificó el agregado.

La migración `0003_initiatives.sql` conserva las iniciativas y la bitácora en
PostgreSQL. Los contratos HTTP están en el OpenAPI 3.1 y cada solicitud mutante
requiere la protección CSRF de la sesión.
