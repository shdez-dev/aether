# Desarrollo local

1. Instalar Node.js 24 LTS y pnpm 11.24.
2. Ejecutar `pnpm local:up` para PostgreSQL, Redis, Keycloak y MinIO. MinIO crea el bucket `aether-local` automáticamente.
3. Copiar `apps/server/.env.example` a `apps/server/.env` y `apps/worker/.env.example` a `apps/worker/.env`.
4. Ejecutar `pnpm install`.
5. Con `DATABASE_URL` cargada desde `apps/server/.env`, ejecutar `pnpm db:migrate`.
6. Ejecutar `pnpm --filter @aether/server dev`, `pnpm --filter @aether/worker dev` y `pnpm --filter @aether/web dev --hostname 127.0.0.1` en tres terminales.

Servicios locales: API `http://127.0.0.1:4000`, web `http://127.0.0.1:3000`, PostgreSQL `localhost:5433`, Keycloak `http://127.0.0.1:8080`, MinIO API `http://127.0.0.1:9000` y consola MinIO `http://127.0.0.1:9001`. El uso consistente de `127.0.0.1` evita perder las cookies de sesión OIDC por alternar con `localhost`. Keycloak usa el usuario administrador `admin` y la contraseña de desarrollo declarada en `infra/compose.yaml`; el usuario de prueba es `aether-admin` y debe cambiar su contraseña temporal en el primer inicio.

Los datos locales deben ser ficticios y recreables. No se usan credenciales ni copias de producción.

## Comprobaciones operativas

- `GET http://127.0.0.1:4000/health` confirma que el proceso de la API está vivo.
- `GET http://127.0.0.1:4000/ready` confirma además que PostgreSQL acepta una consulta. Un `503` significa que la API no debe recibir tráfico.
- `GET http://127.0.0.1:4000/metrics` entrega contadores HTTP y del outbox; el worker incorpora profundidad pendiente/en proceso/dead-letter y antigüedad del pendiente más viejo. En producción exige `Authorization: Bearer $METRICS_TOKEN`; en desarrollo local se configura el token en `apps/server/.env` de igual forma.
- `OTEL_EXPORTER_OTLP_ENDPOINT` es opcional y debe apuntar al endpoint de trazas (por ejemplo, `http://127.0.0.1:4318/v1/traces`). Si se define en server y worker, envía trazas OTLP que conectan solicitud, `correlationId`, evento outbox y su procesamiento. No se exportan cuerpos, cookies, tokens ni correos.
- `pnpm verify` ejecuta formato, tipos, pruebas unitarias, integración PostgreSQL efímera y build. La misma puerta se ejecuta en GitHub Actions.
- Las pruebas PostgreSQL requieren Docker. Si no hay runtime activo, se omiten localmente de forma explícita; CI define `REQUIRE_CONTAINER_RUNTIME=1` y las exige. Iniciar Docker Desktop antes de validar integración local.

## Respaldo y restauración local de PostgreSQL

Los siguientes pasos son exclusivamente para datos locales recreables. Ejecutar desde la raíz del repositorio:

```powershell
New-Item -ItemType Directory -Force backups
docker compose -f infra/compose.yaml exec -T postgres pg_dump -U aether -d aether -Fc > backups/aether-local.dump
```

Antes de restaurar, detener API y worker. La restauración reemplaza los datos de la base local:

```powershell
Get-Content backups/aether-local.dump -AsByteStream | docker compose -f infra/compose.yaml exec -T postgres pg_restore -U aether -d aether --clean --if-exists
pnpm db:migrate
Invoke-WebRequest http://127.0.0.1:4000/ready
```

Después de recuperar, comprobar que las migraciones están aplicadas y recorrer una iniciativa de prueba. La estrategia de backup automático, PITR y ejercicios de recuperación de entornos no locales sigue pendiente antes de producción.
