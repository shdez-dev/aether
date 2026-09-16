# ADR-0008: límites de transferencia, retención y acceso excepcional

## Estado

Aceptada.

## Decisión

- Keycloak es la autoridad para recuperación de cuenta, cambio de correo y vinculación de identidades. Aether no almacena credenciales, códigos de recuperación ni tokens de esos flujos.
- Cada organización define residencia y retención explícitas; los workspaces las heredan hasta que una futura política autorizada permita una excepción visible.
- No se permiten transferencias entre organizaciones en el MVP. Un traslado entre organizaciones se trata como exportación/importación aprobada, con procedencia, reclasificación y permisos nuevos.
- Un workspace no se transfiere. Un equipo se recrea en el workspace destino y un documento se reubica sólo mediante un comando posterior que compruebe clasificación, relaciones y permisos.
- Las concesiones temporales se limitan a una acción y recurso concretos, requieren motivo, aprobación de un owner distinto del solicitante, vencen en ocho horas como máximo y pueden revocarse.
- El acceso JIT de soporte no crea un superadministrador permanente: sólo diagnóstico mínimo, máximo una hora, aprobación de owner y auditoría de concesión y uso. El acceso a contenido restringido queda fuera del MVP.

## Consecuencias

Las rutas, workers y descargas deben revalidar membresía, revocación, concesión vigente y alcance. Las migraciones y contratos futuros no expondrán una mutación genérica de `organizationId` o `workspaceId`.
