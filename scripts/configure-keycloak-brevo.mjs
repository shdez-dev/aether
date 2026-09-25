import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";

const envPath = fileURLToPath(new URL("../infra/.env.brevo", import.meta.url));

if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta ${name}. Completa infra/.env.brevo (consulta infra/.env.brevo.example).`);
  }
  return value;
}

function ensureSuccess(response, step) {
  if (!response.ok) {
    // No imprimir el cuerpo: algunos servidores incluyen datos de la solicitud.
    throw new Error(`${step} falló (HTTP ${response.status}).`);
  }
  return response;
}

async function run() {
  const login = required("BREVO_SMTP_LOGIN");
  const smtpKey = required("BREVO_SMTP_KEY");
  const from = required("AETHER_SMTP_FROM");
  const adminUser = required("AETHER_KEYCLOAK_ADMIN_USERNAME");
  const adminPassword = required("AETHER_KEYCLOAK_ADMIN_PASSWORD");

  if (smtpKey.startsWith("xkeysib-")) {
    throw new Error("BREVO_SMTP_KEY contiene una clave API. Usa una clave de la pestaña SMTP de Brevo.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
    throw new Error("BREVO_SMTP_LOGIN y AETHER_SMTP_FROM deben ser direcciones de correo válidas.");
  }

  const baseUrl = new URL(process.env.AETHER_KEYCLOAK_URL ?? "http://127.0.0.1:8080");
  if (!["localhost", "127.0.0.1"].includes(baseUrl.hostname) || !["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("Este comando sólo configura Keycloak local (localhost o 127.0.0.1).");
  }
  const realm = "aether-local";

  const tokenResponse = ensureSuccess(await fetch(new URL("/realms/master/protocol/openid-connect/token", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: adminUser,
      password: adminPassword,
    }),
    signal: AbortSignal.timeout(15000),
  }), "Autenticación de administrador");
  const { access_token: token } = await tokenResponse.json();
  if (!token) {
    throw new Error("Keycloak no devolvió un token de administrador.");
  }

  const realmUrl = new URL(`/admin/realms/${realm}`, baseUrl);
  const headers = { authorization: `Bearer ${token}` };
  const realmResponse = ensureSuccess(await fetch(realmUrl, { headers, signal: AbortSignal.timeout(15000) }), "Lectura del realm");
  const currentRealm = await realmResponse.json();
  const smtpServer = {
    host: "smtp-relay.brevo.com",
    port: "587",
    from,
    fromDisplayName: "AETHER",
    ssl: "false",
    starttls: "true",
    auth: "true",
    user: login,
    password: smtpKey,
  };

  ensureSuccess(await fetch(realmUrl, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ ...currentRealm, emailTheme: "aether", smtpServer }),
    signal: AbortSignal.timeout(15000),
  }), "Actualización del SMTP");

  const verificationResponse = ensureSuccess(await fetch(realmUrl, { headers, signal: AbortSignal.timeout(15000) }), "Verificación del SMTP");
  const updatedRealm = await verificationResponse.json();
  const saved = updatedRealm.smtpServer;
  if (updatedRealm.emailTheme !== "aether" || saved?.host !== smtpServer.host || saved?.port !== smtpServer.port || saved?.from !== from || saved?.user !== login) {
    throw new Error("Keycloak no confirmó el tema de correo y la configuración SMTP esperados.");
  }

  console.log(`Keycloak local configurado para enviar correos AETHER por Brevo desde ${from}.`);
  console.log("Para comprobar la entrega real, usa 'Test connection' en Realm settings > Email con un administrador que tenga correo configurado, o registra una cuenta de prueba.");
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : "Error desconocido";
  console.error(`No se pudo configurar Brevo: ${message}`);
  process.exitCode = 1;
});
