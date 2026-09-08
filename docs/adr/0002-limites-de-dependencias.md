# ADR-0002: Dependencias dirigidas hacia el dominio

- Estado: aceptado para el inicio
- Fecha: 2026-09-07

## Decisión

`domain` contiene reglas puras. `application` contiene comandos, consultas y puertos. `database`, `auth`, `observability`, `web`, `server` y `worker` son adaptadores o puntos de entrada.

## Regla

Un módulo interno no puede importar un módulo externo. Los contratos de transporte y persistencia no se propagan como entidades de dominio.
