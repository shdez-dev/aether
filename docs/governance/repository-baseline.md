# Estado y alcance del repositorio

- Fecha de revisión: 2026-09-07
- Estado local: esqueleto greenfield inicial, aún sin inicialización Git
- Remoto declarado: `https://github.com/shdez-dev/aether.git`
- Verificación remota: pendiente; el remoto no fue accesible desde el entorno de revisión

## Conclusión local

El contenido local corresponde al alcance aprobado de arquitectura inicial:

- monorepo pnpm con aplicaciones `web`, `server` y `worker`;
- paquetes con límites explícitos para dominio, aplicación, contratos, datos, acceso, observabilidad, UI y pruebas;
- PostgreSQL y Redis únicamente para desarrollo local;
- ADR iniciales y documentación de operación local;
- sin código legado, migraciones de negocio, endpoints ni interfaces de producto todavía.

No corresponde afirmar todavía que el repositorio remoto tenga el mismo contenido. Antes de integrar o publicar se debe comparar `main` con este baseline mediante una revisión de ramas, archivos versionados, configuración CI y protección de rama.

## Criterio de aceptación de la sincronización

1. El remoto tiene una rama protegida `main` y el historial local parte de ella o de una rama inicial acordada.
2. No existen secretos, artefactos generados ni datos reales versionados.
3. El árbol contiene únicamente el esqueleto descrito o cambios revisados que lo extiendan.
4. La integración continua ejecuta instalación reproducible, formato, tipos, pruebas y build.
5. Las decisiones de arquitectura y variables de entorno están presentes en `docs/governance`.
