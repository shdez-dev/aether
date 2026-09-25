# 0017: Home pública y configuración compartida

La home se renderiza desde `apps/web/src/app/page.tsx`; la aplicación autenticada reside en `/workspace`. Los handlers OIDC y BFF conservan sus rutas y validaciones. La redirección OIDC existente vuelve a `/`; desde allí «Ingresar» abre el workspace.

Se permite la arista `@aether/web -> @aether/config` para identidad pública del producto y destinatario de demos. `@aether/config` permanece libre de dependencias, secretos y acceso a variables de entorno. `apps/web/src/env.ts` valida la configuración del sitio mediante esquemas de `@aether/contracts`.

La home es una presentación comercial del producto: explica beneficios y formas de uso sin publicar documentos internos, matrices de autorización ni objetivos técnicos como resultados. El SRS se conserva únicamente como documentación interna. La API sigue siendo la autoridad sobre capacidades. La demo abre un borrador de correo y no afirma haber enviado ni almacenado información.
