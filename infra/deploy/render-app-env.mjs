import { readFile, writeFile } from "node:fs/promises";

function parseEnv(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index < 1) throw new Error("Invalid line in Compose env file");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

const [composeEnvPath, outputPath] = process.argv.slice(2);
if (!composeEnvPath || !outputPath)
  throw new Error("Usage: render-app-env.mjs compose-env output");

const env = parseEnv(await readFile(composeEnvPath, "utf8"));
const required = [
  "AETHER_NODE_ENV",
  "AETHER_PUBLIC_URL",
  "POSTGRES_PASSWORD",
  "KEYCLOAK_ADMIN_USERNAME",
  "KEYCLOAK_ADMIN_PASSWORD",
  "OIDC_CLIENT_SECRET",
  "SESSION_ENCRYPTION_KEY",
  "METRICS_TOKEN",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
];
for (const name of required)
  if (!env[name]) throw new Error(`${name} is required in compose.env`);

const base = env.AETHER_PUBLIC_URL.replace(/\/+$/u, "");
const values = {
  NODE_ENV: env.AETHER_NODE_ENV,
  PORT: "4000",
  DATABASE_URL: `postgresql://aether:${env.POSTGRES_PASSWORD}@postgres:5432/aether`,
  SERVER_PUBLIC_URL: base,
  WEB_ORIGIN: base,
  OIDC_ISSUER_URL: `${base}/identity/realms/aether-local`,
  OIDC_CLIENT_ID: "aether-local",
  OIDC_CLIENT_SECRET: env.OIDC_CLIENT_SECRET,
  KEYCLOAK_ADMIN_USERNAME: env.KEYCLOAK_ADMIN_USERNAME,
  KEYCLOAK_ADMIN_PASSWORD: env.KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_INTERNAL_URL: "http://keycloak:8080/identity",
  OIDC_REDIRECT_URI: `${base}/auth/callback`,
  OIDC_ACCOUNT_MANAGEMENT_URL: `${base}/identity/realms/aether-local/account`,
  SESSION_ENCRYPTION_KEY: env.SESSION_ENCRYPTION_KEY,
  SESSION_TTL_SECONDS: "28800",
  SESSION_RENEWAL_WINDOW_SECONDS: "1800",
  RECENT_AUTH_MAX_AGE_SECONDS: "900",
  MAX_REQUEST_BODY_BYTES: "1048576",
  RATE_LIMIT_MAX: "120",
  RATE_LIMIT_WINDOW_SECONDS: "60",
  LOG_LEVEL: "info",
  METRICS_TOKEN: env.METRICS_TOKEN,
  S3_ENDPOINT: "http://garage:3900",
  S3_REGION: "garage",
  S3_BUCKET: "aether-documents",
  S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
  S3_PRESIGN_TTL_SECONDS: "300",
  MAX_DOCUMENT_BYTES: "10485760",
  SUPPORT_OPERATOR_ACTOR_IDS: "",
  CLAMAV_HOST: "clamav",
  CLAMAV_PORT: "3310",
  CLAMAV_TIMEOUT_MS: "30000",
  WORKER_ID: "aether-worker",
  OUTBOX_POLL_INTERVAL_MS: "1000",
};

for (const [name, value] of Object.entries(values))
  if (/[\r\n]/u.test(value)) throw new Error(`${name} contains a newline`);

await writeFile(
  outputPath,
  `${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`,
  { mode: 0o600 },
);
