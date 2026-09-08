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

## Estado inicial

La primera rebanada vertical será: invitación, sesión segura, organización, workspace aislado, iniciativa mínima presentada y auditoría consultable. No se implementará lógica de negocio fuera de esa rebanada sin una historia, contrato y caso de prueba.

## Gobierno de ingeniería

- [Estado y alcance del repositorio](docs/governance/repository-baseline.md)
- [Estrategia de ramas, commits, releases y versiones](docs/governance/source-control-and-releases.md)
- [Política de variables de entorno y secretos](docs/governance/environment-and-secrets.md)

## Contratos y límites

- [Reglas de dependencia](docs/architecture/dependency-rules.md)
- [Convenciones de aplicación y puertos](docs/architecture/application-conventions.md)
- [Contratos HTTP, errores y correlación](docs/architecture/api-contracts.md)
- [OpenAPI 3.1 inicial](packages/contracts/openapi/aether.v1.yaml)
- [Autenticación OIDC y sesiones](docs/architecture/authentication-and-sessions.md)
