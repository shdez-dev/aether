# ADR-0005: La autorización combina rol y contexto explícito

- Estado: aceptado para el inicio
- Fecha: 2026-09-07

## Decisión

La autorización verifica identidad, organización, workspace, rol candidato, recurso, estado y condiciones como conflicto de interés. Un rol global no otorga acceso universal. Las invitaciones y accesos externos son temporales, acotados y auditables.

## Consecuencias

- La política se ejecuta en servidor, worker y tiempo real.
- Las consultas agregadas y exportaciones se filtran antes de devolver datos.
- La interfaz recibe capacidades calculadas, pero nunca sustituye la comprobación de backend.
