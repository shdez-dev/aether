# Runtime, dependencias y propiedad técnica

## Runtime reproducible

El repositorio usa Node.js `24.18.0` LTS y pnpm `11.24.0`. `.node-version`,
`package.json` y el workflow de CI fijan ese contrato. Se instala siempre con
`pnpm install --frozen-lockfile`; una modificación del manifiesto que requiera
resolver dependencias debe incluir el cambio correspondiente de
`pnpm-lock.yaml`.

## Propietarios por límite

| Área | Paquetes o proceso | Responsable de cambios |
| --- | --- | --- |
| Reglas institucionales | `@aether/domain` | Responsable de dominio |
| Casos de uso y puertos | `@aether/application` | Responsable backend |
| Bordes HTTP y eventos | `@aether/contracts` | Responsable API |
| Identidad y sesiones | `@aether/auth` | Responsable de seguridad |
| Persistencia y migraciones | `@aether/database` | Responsable de datos |
| Evidencia binaria | `@aether/storage` | Responsable de plataforma |
| Trazas, métricas y logs | `@aether/observability` | Responsable de plataforma |
| Fixtures y pruebas | `@aether/testkit` | Responsable de calidad |
| Procesos web, API y worker | `apps/web`, `apps/server`, `apps/worker` | Responsables frontend y backend |

Estos son roles de revisión, no permisos de producción. Los cambios que
crucen límites requieren revisión del responsable de origen y destino; una
nueva arista necesita ADR y debe actualizar `architecture:check`.

## Actualización de dependencias

1. Se revisan actualizaciones una vez por mes y antes de cada release.
2. Parches de seguridad críticos se corrigen en 24 horas; los altos, en siete
   días. Una excepción requiere responsable, vencimiento y mitigación escrita.
3. Las actualizaciones menores se agrupan y se validan con `pnpm verify`.
   Las mayores se realizan en una rama dedicada, con notas de compatibilidad,
   migración y rollback.
4. Node LTS se evalúa al inicio de su ciclo activo. El cambio exige actualizar
   `.node-version`, `engines`, CI, imágenes de ejecución y el runbook local.
5. Nunca se actualiza el lockfile manualmente ni se aceptan dependencias sin
   licencia, mantenimiento y superficie de seguridad revisados.

## Evidencia de instalación limpia

CI ejecuta `pnpm install --frozen-lockfile` en un runner vacío antes de
`pnpm verify`. Una ejecución verde de `Verify` es la evidencia requerida de
instalación reproducible; no se sustituye por reutilizar `node_modules` local.

`turbo run typecheck` invoca el proyecto TypeScript de cada aplicación y
paquete. El chequeo raíz se conserva como red de seguridad para las rutas de
workspace compartidas.
