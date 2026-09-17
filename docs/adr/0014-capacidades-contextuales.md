# ADR-0014: Capacidades contextuales calculadas

- Estado: aceptado
- Fecha: 2026-09-17

## Decisión

La autorización contextual expone cuatro niveles calculados y ordenados: `READ`, `CONTRIBUTE`, `MANAGE` y `ADMIN`. No son roles ni sustituyen las acciones sensibles de la matriz de autorización.

- `READ` exige membresía organizacional o de workspace activa.
- `CONTRIBUTE` exige owner/admin organizacional o member/admin de workspace.
- `MANAGE` exige owner/admin organizacional o admin de workspace.
- `ADMIN` queda reservado para owner organizacional.

Acciones como transferir propiedad, gestionar membresías, soporte JIT y políticas siguen requiriendo su permiso específico, aunque el actor tenga un nivel alto.

## Consecuencias

El servidor calcula las capacidades desde roles activos en cada solicitud y la UI las consume sólo para presentar opciones. Ningún cliente puede elevar privilegios enviando una capacidad. La matriz sigue siendo la autoridad para cada mutación.
