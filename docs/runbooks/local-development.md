# Desarrollo local

1. Instalar Node.js 24 LTS y pnpm 11.24.
2. Ejecutar `docker compose up -d` para PostgreSQL y Redis.
3. Copiar los archivos `.env.example` de cada aplicación cuando existan.
4. Ejecutar `pnpm install` y luego `pnpm dev`.

Los datos locales deben ser ficticios y recreables. No se usan credenciales ni copias de producción.
