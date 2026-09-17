# ADR-0010: conversión de iniciativa atómica y recuperable

## Estado

Aceptada.

## Contexto

La conversión de una iniciativa aprobada crea un proyecto y un evento durable.
La auditoría de conversión se persistía después de esa transacción; un fallo en
ese punto podía dejar un proyecto válido sin su evidencia local y hacer que un
reintento recibiera un conflicto, aunque no existiera ninguna acción externa
que compensar.

## Decisión

- Proyecto, evento de outbox y auditoría de creación se guardan en una única
  transacción PostgreSQL.
- Un fallo antes del commit no deja proyecto, evento ni auditoría parciales.
- Repetir la conversión canónica con los mismos datos devuelve el proyecto ya
  creado sin registrar un segundo evento o auditoría. Una variación de nombre,
  decisión, patrocinador, líder o participantes sigue siendo un conflicto.
- No se agrega un estado de proyecto `fallida_compensable`: cuando falla la
  transacción no hay estado de negocio que recuperar. Los efectos posteriores
  al commit se compensan mediante outbox, reintentos y dead letters.

## Consecuencias

La operación es segura ante una respuesta perdida después del commit y conserva
un único origen iniciativa → decisión → proyecto. Los adaptadores que soporten
la conversión compuesta deben implementar la frontera transaccional completa.

## Alternativas rechazadas

- Persistir un proyecto fallido antes de completar la transacción: expone una
  entidad inexistente desde el punto de vista del negocio.
- Repetir siempre la creación y depender sólo de la restricción única: no
  permite recuperar una respuesta perdida de forma estable.
