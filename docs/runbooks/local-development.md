# Desarrollo local

1. Instalar Node.js 24 LTS y pnpm 11.24.
2. Ejecutar `docker compose up -d` para PostgreSQL, Redis y Keycloak.
3. Copiar los archivos `.env.example` de cada aplicación cuando existan.
4. Ejecutar `pnpm install`.
5. Con `DATABASE_URL` cargada desde `apps/server/.env`, ejecutar `pnpm db:migrate`.
6. Ejecutar `pnpm dev`.

Los datos locales deben ser ficticios y recreables. No se usan credenciales ni copias de producción.
