# Infraestructura

`compose.yaml` proporciona el entorno local reproducible: PostgreSQL, Redis, Keycloak y MinIO (S3 compatible). Inícialo con `pnpm local:up`; no se agregan recursos cloud hasta seleccionar proveedor, región, residencia de datos y estrategia de recuperación.

## Pantalla de identidad AETHER

`keycloak/themes/aether/login` contiene el tema de acceso de Keycloak. Extiende `keycloak.v2` y sólo reemplaza estilos, recursos visuales, textos y el pie; los formularios, acciones y validaciones de identidad siguen siendo los de Keycloak. El realm local nuevo selecciona `loginTheme: "aether"`, idioma español, autorregistro con correo como usuario y verificación obligatoria de correo. La entrada al registro desde la web conserva una transacción OIDC; dentro de Keycloak se muestra su enlace nativo de registro.

`keycloak/themes/aether/email` contiene los correos HTML y de texto plano de verificación y recuperación, además de sus asuntos en español. Extiende el tema de correo de Keycloak para conservar los demás tipos de mensaje. El realm usa `emailTheme: "aether"`; `pnpm local:email:brevo` también aplica ese ajuste a una instancia local ya creada. Las plantillas no dependen de imágenes externas y mantienen el enlace de seguridad generado por Keycloak.

El realm local comienza enviando verificaciones a Mailpit (`localhost:8025`). Para recibirlas en buzones reales sin desplegar AETHER, se puede conectar el Keycloak local directamente con Brevo:

1. Da de alta y verifica el remitente en Brevo. Para pruebas se propone `aether.notifications@gmail.com`; como `gmail.com` no es un dominio propio, no se puede autenticar y Brevo puede reemplazar la dirección visible. Para una entrega fiable, usa después un dominio de AETHER autenticado en Brevo.
2. En **Brevo → Configuración → SMTP y API → SMTP**, copia el **login SMTP** y genera una **clave SMTP**. La clave API no sirve como contraseña SMTP.
3. Copia `infra/.env.brevo.example` a `infra/.env.brevo` y rellena `BREVO_SMTP_LOGIN` y `BREVO_SMTP_KEY`. Este archivo está ignorado por Git; no pegues las claves en el chat ni las agregues al repositorio.
4. Con `pnpm local:up` ya iniciado, ejecuta `pnpm local:email:brevo`. El comando actualiza el realm existente sin recrear el contenedor ni perder las cuentas locales. Configura `smtp-relay.brevo.com:587` con STARTTLS, activa el tema de correo y comprueba que Keycloak guardó los ajustes no secretos.
5. Prueba un registro con un correo tuyo y confirma la llegada del mensaje. Si no llega, revisa en Brevo el estado del remitente, la activación SMTP y los registros de envío. La configuración no garantiza la entrega hasta completar esta prueba.

La capa gratuita de Brevo tiene un límite de 300 envíos diarios; es un límite de cuenta, no de AETHER. Si se recrea el contenedor local de Keycloak, vuelve a ejecutar `pnpm local:email:brevo` una vez importado el realm. No se almacena la clave SMTP en el JSON importable. Mailpit queda disponible como alternativa local hasta activar Brevo. Antes de habilitar el registro en otro entorno, configura SMTP real, dominio remitente y la URL pública de Keycloak. El registro de identidad no concede acceso a datos de organizaciones: después de verificar el correo, cada persona crea una organización o acepta una invitación dirigida a su correo. La política inicial de organizaciones creadas desde la interfaz usa `dataResidencyRegion: "local"` y 365 días de retención; debe sustituirse por una política de residencia real antes de operar fuera del entorno local.

La importación de realms omite los que ya existen. En una instancia existente, selecciona `aether` en *Realm settings → Themes → Login theme*, activa *User registration*, *Verify email* y *Forgot password*, y configura SMTP. Coloca el tema en `/opt/keycloak/themes/aether` antes de activarlo. No recrees el contenedor local sólo para actualizar el tema: su almacenamiento H2 actual no tiene un volumen persistente y la recreación podría perder cuentas de desarrollo. El tema montado por Compose se aplica a instalaciones nuevas; los cambios de archivos en un contenedor existente pueden copiarse sin recrearlo.
