# Autenticación y sesiones

## Decisión de proveedor

El proveedor OIDC es **Keycloak**. Se despliega bajo administración institucional; un realm representa cada entorno (`aether-local`, preview, staging y producción), y el servidor Aether es un cliente OIDC confidencial. Esta elección conserva portabilidad OIDC y evita que reglas institucionales dependan de un proveedor SaaS.

## Flujo de inicio de sesión

1. `GET /auth/login` crea una transacción de diez minutos con `state`, `nonce` y un verificador PKCE S256.
2. El navegador recibe únicamente el handle opaco `aether_oidc_tx`, en cookie `HttpOnly`, y es redirigido a Keycloak.
3. `GET /auth/callback` compara el handle y `state`, consume la transacción de forma atómica y canjea el código usando PKCE y `nonce`.
4. Tras validar el ID Token, crea una sesión opaca en PostgreSQL y retorna al navegador solo `aether_session` y `aether_csrf`.

Un callback duplicado, un `state` incorrecto o una transacción vencida no puede volver a canjear un código. Los verificadores PKCE y nonces se cifran con AES-256-GCM antes de persistirse.

## Sesión y cookies

`auth_sessions` conserva solamente el hash SHA-256 del identificador aleatorio de sesión, sujeto, emisor, caducidad, revocación y última actividad. La cookie nunca contiene JWT, access token ni refresh token.

| Cookie           | HttpOnly | SameSite | Secure           | Propósito                              |
| ---------------- | -------- | -------- | ---------------- | -------------------------------------- |
| `aether_session` | Sí       | Lax      | Sí en producción | Identificador opaco de sesión          |
| `aether_oidc_tx` | Sí       | Lax      | Sí en producción | Handle temporal de inicio OIDC         |
| `aether_csrf`    | No       | Lax      | Sí en producción | Token de doble envío, no autenticación |

La duración por defecto es ocho horas. Si faltan treinta minutos o menos, una solicitud autenticada renueva la expiración en el servidor y reemite la cookie. Cerrar sesión revoca la sesión de inmediato; la limpieza de filas vencidas es responsabilidad del worker operativo.

## CSRF, replay y almacenamiento del navegador

Las mutaciones autenticadas deben exigir un `Origin` igual a `WEB_ORIGIN` y el header `X-CSRF-Token` igual a la cookie `aether_csrf`, comparado en tiempo constante. El callback OIDC no usa este mecanismo porque está protegido por la transacción de un solo uso (`state` + handle + PKCE + nonce).

No se utiliza `localStorage`, `sessionStorage` ni cookies legibles para tokens OIDC. Los clientes web llaman a la API con cookies de sesión; los tokens de proveedor no se exponen al JavaScript del navegador.

## Entornos

`apps/server/.env.example` enumera las variables obligatorias. `OIDC_ISSUER_URL`, client ID, secreto, redirect URI y clave de cifrado cambian por entorno. La clave `SESSION_ENCRYPTION_KEY` debe ser única por entorno, codificar exactamente 32 bytes y rotarse con un plan que invalide de manera controlada las transacciones activas.

El perfil local se inicia con `docker compose up -d`, seguido de `pnpm db:migrate`, e importa el realm de `infra/keycloak/aether-local-realm.json`. Sus credenciales son de desarrollo y no pueden desplegarse fuera de local.
