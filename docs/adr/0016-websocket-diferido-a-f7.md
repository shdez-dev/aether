# ADR-0016: WebSocket diferido hasta que exista un caso de uso de tiempo real

- Estado: aceptado
- Fecha: 2026-09-18

## Decisión

Aether no expondrá una superficie WebSocket durante F1. No hay un caso de uso
de producto que requiera conexión persistente y abrirla sólo para completar un
hito aumentaría la superficie de autenticación, autorización y revocación sin
entregar una capacidad necesaria.

La autorización central ya resuelve sesión y alcance por solicitud HTTP, y el
worker vuelve a validar el alcance durable antes de mutar. Cuando F7 introduzca
tiempo real, cada conexión deberá autenticar sesión y origen; cada suscripción
deberá pasar la misma autoridad contextual por organización y recurso; y una
revocación deberá invalidar las suscripciones afectadas. No se permite usar la
presencia como autoridad de negocio.

## Consecuencias

- F1 queda cerrada sin crear un canal de tiempo real prematuro.
- F7 conserva la implementación, límites y pruebas de WebSocket como trabajo
  explícito.
- Ninguna ruta HTTP, worker o futura suscripción puede delegar la decisión de
  acceso al cliente.
