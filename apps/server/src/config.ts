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
  RECENT_AUTH_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3_600)
    .default(900),
  MAX_REQUEST_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(10_485_760)
    .default(1_048_576),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3_600)
    .default(60),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug"])
    .default("info"),
  METRICS_TOKEN: z.string().min(32).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url()
    .or(z.literal(""))
    .optional()
    .transform((value) => value || undefined),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(3).max(63),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  MAX_DOCUMENT_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(26_214_400)
    .default(10_485_760),
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
  recentAuthMaxAgeSeconds: number;
  maxRequestBodyBytes: number;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug";
  metricsToken?: string;
  otelExporterOtlpEndpoint?: string;
  secureCookies: boolean;
  s3Endpoint: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3PresignTtlSeconds: number;
  maxDocumentBytes: number;
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
  if (value.NODE_ENV === "production" && !value.METRICS_TOKEN)
    throw new Error("METRICS_TOKEN is required in production");
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
    recentAuthMaxAgeSeconds: value.RECENT_AUTH_MAX_AGE_SECONDS,
    maxRequestBodyBytes: value.MAX_REQUEST_BODY_BYTES,
    rateLimitMax: value.RATE_LIMIT_MAX,
    rateLimitWindowSeconds: value.RATE_LIMIT_WINDOW_SECONDS,
    logLevel: value.LOG_LEVEL,
    ...(value.METRICS_TOKEN ? { metricsToken: value.METRICS_TOKEN } : {}),
    ...(value.OTEL_EXPORTER_OTLP_ENDPOINT
      ? { otelExporterOtlpEndpoint: value.OTEL_EXPORTER_OTLP_ENDPOINT }
      : {}),
    secureCookies: value.NODE_ENV === "production",
    s3Endpoint: value.S3_ENDPOINT,
    s3Bucket: value.S3_BUCKET,
    s3AccessKeyId: value.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: value.S3_SECRET_ACCESS_KEY,
    s3PresignTtlSeconds: value.S3_PRESIGN_TTL_SECONDS,
    maxDocumentBytes: value.MAX_DOCUMENT_BYTES,
  };
}
