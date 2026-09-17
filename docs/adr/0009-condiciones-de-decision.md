# ADR-0009: condiciones vinculantes de una decisión aprobada

## Estado

Aceptada.

## Contexto

Una iniciativa aprobada puede requerir compromisos verificables antes de
convertirse en proyecto. Sin una estructura propia, esos compromisos quedarían
en texto libre y no podrían bloquear la conversión, conservar su historial ni
atribuirse a una persona responsable.

## Decisión

- Las condiciones sólo se crean al aprobar una iniciativa y pertenecen a una
  decisión inmutable en su resultado, fundamento y evidencia.
- Cada condición conserva descripción, responsable que sea miembro activo de
  la organización al crearla, fecha de vencimiento y estado `pending`,
  `fulfilled` o `exempted`.
- Una condición pendiente bloquea la creación de cualquier proyecto desde su
  decisión fuente. Las condiciones resueltas o exentas no bloquean.
- En esta rebanada, sólo un `owner` puede eximir una condición pendiente. Debe
  aportar un motivo, contar con autenticación reciente y la operación queda
  auditada con correlación.
- La exención no borra la condición: conserva actor, fecha y motivo de
  resolución. El comando para declarar `fulfilled` se implementará en una
  rebanada posterior con su autorización específica.

## Consecuencias

PostgreSQL es la fuente transaccional de las condiciones. La consulta de una
decisión devuelve siempre su colección de condiciones, incluso vacía, y la
conversión a proyecto revalida sus estados antes de crear recursos. Los clientes
pueden mostrar `fulfilled` como estado histórico, pero no pueden mutarlo en
esta versión de la API.

## Alternativas rechazadas

- Guardar condiciones en el fundamento de la decisión: no permite bloqueo ni
  seguimiento estructurado.
- Permitir que cualquier administrador exima: reduce la separación entre la
  excepción de gobierno y la ejecución ordinaria.
- Eliminar condiciones exentas: destruye evidencia institucional relevante.
