# Política de variables de entorno y secretos

## Principios

La configuración no secreta es versionable; los secretos no. Toda variable declara propietario, propósito, entornos, formato, rotación y consumidor. El servidor valida configuración al arrancar y falla de forma segura ante faltantes o valores incompatibles.

## Ubicación por entorno

| Entorno                    | Configuración no secreta                                  | Secretos                                                                  |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Local                      | `apps/*/.env.example` versionado y `apps/*/.env` ignorado | Gestor local o archivo ignorado, con valores ficticios cuando sea posible |
| Preview e integración      | Configuración declarada por entorno                       | Secretos del entorno en el proveedor CI/CD                                |
| Preproducción y producción | Infraestructura declarativa y variables referenciadas     | Gestor de secretos, identidad de workload y auditoría de acceso           |

No se copian secretos ni datos productivos a entornos inferiores. Cada entorno utiliza cuentas, claves y bases de datos diferentes.

## Convenciones

- `NEXT_PUBLIC_*` se reserva solo para valores seguros que el navegador puede conocer, como una URL pública.
- Las credenciales, claves de firma, tokens de proveedor, URI de base de datos privada y claves de cifrado se consumen únicamente en `server` o `worker`.
- Se prefieren nombres explícitos: `DATABASE_URL`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_ENCRYPTION_KEY`, `S3_BUCKET`.
- Toda clave tiene entorno y prefijo de proveedor cuando sea necesario; nunca se reutiliza una credencial entre entornos.
- Los logs, errores, trazas, fixtures y tickets no contienen valores secretos ni encabezados de autenticación.

## Gestión y rotación

Los secretos se inyectan en runtime desde un gestor administrado; no se incorporan en imágenes, builds ni bundles web. El acceso se concede por identidad de workload y mínimo privilegio. Se rota inmediatamente ante exposición, cambio de personal o incidente, y de forma periódica según criticidad. La rotación debe tener prueba, responsable, ventana y plan de reversión.

## Controles obligatorios

1. `.env` y variantes reales están ignorados; los `.env.example` no contienen valores reales.
2. Pre-commit y CI escanean secretos. Un hallazgo bloquea integración hasta revocarlo y sanear historial si corresponde.
3. CI usa secretos con alcance mínimo, enmascaramiento y preferentemente credenciales efímeras u OIDC.
4. Acciones de alto impacto registran correlation ID, nunca credenciales.
5. Un secreto expuesto se considera comprometido aunque se elimine del archivo: se revoca, rota y documenta el incidente.

## Cambios de configuración

Agregar una variable exige actualizar su ejemplo, validador, documentación, entorno de despliegue y pruebas de arranque. Retirarla exige eliminar consumidores, observar su desuso y revocarla después de la ventana de compatibilidad.
