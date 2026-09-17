# ADR-0012: reubicación intra-workspace de documentos

## Estado

Aceptada.

## Decisión

Un documento puede cambiar de recurso padre sólo dentro del mismo workspace y
organización. El actor debe poder contribuir al origen y al destino; el
documento conserva clasificación y versiones. No se permite reubicar un
documento con referencias de evidencia o aceptaciones de entregable, ni cruzar
workspaces u organizaciones. La operación registra auditoría append-only.

## Consecuencias

El traslado no cambia residencia ni retención y no reescribe evidencia
histórica. Los movimientos entre workspaces u organizaciones siguen siendo
exportación/importación aprobada.
