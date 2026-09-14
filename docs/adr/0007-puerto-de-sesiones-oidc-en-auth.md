# ADR 0007: Puerto de sesiones OIDC en `auth`

- Estado: aceptada
- Fecha: 2026-09-14

## Contexto

Las transacciones OIDC y las sesiones opacas son parte del protocolo de
identidad. Sus tipos y puertos (`AuthStore`, `AuthSessionAuditStore`) residen
en `@aether/auth`; `@aether/database` implementa esos puertos para
PostgreSQL. Por ello el adaptador PostgreSQL necesita una dependencia de tipos
en `@aether/auth`.

La regla habitual impide que un adaptador dependa de otro para evitar acoplar
proveedores de infraestructura. Esta relación existe únicamente para que el
adaptador de persistencia implemente un puerto de protocolo, no para invocar
un proveedor OIDC ni para que el núcleo dependa de PostgreSQL.

## Decisión

Se autoriza exclusivamente la arista `@aether/database` → `@aether/auth`.
`scripts/check-architecture.mjs` la reconoce sólo mientras este ADR exista.
Ninguna otra dependencia entre adaptadores queda permitida implícitamente.

## Consecuencias

El control automatizado seguirá protegiendo el resto de los límites. Si los
puertos de sesión se trasladan a `@aether/application` en una evolución
posterior, esta excepción debe eliminarse junto con esta ADR.
