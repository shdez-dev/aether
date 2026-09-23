# Evaluación y decisión institucional

## Triage previo

El triage es una etapa de intake separada de la evaluación formal. Un estándar
de triage publicado contiene criterios con código, descripción y marca de
obligatoriedad; sus versiones son inmutables y el `owner` adopta explícitamente
una única versión activa por organización. Cada adopción queda registrada con
actor y fecha.

Una iniciativa `presented` puede recibir un resultado de triage contra el
estándar activo. El resultado conserva la versión exacta de la iniciativa, el
estándar y su versión, además del snapshot de cada criterio, resultado
(`pass`, `fail` o `not_applicable`), justificación, actor y fecha. Los criterios
obligatorios deben estar presentes y `not_applicable` exige una justificación
no vacía. El triage no cambia por sí mismo el estado de la iniciativa ni crea
una evaluación formal; ambos registros permanecen separados.

PostgreSQL impone unicidad por iniciativa, versión de iniciativa, estándar y
versión; valida organización, workspace, versiones y que el estándar siga
activo al insertar. Un estándar publicado y cada resultado de triage son
append-only; además, la activación sólo confirma si queda registrada una
adopción. El resultado y `initiative.triaged.v1` se guardan en una única
transacción. Los comandos HTTP de publicación, adopción y triage aceptan
`Idempotency-Key`.

## Estándar y cobertura

Un estándar publicado contiene criterios con código, descripción y peso. El
`owner` puede activar uno como referencia organizacional, pero la evaluación
recibe siempre `standardId` de forma explícita. Al revisar, Aether guarda el
identificador, versión y snapshot de cada criterio junto a la cobertura:
criterios totales, evaluados y porcentaje. Por ello una activación posterior no
puede modificar ni reinterpretar una evaluación existente.

La cobertura es `criterios evaluados / criterios aplicables`, redondeada a
porcentaje. `not_applicable` queda fuera del denominador y se informa por
separado; `met` y `not_met` son los únicos resultados que integran el
numerador. La respuesta conserva total, aplicables, evaluados y no aplicables
para que el indicador pueda auditarse. Un estándar sin criterios no puede
publicarse y, como defensa frente a datos heredados o escrituras inválidas, una
evaluación sin criterios aplicables informa `0 %`, nunca `100 %`; por tanto no
puede formalizar una decisión.

La calidad ponderada es independiente: suma el peso de criterios `met` y lo
divide por el peso de criterios aplicables ya evaluados (`met` o `not_met`).
Se conserva junto a la evaluación y la decisión, pero no sustituye cobertura
ni determina el resultado (`approved`, `rejected`, `returned` o `cancelled`).
La madurez requiere una escala y un modelo propios; Aether no la infiere de la
calidad para evitar presentar una conclusión inexistente.

Una publicación concurrente de la misma organización, nombre y versión queda
protegida por unicidad en PostgreSQL: sólo una versión puede persistir. Adoptar
y activar una versión posterior cambia la referencia para revisiones futuras,
pero las evaluaciones y decisiones existentes conservan su estándar, criterios
y métricas originales.

Cada adopción queda registrada de forma durable con la versión adoptada, actor
y momento. La activación de la referencia y el registro se confirman en la
misma transacción, por lo que no existe una versión activa sin su adopción
correspondiente.

Una vez aplicado, PostgreSQL bloquea cambios en la identidad, versión,
criterios y metadatos de publicación del estándar. El estado de activación se
mantiene independiente para permitir seleccionar una nueva referencia sin
alterar versiones que ya sustentan evaluaciones.

En decisiones concurrentes, una versión esperada desactualizada se informa
como conflicto antes de validar el estado de revisión. Así el cliente puede
recargar de forma determinista la decisión que ya avanzó la iniciativa.

## Revisión

Un `owner` asigna primero la revisión de una iniciativa `presented` a un
`owner` o `admin` de la organización. Sólo esa asignación activa puede publicar
la evaluación. El revisor puede abstenerse con motivo; un `owner` conserva el
historial al reasignarla a otro revisor o al escalar la abstención. PostgreSQL
mantiene una sola asignación activa por iniciativa y comprueba que conserva el
alcance de la iniciativa.

El revisor asignado puede declarar un conflicto de interés con fundamento. La
declaración conserva la asignación, actor, alcance y fecha y no puede editarse.
Mientras permanezca abierta, bloquea tanto la publicación directa como la de
un borrador. Sólo un `owner` puede resolverla, siempre con un fundamento
separado que queda auditado; la resolución no borra la declaración original.

El revisor asignado registra cada resultado como valoración (`met`, `not_met` o
`not_applicable`) y evidencia. Declarar `not_applicable` exige una evidencia no
vacía que justifique la exclusión del denominador. La revisión crea una
evaluación inmutable y mueve la iniciativa a `under_review`.

Antes de publicar, el revisor puede guardar un borrador versionado con
respuestas incompletas. Cada guardado conserva la versión de la iniciativa y
del estándar, exige `expectedDraftVersion` y se audita. Publicar sólo acepta un
borrador de cobertura 100 % y lo consume en la misma transacción que crea la
evaluación. Si la organización adopta otro estándar, el borrador no se migra
automáticamente: el revisor debe enviar un mapeo completo de criterios previos
a criterios nuevos, declarar los descartes y explicar el motivo. El mapeo,
los descartes y el motivo quedan en auditoría; después de migrar, la versión
anterior ya no puede publicarse.

La revisión confirma el cambio de estado y versión, la evaluación inmutable,
el cierre de la asignación del revisor, la auditoría y el evento durable
`initiative.evaluated.v1` en una sola transacción PostgreSQL. La decisión
confirma estado, resolución, condiciones, auditoría y
`initiative.decided.v2` del mismo modo. Si cualquier escritura falla, todo el
comando se revierte; el conflicto de versión deja la iniciativa disponible
para recarga y reintento con datos vigentes.

Un `owner` puede anular una evaluación no decidida con un motivo. La anulación
no borra respuestas, cobertura ni calidad: conserva el registro y añade actor,
fecha y motivo. Una evaluación que ya sustenta una decisión no puede anularse,
y una evaluación anulada no puede sustentar una decisión. La aplicación y la
base de datos preservan ambas direcciones de esa invariante, incluso ante
escrituras que eludan el servicio.

## Decisión

Solo un `owner` puede decidir sobre una iniciativa `under_review`, indicando
la evaluación, fundamento y evidencia. La cobertura debe ser 100 %. La decisión
almacena quién decidió, fecha, resultado, evaluación, estándar y versión
aplicados. Sus resultados posibles son `approved`, `rejected`, `returned` y
`cancelled`; `approved`, `rejected` y `cancelled` son terminales, mientras que
`returned` habilita una corrección y nueva presentación. Una devolución
conserva las observaciones en el fundamento y exige `nextReviewOn`; esa fecha
no puede adjuntarse a ningún otro outcome y PostgreSQL aplica la misma regla.
Toda decisión, incluido un rechazo, exige un fundamento no vacío tanto en el
contrato HTTP como en el dominio; por tanto no puede omitirse mediante un caso
de uso interno. El solicitante recibe el mismo aviso neutral de decisión sin
exponer outcome, fundamento ni evidencia.

La decisión institucional de este alcance no usa comité, quórum ni delegación:
hay un único `owner` responsable y la reasignación sólo corresponde a la
revisión previa. Si se incorpora gobierno colegiado, deberá abrirse un agregado
de comité con miembros, quórum, votos y delegaciones explícitas; no se infiere
de roles organizacionales existentes.

Cuando hay notificaciones configuradas, el solicitante distinto del decisor
recibe un aviso neutral asociado a la iniciativa. El aviso no incluye outcome,
fundamento ni evidencia; el buzón revalida la pertenencia organizacional y de
workspace antes de hacerlo visible.

PostgreSQL revalida que la decisión conserve la misma organización, workspace,
iniciativa, estándar y versión de estándar de la evaluación referenciada. Así,
una escritura directa no puede reinterpretar retrospectivamente qué expediente
ni qué estándar sustentaron la decisión.

La migración `0004_evaluations_and_decisions.sql` persiste estándares,
evaluaciones y decisiones. Los eventos de auditoría conservan los identificadores
de evaluación y decisión, la cobertura y el conteo de evidencias.

## Condiciones de decisión

Una decisión `approved` puede incluir condiciones estructuradas: descripción,
responsable organizacional activo al registrarla y fecha de vencimiento. Nacen
en estado `pending` y bloquean la conversión a proyecto hasta que estén
resueltas o exentas. La migración
`0036_decision_conditions.sql` las persiste separadas de la decisión para
conservar su historial.

El responsable activo puede cumplir sólo su propia condición; un `owner` puede
cumplirla en su lugar y un `admin` no puede modificarla. El cumplimiento exige
nota y autenticación reciente, registra actor y fecha, y emite
`initiative.decision_condition_fulfilled.v1`. Un `owner` puede eximir una
condición pendiente con motivo y autenticación reciente; la exención emite
`initiative.decision_condition_exempted.v1`. La decisión de gobierno está
registrada en [ADR-0009](../adr/0009-condiciones-de-decision.md).
