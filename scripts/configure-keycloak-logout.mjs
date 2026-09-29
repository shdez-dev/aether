import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../infra/.env.brevo", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const baseUrl = new URL(
  process.env.AETHER_KEYCLOAK_URL ?? "http://127.0.0.1:8080",
);
if (!["localhost", "127.0.0.1"].includes(baseUrl.hostname))
  throw new Error("Este comando sólo configura Keycloak local.");

const username = process.env.AETHER_KEYCLOAK_ADMIN_USERNAME;
const password = process.env.AETHER_KEYCLOAK_ADMIN_PASSWORD;
if (!username || !password)
  throw new Error(
    "Faltan las credenciales del administrador local de Keycloak.",
  );

function checked(response, step) {
  if (!response.ok) throw new Error(`${step} falló (HTTP ${response.status}).`);
  return response;
}

const tokenResponse = checked(
  await fetch(
    new URL("/realms/master/protocol/openid-connect/token", baseUrl),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        grant_type: "password",
        username,
        password,
      }),
      signal: AbortSignal.timeout(15000),
    },
  ),
  "Autenticación de administrador",
);
const { access_token: token } = await tokenResponse.json();
if (!token) throw new Error("Keycloak no devolvió un token de administrador.");

const clientsUrl = new URL("/admin/realms/aether-local/clients", baseUrl);
clientsUrl.searchParams.set("clientId", "aether-local");
const headers = { authorization: `Bearer ${token}` };
const clients = await checked(
  await fetch(clientsUrl, { headers, signal: AbortSignal.timeout(15000) }),
  "Lectura del cliente OIDC",
).json();
if (!Array.isArray(clients) || clients.length !== 1)
  throw new Error("No se encontró un único cliente AETHER en Keycloak.");

const clientUrl = new URL(
  `/admin/realms/aether-local/clients/${encodeURIComponent(clients[0].id)}`,
  baseUrl,
);
const client = await checked(
  await fetch(clientUrl, { headers, signal: AbortSignal.timeout(15000) }),
  "Lectura de la configuración OIDC",
).json();
const redirectUri = "http://127.0.0.1:3000/workspace?logged_out=1";
client.attributes = {
  ...client.attributes,
  "post.logout.redirect.uris": redirectUri,
};

checked(
  await fetch(clientUrl, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(client),
    signal: AbortSignal.timeout(15000),
  }),
  "Actualización del cierre de sesión",
);
const updated = await checked(
  await fetch(clientUrl, { headers, signal: AbortSignal.timeout(15000) }),
  "Verificación del cliente OIDC",
).json();
if (updated.attributes?.["post.logout.redirect.uris"] !== redirectUri)
  throw new Error(
    "Keycloak no confirmó la URL de retorno del cierre de sesión.",
  );

console.log("Keycloak local acepta el retorno de cierre de sesión de AETHER.");
