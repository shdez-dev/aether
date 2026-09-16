# Acceso JIT de soporte

Este procedimiento permite diagnosticar una organización sin crear un
superadministrador permanente ni leer contenido institucional.

## Precondiciones

- Existe un incidente o solicitud con responsable, motivo y `correlationId`.
- La identidad OIDC del operador aparece en `SUPPORT_OPERATOR_ACTOR_IDS`.
- Un owner vigente de la organización está disponible para revisar la
  solicitud.
- Soporte no solicita contraseñas, cookies, tokens ni copias de producción.

## Procedimiento

1. El operador solicita un grant mediante `POST /v1/admin/support-access-grants`
   para su propia identidad, la organización afectada y una duración mínima
   suficiente, nunca superior a 60 minutos.
2. Un owner distinto revisa motivo y vencimiento y aprueba mediante
   `POST /v1/admin/support-access-grants/{grantId}/approve`.
3. El operador consulta únicamente
   `GET /v1/admin/support/organizations/{organizationId}/diagnostics`. Cada
   consulta queda auditada con actor, grant, instante y correlación.
4. Al terminar, el operador o el owner revoca el grant mediante
   `POST /v1/admin/support-access-grants/{grantId}/revoke`; no se espera al
   vencimiento si el diagnóstico ya concluyó.
5. El incidente registra hallazgos técnicos sin copiar nombres, correos,
   documentos ni contenido de negocio.

## Campos permitidos

El diagnóstico contiene sólo conteos de workspaces por estado, membresías por
estado, mensajes de outbox pendientes, dead letters y presencia de política.
Una necesidad de datos adicional requiere una decisión de seguridad y contrato
explícito; no se resuelve con consultas directas improvisadas.

## Contención

Ante uso inesperado, se elimina inmediatamente la identidad de
`SUPPORT_OPERATOR_ACTOR_IDS`, se reinicia la configuración del servidor y un
owner revoca el grant. La elegibilidad se revalida en cada consulta, por lo que
retirarla bloquea el acceso aunque el vencimiento todavía no se haya alcanzado.
Los eventos append-only se preservan para revisión; nunca se modifican para
ocultar un incidente.
