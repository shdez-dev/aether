# Estrategia de ramas, commits, releases y versiones

## Modelo de ramas

Se usa desarrollo basado en tronco. `main` es siempre integrable y representa el siguiente release candidato. Nadie integra directamente en `main`; todo cambio llega mediante pull request revisado.

| Tipo          | Patrón            | Uso                                     |
| ------------- | ----------------- | --------------------------------------- |
| Producto      | `feat/<tema>`     | Capacidad nueva o rebanada vertical     |
| Corrección    | `fix/<tema>`      | Defecto reproducible                    |
| Seguridad     | `security/<tema>` | Mitigación prioritaria                  |
| Documentación | `docs/<tema>`     | Cambio documental sin comportamiento    |
| Operación     | `chore/<tema>`    | Herramientas, CI o mantenimiento        |
| Release       | `release/vX.Y`    | Estabilización excepcional de una minor |
| Emergencia    | `hotfix/<tema>`   | Parche urgente desde un tag publicado   |

Las ramas son breves, con un propósito y un propietario. No se mantiene una rama `develop`; los flags separan despliegue de lanzamiento. Las ramas de release solo se crean si hay una necesidad real de estabilizar mientras `main` continúa evolucionando.

## Pull requests y protección

Un pull request debe enlazar historia o incidencia, describir el cambio, riesgos, migraciones, impacto de seguridad y evidencia de pruebas. Requiere al menos una revisión aprobada, CI verde y resolución de conversaciones antes de integrar.

`main` debe exigir revisión, checks obligatorios, historial lineal o squash merge, firmas cuando el proveedor lo permita y prohibir force push y borrado. Los checks mínimos son instalación con lockfile, formato, lint, typecheck, pruebas, build, escaneo de secretos y verificación de migraciones cuando existan.

## Commits

Se adopta Conventional Commits:

```text
tipo(alcance opcional): resumen imperativo
```

Tipos permitidos: `feat`, `fix`, `security`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf` y `revert`.

El cuerpo explica el motivo cuando no es obvio. Los cambios incompatibles llevan `!` o un pie `BREAKING CHANGE:`. Un commit no mezcla cambios no relacionados, secretos, artefactos generados ni formateos masivos ajenos al objetivo.

## Versionado y releases

Se usa Semantic Versioning `MAJOR.MINOR.PATCH`.

| Cambio                                                  | Versión |
| ------------------------------------------------------- | ------- |
| Corrección compatible                                   | PATCH   |
| Capacidad compatible                                    | MINOR   |
| Cambio incompatible de contrato, datos o comportamiento | MAJOR   |

Mientras el producto no haya alcanzado su primer release operable, las versiones permanecen en `0.x.y`: una incompatibilidad incrementa MINOR y una corrección incrementa PATCH. Los prereleases usan `-alpha.N`, `-beta.N` o `-rc.N`.

Cada release se identifica con tag anotado `vX.Y.Z`, changelog generado desde commits convencionales y una nota con alcance, migraciones, compatibilidad, riesgos, rollback y evidencia de calidad. Se publica desde un commit inmutable de `main`; los hotfixes parten del tag afectado, se liberan como PATCH y se reintegran a `main`.

## Política inicial

El esqueleto actual permanece en `0.1.0`. No se crea un release hasta que la primera rebanada vertical tenga contrato, pruebas, observabilidad, runbook y aprobación de aceptación.
