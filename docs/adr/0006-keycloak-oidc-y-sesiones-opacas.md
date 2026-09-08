# ADR 0006: Keycloak OIDC y sesiones opacas de servidor

- Estado: aceptado
- Fecha: 2026-09-08

## Contexto

Aether necesita identidad federable, control institucional sobre el proveedor y una sesión web que no exponga credenciales al navegador.

## Decisión

Se utiliza Keycloak mediante OpenID Connect Authorization Code con PKCE S256. El backend canjea el código y crea sesiones opacas almacenadas en PostgreSQL. Los identificadores de sesión se guardan hasheados; las transacciones de autorización contienen `state`, nonce y verificador PKCE cifrados y son de un solo uso.

Las cookies de sesión y transacción son `HttpOnly`, `SameSite=Lax` y `Secure` fuera de desarrollo. Las mutaciones usan Origin y doble envío de CSRF. No se persisten tokens OIDC en `localStorage`.

## Consecuencias

La aplicación conserva independencia de proveedor gracias a OIDC y puede invalidar sesiones sin esperar a que expire un token. A cambio, requiere PostgreSQL disponible para cada solicitud autenticada, una estrategia de limpieza de sesiones vencidas y operación segura de Keycloak.
