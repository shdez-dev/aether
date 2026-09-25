# Despliegue AETHER en Raspberry Pi

El despliegue usa Docker Compose en Debian ARM64. PostgreSQL, Keycloak, Garage y ClamAV quedan en la red privada de Compose; únicamente el gateway publica AETHER en el puerto 8081 de la interfaz LAN. Garage expone el API compatible con S3 para documentos, con un volumen persistente y credenciales privadas. Para exponerlo por ngrok, el gateway se cambia a localhost y el agente conecta por loopback, sin abrir puertos en el router. Keycloak se importa con valores de correo, cliente OIDC y URLs generados para el origen elegido.

## Arquitectura de ejecución

- `web`: Next.js en producción.
- `api`: Fastify con sesiones OIDC y PostgreSQL.
- `worker`: trabajos de outbox y análisis de documentos con ClamAV.
- `postgres`: datos de AETHER y base de Keycloak en bases separadas.
- `keycloak`: identidad persistente, realm AETHER y plantillas de correo.
- `garage`: almacenamiento compatible con S3; en la Raspberry de un solo nodo no existe redundancia física, así que los documentos importantes requieren copia externa.
- `gateway`: enrutamiento por rutas para web, API, callback OIDC e identidad.

## Secretos y URLs

`/srv/aether/secrets/compose.env` y `brevo.env` se crean fuera del repositorio con permisos restrictivos. No se copia ninguna credencial al árbol Git. `brevo.env` debe tener `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY` y `AETHER_SMTP_FROM`. `render-realm.mjs` genera el import privado de Keycloak con la contraseña SMTP, elimina el usuario de desarrollo y establece el redirect URI en el origen público.

`AETHER_PUBLIC_URL` debe ser el origen que recibirán navegador, Keycloak y el API, sin barra final. Al preparar la Raspberry en LAN será `http://<IP-LAN>:8081`; para acceso público, usa `infra/deploy/set-public-url.sh https://<dominio-asignado-por-ngrok>`, que activa cookies seguras y limita el gateway a localhost. El gateway no publica el panel de administración de Keycloak. No abras puertos del router.

## Actualizaciones

`aether-deploy.timer` consulta `origin/main` cada minuto y despliega solo avances fast-forward. Cada despliegue construye imágenes ARM64, ejecuta migraciones antes de actualizar procesos y comprueba la respuesta web. GitHub Actions no ejecuta código remoto en la Raspberry; el repositorio es público y los runners self-hosted no son adecuados para recibir código de PRs no confiables.

El servicio usa volúmenes Docker persistentes. Antes de operar con datos importantes, configura copias de seguridad externas de `/var/lib/docker/volumes` y prueba su restauración. Las imágenes se actualizan por commits del repositorio; la actualización del sistema Debian/Docker se mantiene por separado.
