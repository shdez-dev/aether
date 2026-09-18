# ADR-0015: Separación entre evaluación y decisión

- Estado: aceptado
- Fecha: 2026-09-18

## Decisión

La persona que emite una evaluación de iniciativa no puede resolver esa misma
iniciativa. La comprobación se hace contra la evaluación persistida en el
momento de decidir, antes de aplicar el rol de owner requerido para la
resolución.

## Consecuencias

El conflicto responde `403 CONFLICT_OF_INTEREST`, no crea decisión ni evento de
auditoría de éxito. La organización debe asignar una persona distinta para
decidir. Esta regla no reemplaza la autorización por rol ni las condiciones de
estado y versión.
