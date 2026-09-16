# Aether

Aether convierte una necesidad en una iniciativa evaluable, una decisión trazable y un proyecto ejecutable con evidencia de resultados.

## Arquitectura

El repositorio comienza como un monolito modular. `apps/web`, `apps/server` y `apps/worker` se despliegan de manera independiente, pero los dominios se mantienen dentro del mismo repositorio y comparten contratos explícitos.

```text
Browser -> web (Next.js) -> server (Fastify) -> PostgreSQL
                                  |                 |
                                  +-> outbox -------+-> worker -> correo, archivos, exportaciones
                                  +-> Redis (solo caché, presencia e invalidación)
```

Las reglas de negocio viven en `packages/domain`; los casos de uso y puertos en `packages/application`. Ninguno puede importar frameworks, ORM, proveedores cloud o componentes de interfaz.

## Estructura

```text
apps/                 Procesos desplegables
packages/             Módulos reutilizables con dependencias hacia dentro
infra/                Infraestructura declarativa por entorno
docs/adr/             Decisiones de arquitectura
docs/runbooks/        Procedimientos operativos
```

## Estado funcional actual

La rebanada F1 implementada cubre OIDC con PKCE, sesiones opacas revocables,
organizaciones, workspaces, equipos, invitaciones, transferencia de propiedad,
archivado y políticas explícitas de residencia/retención con herencia visible.
También cubre concesiones temporales exactas por recurso y acción, con
solicitud justificada, aprobación independiente de owner, duración máxima de
ocho horas, revocación y auditoría de cada uso. El acceso JIT de soporte limita
la elevación a un diagnóstico agregado predefinido durante un máximo de una
hora, con aprobación separada y sin acceso a contenido institucional.

Las políticas se gestionan mediante los endpoints documentados en
[`tenancy-and-authorization.md`](docs/architecture/tenancy-and-authorization.md)
y requieren autorización de servidor, CSRF en mutaciones y auditoría
correlacionada. No se asignan valores por defecto a organizaciones antiguas que
aún no tengan política configurada.

## Gobierno de ingeniería

- [Estado y alcance del repositorio](docs/governance/repository-baseline.md)
- [Estrategia de ramas, commits, releases y versiones](docs/governance/source-control-and-releases.md)
- [Política de variables de entorno y secretos](docs/governance/environment-and-secrets.md)
- [Runtime, dependencias y propiedad técnica](docs/governance/runtime-and-dependencies.md)

## Contratos y límites

- [Reglas de dependencia](docs/architecture/dependency-rules.md)
- [Convenciones de aplicación y puertos](docs/architecture/application-conventions.md)
- [Contratos HTTP, errores y correlación](docs/architecture/api-contracts.md)
- [OpenAPI 3.1 inicial](packages/contracts/openapi/aether.v1.yaml)
- [Autenticación OIDC y sesiones](docs/architecture/authentication-and-sessions.md)
- [Organizaciones, workspaces y autorización](docs/architecture/tenancy-and-authorization.md)
- [Ciclo de vida de iniciativas institucionales](docs/architecture/initiative-lifecycle.md)
- [Evaluación y decisión institucional](docs/architecture/evaluation-and-decision.md)
- [Proyecto y ejecución](docs/architecture/project-execution.md)
- [Outbox y trabajos asíncronos](docs/architecture/outbox-and-worker.md)
- [Auditoría y trazabilidad](docs/architecture/audit-and-traceability.md)
- [Frontend y sistema de diseño](docs/architecture/frontend-design-system.md)

## Verificación local

```powershell
pnpm local:up
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm architecture:check
pnpm openapi:validate
pnpm test
```

La configuración local se toma de los `.env` de cada aplicación; los secretos
no deben escribirse en el repositorio. PostgreSQL es la autoridad transaccional,
Redis sólo se usa para funciones no durables y Keycloak provee la identidad
OIDC. Las migraciones de tenencia y concesiones son aditivas: la estructura
base está en
[`0028_tenancy_policies_and_access_grants.sql`](packages/database/migrations/0028_tenancy_policies_and_access_grants.sql)
y el ciclo de vida auditable en
[`0029_temporary_access_grant_lifecycle.sql`](packages/database/migrations/0029_temporary_access_grant_lifecycle.sql).
El ciclo JIT de soporte se completa de forma aditiva en
[`0030_support_access_grant_lifecycle.sql`](packages/database/migrations/0030_support_access_grant_lifecycle.sql).

Las identidades autorizadas para solicitar JIT se configuran explícitamente en
`SUPPORT_OPERATOR_ACTOR_IDS`. La elegibilidad no concede permisos por sí sola:
cada organización debe aprobar una solicitud vigente. El procedimiento está en
el [runbook de acceso JIT](docs/runbooks/support-jit-access.md).
