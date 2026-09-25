# Web

Aplicación Next.js responsable de los recorridos de usuario. Consume contratos del servidor y muestra capacidades calculadas por este. No contiene autorización ni reglas de dominio independientes.

## Home pública

`/` presenta el ciclo de seis fases. `/workspace` contiene la aplicación autenticada; `/seguridad` explica los controles presentes y las responsabilidades del despliegue. «Ingresar» abre `/auth/login`, una página de acceso que inicia el OIDC existente desde `/auth/continuar`. El callback del servidor vuelve a `/workspace`; la API conserva `GET /auth/login` y los handlers BFF no cambian.

```text
src/
  app/                  Rutas, metadata, robots, sitemap y endpoints
  components/
    auth/               Marco visual y solicitud de acceso
    home/               Secciones públicas e interacciones específicas
    layout/             Header, Footer y Brand
    workspace/          Aplicación autenticada y sus estilos acotados
  lib/
    constants/          Fases, públicos, beneficios y recorrido ilustrativo
    hooks/              Preferencia de movimiento compatible con SSR
    utils/tracking.ts   Eventos locales tipados, sin datos personales
  styles/               Tailwind v4, composición y fuente Inter local
  env.ts                Configuración pública validada con Zod
```

Los tokens se exportan desde `@aether/ui/tokens.css`. `@aether/ui` conserva sus componentes existentes y añade `ActionButton`, `Dialog` y utilidades, basados en la composición shadcn/ui y primitivas Radix. No se modifica el contrato del botón del workspace. Tailwind usa el plugin PostCSS v4 y fuentes explícitas del monorepo; se omite Preflight para preservar los controles existentes. La fuente Inter variable se sirve localmente con `next/font/local`, precarga y licencia OFL.

La home se prerenderiza; los componentes interactivos son islas cliente. Framer Motion carga sus capacidades con `LazyMotion`, y el diálogo de demo se divide en un chunk cargado al solicitarlo. Los datos y enlaces siguen disponibles sin JavaScript.

### Acceso y registro

`/auth/login` muestra una entrada clara al proveedor de identidad; la web no captura contraseñas. `/auth/continuar` redirige a `GET /auth/login` del servidor, que gestiona OIDC con PKCE, state y nonce. `/auth/registro` explica el alta personal y `/auth/crear-cuenta` inicia la misma transacción OIDC con `prompt=create` en `GET /auth/register`. Keycloak verifica el correo y administra las credenciales; el callback lleva a `/workspace`. Una cuenta sin organización ve el primer acceso para crear una organización o aceptar una invitación. Ambas páginas de acceso comparten `AuthFrame` y estilos acotados en `src/styles/auth.css`.

La pantalla posterior de usuario y contraseña pertenece a Keycloak y usa el tema `infra/keycloak/themes/aether/login`; la web no recibe esas credenciales.

### Espacio de trabajo diario

Tras iniciar sesión, `/workspace` presenta «Mi día» con un resumen del espacio activo, conteos derivados de iniciativas y proyectos reales, continuidad del trabajo y tareas visibles para la persona. No se inventan métricas ni actividad. El menú lateral separa iniciativas, proyectos y organización para evitar una página operativa interminable; los enlaces mantienen una ubicación en el hash y las acciones rápidas abren el flujo correspondiente. El primer acceso sin organización o sin espacio conserva el recorrido `FirstSteps`.

`components/workspace/workspace-screen.tsx` mantiene la orquestación de datos y las acciones existentes. `workspace-overview.tsx` contiene sólo la lectura y navegación del resumen, `workspace-navigation.tsx` el marco lateral y `workspace-dashboard.css` la composición responsive. `my-work.tsx` sigue consultando la bandeja asignada por la API. Las capacidades de la API continúan decidiendo qué operaciones pueden ejecutarse. El movimiento del panel es discreto y se desactiva con `prefers-reduced-motion`.

### Movimiento discreto

`src/styles/motion.css` centraliza las microinteracciones y `src/lib/constants/motion.ts` los tiempos de React. Salvo el motivo central del hexágono, el movimiento responde a acciones y al desplazamiento; no hay rebotes. Las tarjetas aparecen una sola vez con 8 px de recorrido en 440 ms y un escalonado máximo de 160 ms. Suben 2 px únicamente con un puntero preciso; los botones responden con desplazamientos mínimos. Los títulos se mantienen estáticos y `Reveal` usa la entrada ligera `framer-motion/m`.

El hexágono destaca la conexión de la fase explorada y acompaña con un giro de 3 grados. Sus seis barras azules se contraen ligeramente hacia el centro, regresan y completan un giro en un ciclo de 7.2 segundos, también en el indicador lateral. Al dejar el hero, el propio diagrama se desacopla visualmente de su panel, se desplaza y reduce de manera continua hasta la posición del indicador lateral. Al terminar el trayecto, ese indicador marca cuál de los seis apartados de la home está a la vista. Sus puntos son enlaces a esas secciones; se retira antes del contacto y no aparece en pantallas menores de 1024 px. El recorrido de ejemplo empieza detenido: reproducir es voluntario, cada paso dispone de 4.8 segundos y una selección manual lo pausa. No avanza fuera de su área visible; al ocultar la pestaña se pausa. Tooltips y diálogo usan transiciones cortas; Radix conserva el diálogo durante su salida antes de devolver el foco.

`prefers-reduced-motion` elimina los desplazamientos y las animaciones, incluso si la preferencia cambia durante la visita. El indicador lateral aparece directamente en su posición final, sin animación de giro, y conserva la navegación manual. El hero no espera una animación para mostrar su contenido.

El pie ya no incluye «Volver al inicio». Un botón fijo aparece abajo a la derecha después de avanzar por la página, devuelve el foco a la marca y sube suavemente; con movimiento reducido, el retorno es inmediato.

### Contenido verificable

La home presenta AETHER como producto: propuesta de valor, ciclo conectado, beneficios, tres públicos de uso y un recorrido ilustrativo. No expone matrices de permisos ni vocabulario de implementación. Las capacidades reales siguen siendo responsabilidad de la API.

No se inventan resultados cuantitativos, clientes, testimonios ni certificaciones. El ejemplo de mejora interna está identificado como ilustrativo. El SRS es documentación interna: no se publica ni se enlaza, y su antigua ruta pública devuelve 404. El original en `artifacts/` permanece intacto.

### Solicitudes de demo

El destinatario público `juanhernandezr0075@gmail.com` está en `@aether/config`. El diálogo valida nombre, correo, organización y mensaje con `demoRequestSchema` de `@aether/contracts`. «Preparar solicitud» genera un enlace `mailto:`; «Abrir correo y revisar» abre el cliente de correo. No hay envío de servidor, persistencia de contactos ni mensaje de éxito de entrega. No enviar los valores del formulario a analítica.

### Analítica y privacidad

`trackEvent` emite `CustomEvent("aether:analytics")` en la ventana para CTAs, fases, flujo y profundidad de scroll. Es un punto de integración sin cookies ni peticiones externas. Conectar un proveedor después de definir consentimiento y destino; no está habilitado Google Analytics ni se incluye un ID ficticio. Los eventos de demo sólo indican validación o apertura del borrador, no envío.

### Configuración y seguridad

Establecer `NEXT_PUBLIC_APP_URL` al origen HTTPS canónico antes del build de producción; se valida mediante Zod y alimenta metadata, Open Graph, sitemap y datos estructurados. En local usa `http://127.0.0.1:3000`. `AETHER_API_URL` sigue siendo configuración de servidor; no sustituir el BFF por una URL pública ni exponer secretos OIDC.

`next.config.ts` aplica CSP, `nosniff`, `DENY`, Referrer-Policy y Permissions-Policy. La CSP permite scripts inline para hidratación estática de Next y estilos inline para animaciones; `unsafe-eval` sólo existe en desarrollo. Una CSP estricta basada en nonce exigiría cambiar el modelo de renderizado. TLS, HSTS, compresión de borde y gestor de secretos pertenecen a la infraestructura de despliegue, no se declaran activos por esta home.

### Verificación reproducible

El lanzador de Lighthouse reutiliza el Chromium instalado por Playwright, con perfil aislado y cierre controlado. No necesita una instalación global de Chrome. Las primitivas públicas usan exports individuales de `@aether/ui` para que el diálogo se descargue sólo cuando se solicita.

Se utiliza `experimental.inlineCss` de Next para reducir solicitudes bloqueantes en la primera visita. Es global: prioriza esa primera carga frente a la caché independiente del CSS en visitas posteriores; revisar su soporte al actualizar Next.

Verificación local del refinamiento de movimiento (2026-09-24 UTC): build, TypeScript, formato y límites de arquitectura aprobados. La última muestra móvil obtuvo Performance 94, Accessibility 100, Best Practices 100, SEO 100, LCP 2.67 s y CLS 0. El control Lighthouse todavía falla por el umbral LCP de 2.5 s; no se ha relajado ese objetivo. Es una muestra de laboratorio, no una garantía de rendimiento en producción; CI conserva tres ejecuciones por dispositivo. La suite incluye 14 pruebas unitarias y 30 pruebas de navegador, con reproducción voluntaria, pausa, cambio de preferencia de movimiento, retorno flotante al inicio y cierre animado del diálogo.

```sh
pnpm --filter @aether/web dev
pnpm --filter @aether/web lint
pnpm --filter @aether/web typecheck
pnpm --filter @aether/web test
pnpm architecture:check
pnpm --filter @aether/web build
pnpm --filter @aether/web exec playwright install chromium firefox webkit
pnpm --filter @aether/web test:e2e --workers=2
pnpm --filter @aether/web lighthouse
pnpm --filter @aether/web lighthouse --config=lighthouserc.mobile.cjs
```

Playwright usa el build de producción en el puerto 3100 y cubre 390, 768 y 1440 px, ausencia de desbordamiento, contraste con axe, navegación por teclado, encabezado compacto, fases, movimiento reducido, formulario, SRS no publicado y contenido sin JavaScript. Incluye la regresión de presentación de iniciativas en `/workspace`. WebKit es una aproximación automatizada; no equivale a una ejecución manual de Safari en un dispositivo Apple.

El workflow `Home quality` ejecuta los tres motores y Lighthouse, conserva informes como artifacts y exige Performance ≥90, Accessibility ≥95, Best Practices ≥90, SEO ≥95, LCP ≤2.5 s y CLS ≤0.1. Son pruebas de laboratorio; INP y Core Web Vitals de campo requieren tráfico real. FID ya no se presenta como una medición actual. Los avisos previos de jsdom/canvas y del cargador Vite no certifican ni invalidan el contraste: éste se prueba en navegador real.
