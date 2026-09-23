# Matriz de transiciones institucionales

Esta matriz es el contrato operativo de las máquinas de estado. Cada comando
recibe correlación y versión esperada cuando cambia un agregado versionado. Los
eventos de auditoría conservan actor, transición y fecha; los eventos durables
se confirman con el estado cuando se indican.

## Iniciativas y evaluación

| Comando                        | Origen → destino                                              | Permiso y precondiciones                                                     | Efectos y evento                                                                                | Error principal                                                   |
| ------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Presentar iniciativa           | `draft`/`returned` → `presented`                              | Creador o rol contextual; `expectedVersion`                                  | Incrementa versión y audita `initiative.presented.v1`                                           | `INVALID_INITIATIVE_TRANSITION` o conflicto de versión            |
| Guardar borrador de evaluación | `presented` → `presented`                                     | Revisor asignado, estándar activo, versiones de iniciativa y borrador        | Guarda respuestas y audita `initiative.evaluation_draft_saved.v1`                               | Conflicto de borrador o estándar cambiado                         |
| Migrar borrador                | `presented` → `presented`                                     | Revisor asignado, estándar activo nuevo, mapeo completo, descartes y motivo  | Incrementa borrador y audita `initiative.evaluation_draft_migrated.v1`                          | `EVALUATION_DRAFT_MIGRATION_INVALID`                              |
| Publicar evaluación            | `presented` → `under_review`                                  | Revisor asignado, sin conflicto abierto, cobertura 100 %, versiones vigentes | Estado, evaluación, cierre de asignación, auditoría y outbox `initiative.evaluated.v1` atómicos | `EVALUATION_INCOMPLETE`, conflicto de interés o versión           |
| Decidir                        | `under_review` → `approved`/`rejected`/`returned`/`cancelled` | Solo owner, evaluación activa y completa, fundamento; devolución exige fecha | Guarda decisión inmutable, condiciones, auditoría y outbox `initiative.decided.v2` atómicos     | Conflicto de interés, evaluación incompleta o transición inválida |

La declaración de conflicto no cambia el estado de la iniciativa: bloquea la
publicación hasta que un owner la resuelva con fundamento. La abstención,
reasignación y escalamiento conservan la asignación anterior y auditan actor y
motivo. Una decisión `returned` conserva las observaciones como `rationale` y
la fecha de próxima revisión; las demás decisiones conservan su fundamento y
evidencia.

## Proyectos

| Comando   | Origen → destino                                                   | Permiso y precondiciones                                                     | Efectos y evento                                                  | Error principal                                             |
| --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Activar   | `planned`/`paused`/`blocked` → `active`                            | Acceso de ejecución, líder activo; desde pausa requiere replan y plan mínimo | Actualiza versión, auditoría y outbox `project.status_changed.v1` | `PROJECT_REPLAN_REQUIRED` o `PROJECT_MINIMUM_PLAN_REQUIRED` |
| Pausar    | `active` → `paused`                                                | Acceso de ejecución, motivo, responsable y fecha de revisión                 | Audita `project.paused.v1` con motivo y responsable               | `PROJECT_PAUSE_CONTEXT_REQUIRED`                            |
| Reanudar  | `paused` → `active`                                                | Acceso de ejecución y nota de replanificación                                | Audita `project.resumed.v1` con nota                              | `PROJECT_REPLAN_REQUIRED`                                   |
| Cancelar  | `pending_lead`/`planned`/`active`/`paused`/`blocked` → `cancelled` | Solo owner, motivo y versión vigentes                                        | Audita `project.cancelled.v1` con motivo                          | `PROJECT_CANCELLATION_REASON_REQUIRED`                      |
| Completar | `active` → `completed`                                             | Acceso de ejecución y transición permitida                                   | Auditoría y outbox de estado                                      | `INVALID_PROJECT_TRANSITION`                                |
| Archivar  | `completed`/`cancelled` → `archived`                               | Revisor de cambios y versión vigente                                         | Auditoría `project.archived.v1`; estado terminal                  | `INVALID_PROJECT_TRANSITION`                                |

La base de datos replica las transiciones de proyecto y bloquea mutar un estado
terminal. Motivo y actor son obligatorios para pausa, cancelación, replanificación,
decisiones y excepciones; las transiciones técnicas sin motivo no inventan uno.
