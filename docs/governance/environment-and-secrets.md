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

## Catálogo de variables

Los responsables son roles operativos; el valor de los archivos `.example` es
ficticio y sirve únicamente para desarrollo local.

| Variable | Tipo y valor seguro | Secreto | Propietario |
| --- | --- | --- | --- |
| `NODE_ENV` | `development`, `test` o `production`; `development` | No | Plataforma |
| `PORT` | entero 1–65535; `4000` | No | Plataforma |
| `DATABASE_URL` | URL PostgreSQL del entorno | Sí | Datos |
| `SERVER_PUBLIC_URL`, `WEB_ORIGIN` | URLs HTTPS públicas en producción | No | Plataforma |
| `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID` | URL y ID registrados por entorno | No | Seguridad |
| `OIDC_CLIENT_SECRET` | credencial del cliente OIDC | Sí | Seguridad |
| `OIDC_REDIRECT_URI` | URL bajo `SERVER_PUBLIC_URL` | No | Seguridad |
| `SESSION_ENCRYPTION_KEY` | clave aleatoria base64 de 32 bytes | Sí | Seguridad |
| `SESSION_TTL_SECONDS` | entero 300–86400; `28800` | No | Seguridad |
| `SESSION_RENEWAL_WINDOW_SECONDS` | entero 60–43200; `1800` | No | Seguridad |
| `MAX_REQUEST_BODY_BYTES` | entero 1024–10485760; `1048576` | No | Backend |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` | enteros positivos; `120` y `60` | No | Seguridad |
| `LOG_LEVEL` | `fatal` a `debug`; `info` | No | Plataforma |
| `METRICS_TOKEN` | token aleatorio de al menos 32 caracteres | Sí | Observabilidad |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL del colector; vacío desactiva exportación local | No | Observabilidad |
| `S3_ENDPOINT`, `S3_BUCKET` | URL privada y bucket por entorno | No | Plataforma |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | credenciales de mínimo privilegio | Sí | Plataforma |
| `S3_PRESIGN_TTL_SECONDS` | entero 60–900; `300` | No | Seguridad |
| `MAX_DOCUMENT_BYTES` | entero 1024–26214400; `10485760` | No | Backend |
| `WORKER_ID`, `OUTBOX_POLL_INTERVAL_MS` | identificador y entero ms; `1000` | No | Plataforma |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` | host, puerto y ms; `127.0.0.1`, `3310`, `30000` | No | Plataforma |

## Gestión y rotación

Los secretos se inyectan en runtime desde un gestor administrado; no se incorporan en imágenes, builds ni bundles web. El acceso se concede por identidad de workload y mínimo privilegio. Se rota inmediatamente ante exposición, cambio de personal o incidente, y de forma periódica según criticidad. La rotación debe tener prueba, responsable, ventana y plan de reversión.

## Controles obligatorios

1. `.env` y variantes reales están ignorados; los `.env.example` no contienen valores reales.
2. Pre-commit y CI escanean secretos con Gitleaks 8.24.3. El hook ejecuta `pnpm secrets:scan` sobre cambios preparados y usa el binario local o la imagen oficial `ghcr.io/gitleaks/gitleaks:v8.24.3`; CI usa la misma imagen para evitar dependencias de runtime de acciones. Un hallazgo bloquea integración hasta revocarlo y sanear historial si corresponde.
3. CI usa secretos con alcance mínimo, enmascaramiento y preferentemente credenciales efímeras u OIDC.
4. Acciones de alto impacto registran correlation ID, nunca credenciales.
5. Un secreto expuesto se considera comprometido aunque se elimine del archivo: se revoca, rota y documenta el incidente.

## Cambios de configuración

Agregar una variable exige actualizar este catálogo, su ejemplo, validador,
entorno de despliegue y pruebas de arranque. Retirarla exige eliminar
consumidores, observar su desuso y revocarla después de la ventana de
compatibilidad.
