# ADR-0005: La autorización combina rol y contexto explícito

- Estado: aceptado para el inicio
- Fecha: 2026-09-07

## Decisión

La autorización verifica identidad, organización, workspace, rol candidato, recurso, estado y condiciones como conflicto de interés. Un rol global no otorga acceso universal. Las invitaciones y accesos externos son temporales, acotados y auditables.

La primera implementación concreta usa roles `owner`, `admin` y `member` en organización; y `admin`, `member` y `viewer` en workspace. El owner/admin de una organización puede operar todos sus workspaces. Los demás usuarios requieren una membresía explícita del workspace.

## Consecuencias

- La política se ejecuta en servidor, worker y tiempo real.
- Las consultas agregadas y exportaciones se filtran antes de devolver datos.
- La interfaz recibe capacidades calculadas, pero nunca sustituye la comprobación de backend.
