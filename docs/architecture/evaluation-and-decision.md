# Evaluación y decisión institucional

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
