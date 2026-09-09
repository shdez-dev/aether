# ADR-0004: Estándares y evaluaciones son versionados e inmutables al publicar

- Estado: aceptado para el inicio
- Fecha: 2026-09-07

## Decisión

Un estándar publicado se versiona y no se modifica. Puede haber un estándar activo por organización para orientar una nueva revisión, pero el comando de revisión debe indicar su identificador explícitamente. Cada evaluación persiste la versión exacta de estándar, el snapshot de criterios, la cobertura y la versión de iniciativa evaluada. Corregir requiere una nueva versión o una anulación trazable, nunca una sobrescritura.

## Consecuencias

- Las decisiones institucionales son reproducibles.
- La adopción de un estándar posterior es explícita y auditable.
- Los reportes deben mostrar versión, cobertura y datos no evaluables.
- Activar otro estándar no altera evaluaciones ni decisiones ya registradas.
