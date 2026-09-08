# ADR-0001: Monolito modular con web, servidor y worker

- Estado: aceptado para el inicio
- Fecha: 2026-09-07

## Decisión

Aether comienza como un monolito modular. Se organizan tres aplicaciones desplegables: `web`, `server` y `worker`. La lógica de dominio se separa por paquetes y no se distribuye en servicios de red internos.

## Consecuencias

- PostgreSQL conserva la autoridad transaccional.
- Los efectos posteriores al commit se escriben en una outbox y los procesa `worker`.
- Una futura extracción exige evidencia de escala, aislamiento, seguridad o autonomía de entrega.
