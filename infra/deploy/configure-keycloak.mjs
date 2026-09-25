import { readFile } from "node:fs/promises";

const [realmPath] = process.argv.slice(2);
if (!realmPath) throw new Error("Usage: configure-keycloak.mjs realm-json");

const realm = JSON.parse(await readFile(realmPath, "utf8"));
const origin = process.env.KEYCLOAK_INTERNAL_URL;
const username = process.env.KEYCLOAK_ADMIN_USERNAME;
const password = process.env.KEYCLOAK_ADMIN_PASSWORD;
if (!origin || !username || !password)
  throw new Error("Keycloak internal URL and admin credentials are required");

const tokenResponse = await fetch(
  `${origin}/realms/master/protocol/openid-connect/token`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username,
      password,
    }),
  },
);
if (!tokenResponse.ok)
  throw new Error(
    `Keycloak admin authentication failed (${tokenResponse.status})`,
  );
const { access_token: token } = await tokenResponse.json();

async function request(path, init = {}) {
  const response = await fetch(`${origin}/admin${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(`Keycloak configuration failed (${response.status})`);
  return response.status === 204 ? undefined : response.json();
}

const currentRealm = await request(
  `/realms/${encodeURIComponent(realm.realm)}`,
);
Object.assign(currentRealm, {
  displayName: realm.displayName,
  displayNameHtml: realm.displayNameHtml,
  loginTheme: realm.loginTheme,
  emailTheme: realm.emailTheme,
  internationalizationEnabled: realm.internationalizationEnabled,
  supportedLocales: realm.supportedLocales,
  defaultLocale: realm.defaultLocale,
  registrationAllowed: realm.registrationAllowed,
  registrationEmailAsUsername: realm.registrationEmailAsUsername,
  verifyEmail: realm.verifyEmail,
  resetPasswordAllowed: realm.resetPasswordAllowed,
  smtpServer: realm.smtpServer,
});
await request(`/realms/${encodeURIComponent(realm.realm)}`, {
  method: "PUT",
  body: JSON.stringify(currentRealm),
});

const clients = await request(
  `/realms/${encodeURIComponent(realm.realm)}/clients?clientId=${encodeURIComponent("aether-local")}`,
);
if (!Array.isArray(clients) || clients.length !== 1)
  throw new Error("Expected exactly one AETHER OIDC client in Keycloak");
const client = clients[0];
Object.assign(client, {
  secret: realm.clients.find(({ clientId }) => clientId === "aether-local")
    .secret,
  redirectUris: realm.clients.find(
    ({ clientId }) => clientId === "aether-local",
  ).redirectUris,
  webOrigins: realm.clients.find(({ clientId }) => clientId === "aether-local")
    .webOrigins,
});
await request(
  `/realms/${encodeURIComponent(realm.realm)}/clients/${encodeURIComponent(client.id)}`,
  { method: "PUT", body: JSON.stringify(client) },
);
process.stdout.write("Keycloak AETHER realm and OIDC origin are configured\n");
