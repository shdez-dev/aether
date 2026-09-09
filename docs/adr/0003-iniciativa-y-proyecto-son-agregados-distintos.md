# ADR-0003: Iniciativa y proyecto son agregados distintos

- Estado: aceptado para el inicio
- Fecha: 2026-09-07

## Decisión

Una iniciativa representa una necesidad sometida a evaluación y decisión. Un proyecto representa un compromiso ejecutable. La conversión será un comando explícito, idempotente y trazable en una rebanada posterior; no es una edición de estado ni una copia automática de permisos o roles.

## Consecuencias

- Una iniciativa aprobada conserva su versión, estándar, evidencia y decisión.
- Una iniciativa aprobada no produce todavía un proyecto: la conversión se mantiene fuera del primer ciclo institucional.
- Líder y patrocinador deben confirmar su rol; el actor que convierte no obtiene responsabilidades implícitas.
