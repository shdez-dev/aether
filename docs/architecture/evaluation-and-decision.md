# Evaluación y decisión institucional

## Estándar y cobertura

Un estándar publicado contiene criterios con código, descripción y peso. El
`owner` puede activar uno como referencia organizacional, pero la evaluación
recibe siempre `standardId` de forma explícita. Al revisar, Aether guarda el
identificador, versión y snapshot de cada criterio junto a la cobertura:
criterios totales, evaluados y porcentaje. Por ello una activación posterior no
puede modificar ni reinterpretar una evaluación existente.

## Revisión

Un `owner` o `admin` organizacional revisa una iniciativa `presented`. Cada
resultado registra un criterio, valoración (`met`, `not_met` o
`not_applicable`) y evidencia. La revisión crea una evaluación inmutable y
mueve la iniciativa a `under_review`.

## Decisión

Solo un `owner` puede decidir sobre una iniciativa `under_review`, indicando
la evaluación, fundamento y evidencia. La cobertura debe ser 100 %. La decisión
almacena quién decidió, fecha, resultado, evaluación, estándar y versión
aplicados. Sus resultados posibles son `approved`, `rejected`, `returned` y
`cancelled`; `approved`, `rejected` y `cancelled` son terminales, mientras que
`returned` habilita una corrección y nueva presentación.

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

En esta rebanada un `owner` puede eximir una condición pendiente con motivo y
autenticación reciente. La exención registra actor, fecha y motivo, y emite el
evento de auditoría `initiative.decision_condition_exempted.v1`. El comando de
cumplimiento queda deliberadamente fuera de esta API inicial; la decisión de
gobierno está registrada en [ADR-0009](../adr/0009-condiciones-de-decision.md).
