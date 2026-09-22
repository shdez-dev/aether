# Ciclo de vida de proyectos

Los estados canónicos son `pending_lead`, `planned`, `active`, `paused`, `blocked`,
`completed`, `cancelled` y `archived`. El dominio y PostgreSQL aplican la misma
matriz de transiciones; ninguna actualización genérica puede saltarla.

| Desde | Hacia | Comando | Autoridad | Precondiciones | Efecto y evento | Error principal |
| --- | --- | --- | --- | --- | --- | --- |
| `pending_lead` | `planned` | `POST /lead` | owner | versión esperada y líder activo con alcance | actualiza líder y auditoría | `PROJECT_LEAD_ASSIGNMENT_INVALID` |
| `planned` | `active` | `PATCH /status` | líder, owner o admin | versión esperada y plan mínimo | incrementa versión; `project.status_changed.v1` | `PROJECT_MINIMUM_PLAN_REQUIRED` |
| `active` | `paused` | `POST /pause` | líder, owner o admin | versión, motivo, responsable y fecha | `project.paused.v1` | `PROJECT_PAUSE_CONTEXT_REQUIRED` |
| `paused` | `active` | `POST /resume` | líder, owner o admin | versión y nota de replanificación | `project.resumed.v1` | `PROJECT_REPLAN_REQUIRED` |
| `active` | `blocked` | `PATCH /status` | líder, owner o admin | versión esperada | `project.status_changed.v1` | `INVALID_PROJECT_TRANSITION` |
| `blocked` | `active`/`paused` | `PATCH /status` o `POST /pause` | líder, owner o admin | versión y contexto de pausa cuando corresponda | evento de estado/pausa | `INVALID_PROJECT_TRANSITION` |
| `active` | `completed` | `PATCH /status` | líder, owner o admin | versión esperada | `project.status_changed.v1` | `INVALID_PROJECT_TRANSITION` |
| activo, pausado o bloqueado | `cancelled` | `POST /cancellation` | líder, owner o admin | versión y fundamento | `project.cancelled.v1` | `PROJECT_CANCELLATION_REASON_REQUIRED` |
| `completed` | cierre formal | `POST /closure` | líder, owner o admin | resultados, evaluación, lecciones y excepciones válidas | `project.closed.v1` | `PROJECT_CLOSURE_EXCEPTION_INVALID` |
| `completed` o `cancelled` | `archived` | `POST /archive` | owner o admin | versión esperada | `project.archived.v1` | `PROJECT_ARCHIVE_INVALID` |

`archived` es terminal. El expediente de cierre es inmutable; una aceptación de
entrega publicada puede registrarse antes del cierre formal, pero no reabre el
proyecto ni modifica su estado.
