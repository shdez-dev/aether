# Estado y alcance del repositorio

- Fecha de revisión: 2026-09-14
- Estado local: reconstrucción greenfield en curso, versionada en `main`
- Remoto declarado: `https://github.com/shdez-dev/aether.git`
- Verificación remota: `origin/main` sincronizado y CI configurada

## Conclusión local

El contenido local corresponde al alcance aprobado de reconstrucción:

- monorepo pnpm con aplicaciones `web`, `server` y `worker`;
- paquetes con límites explícitos para dominio, aplicación, contratos, datos, acceso, observabilidad, UI y pruebas;
- PostgreSQL y Redis únicamente para desarrollo local;
- ADR iniciales y documentación de operación local;
- casos de uso, migraciones, API, auditoría, métricas y outbox para el flujo
  institucional principal;
- evidencia documental parcialmente suspendida (F5), pendiente de cierre
  operativo antes de declararla lista para producción.

El remoto se sincroniza desde `main`. Antes de publicar un release se revisan
historial, archivos versionados, CI y protección de rama contra este baseline.

## Criterio de aceptación de la sincronización

1. El remoto tiene una rama protegida `main` y el historial local parte de ella o de una rama inicial acordada.
2. No existen secretos, artefactos generados ni datos reales versionados.
3. El árbol contiene únicamente el esqueleto descrito o cambios revisados que lo extiendan.
4. La integración continua ejecuta instalación reproducible, formato, tipos, pruebas y build.
5. Las decisiones de arquitectura y variables de entorno están presentes en `docs/governance`.
