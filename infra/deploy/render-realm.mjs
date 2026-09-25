import { readFile, writeFile } from "node:fs/promises";

function parseEnv(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index < 1) throw new Error("Invalid line in Brevo env file");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

const [sourcePath, outputPath, smtpPath] = process.argv.slice(2);
if (!sourcePath || !outputPath || !smtpPath)
  throw new Error("Usage: render-realm.mjs source output smtp-env");

const settings = parseEnv(await readFile(smtpPath, "utf8"));
for (const name of ["BREVO_SMTP_LOGIN", "BREVO_SMTP_KEY", "AETHER_SMTP_FROM"])
  if (!settings[name])
    throw new Error(`${name} is required for email verification`);

const publicUrl = process.env.AETHER_PUBLIC_URL;
const clientSecret = process.env.OIDC_CLIENT_SECRET;
if (!publicUrl || !clientSecret)
  throw new Error("AETHER_PUBLIC_URL and OIDC_CLIENT_SECRET are required");

const realm = JSON.parse(await readFile(sourcePath, "utf8"));
realm.users = [];
realm.smtpServer = {
  host: "smtp-relay.brevo.com",
  port: "587",
  from: settings.AETHER_SMTP_FROM,
  fromDisplayName: "AETHER",
  ssl: "false",
  starttls: "true",
  auth: "true",
  user: settings.BREVO_SMTP_LOGIN,
  password: settings.BREVO_SMTP_KEY,
};
const client = realm.clients.find(
  ({ clientId }) => clientId === "aether-local",
);
if (!client) throw new Error("The aether-local OIDC client was not found");
client.secret = clientSecret;
client.redirectUris = [`${publicUrl}/auth/callback`];
client.webOrigins = [publicUrl];

await writeFile(outputPath, `${JSON.stringify(realm, null, 2)}\n`, {
  mode: 0o600,
});
