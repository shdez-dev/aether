import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  SERVER_PUBLIC_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url(),
  SESSION_ENCRYPTION_KEY: z.string().min(1),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(28_800),
  SESSION_RENEWAL_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(43_200)
    .default(1_800),
});

export type ServerConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  serverPublicUrl: string;
  webOrigin: string;
  oidcIssuerUrl: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcRedirectUri: string;
  sessionEncryptionKey: string;
  sessionTtlSeconds: number;
  sessionRenewalWindowSeconds: number;
  secureCookies: boolean;
}>;

export function readServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const value = configSchema.parse(environment);
  if (
    new URL(value.OIDC_REDIRECT_URI).origin !==
    new URL(value.SERVER_PUBLIC_URL).origin
  ) {
    throw new Error("OIDC_REDIRECT_URI must use SERVER_PUBLIC_URL origin");
  }
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    serverPublicUrl: value.SERVER_PUBLIC_URL,
    webOrigin: value.WEB_ORIGIN,
    oidcIssuerUrl: value.OIDC_ISSUER_URL,
    oidcClientId: value.OIDC_CLIENT_ID,
    oidcClientSecret: value.OIDC_CLIENT_SECRET,
    oidcRedirectUri: value.OIDC_REDIRECT_URI,
    sessionEncryptionKey: value.SESSION_ENCRYPTION_KEY,
    sessionTtlSeconds: value.SESSION_TTL_SECONDS,
    sessionRenewalWindowSeconds: value.SESSION_RENEWAL_WINDOW_SECONDS,
    secureCookies: value.NODE_ENV === "production",
  };
}
