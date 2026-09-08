import { randomUUID, timingSafeEqual } from "node:crypto";

import { AuthService } from "@aether/auth";
import cookie from "@fastify/cookie";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";

import type { ServerConfig } from "./config.js";

const sessionCookie = "aether_session";
const transactionCookie = "aether_oidc_tx";
const csrfCookie = "aether_csrf";
const callbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
});

export async function buildServer(input: {
  config: ServerConfig;
  auth: AuthService;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: input.config.nodeEnv !== "test",
    trustProxy: input.config.nodeEnv === "production",
  });
  await app.register(cookie);

  app.addHook("onRequest", async (request, reply) => {
    const correlationId = request.headers["x-correlation-id"];
    reply.header(
      "X-Correlation-ID",
      typeof correlationId === "string" ? correlationId : randomUUID(),
    );
  });
  app.addHook("preHandler", async (request, reply) => {
    if (
      request.method === "POST" &&
      request.routeOptions.url === "/auth/logout"
    ) {
      assertCsrf(request, input.config);
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof UnauthenticatedError
        ? 401
        : error instanceof CsrfError
          ? 403
          : 400;
    reply
      .code(status)
      .type("application/problem+json")
      .send({
        type: "https://aether.local/problems/authentication",
        title:
          status === 401
            ? "Sesión requerida"
            : status === 403
              ? "Solicitud rechazada"
              : "Solicitud inválida",
        status,
        code:
          error instanceof UnauthenticatedError
            ? "UNAUTHENTICATED"
            : error instanceof CsrfError
              ? "FORBIDDEN"
              : "VALIDATION_ERROR",
        correlationId: reply.getHeader("X-Correlation-ID"),
        instance: request.url,
      });
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/auth/login", async (_request, reply) => {
    const login = await input.auth.beginLogin();
    reply.setCookie(
      transactionCookie,
      login.transactionHandle,
      transientCookieOptions(input.config),
    );
    return reply.redirect(login.authorizationUrl);
  });
  app.get("/auth/callback", async (request, reply) => {
    const query = callbackQuery.parse(request.query);
    if (query.error) throw new Error("OIDC authorization was denied");
    const transactionHandle = request.cookies[transactionCookie];
    if (!transactionHandle) throw new Error("Missing OIDC transaction cookie");
    try {
      const callbackUrl = new URL(request.url, input.config.serverPublicUrl)
        .href;
      const completed = await input.auth.completeLogin({
        transactionHandle,
        state: query.state,
        callbackUrl,
      });
      reply.setCookie(
        sessionCookie,
        completed.sessionToken,
        sessionCookieOptions(input.config),
      );
      reply.setCookie(
        csrfCookie,
        randomUUID(),
        csrfCookieOptions(input.config),
      );
      reply.clearCookie(
        transactionCookie,
        transientCookieOptions(input.config),
      );
      return reply.redirect(input.config.webOrigin);
    } catch (error) {
      reply.clearCookie(
        transactionCookie,
        transientCookieOptions(input.config),
      );
      throw error;
    }
  });
  app.get("/auth/session", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    return {
      actorId: session.actorId,
      expiresAt: session.expiresAt.toISOString(),
    };
  });
  app.post("/auth/logout", async (request, reply) => {
    await input.auth.logout(request.cookies[sessionCookie]);
    reply.clearCookie(sessionCookie, sessionCookieOptions(input.config));
    reply.clearCookie(csrfCookie, csrfCookieOptions(input.config));
    return reply.code(204).send();
  });
  return app;
}

async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthService,
  config: ServerConfig,
) {
  const session = await auth.authenticate(request.cookies[sessionCookie]);
  if (!session) throw new UnauthenticatedError();
  reply.setCookie(
    sessionCookie,
    request.cookies[sessionCookie]!,
    sessionCookieOptions(config),
  );
  return session;
}

class CsrfError extends Error {}
class UnauthenticatedError extends Error {}
function assertCsrf(request: FastifyRequest, config: ServerConfig): void {
  const origin = request.headers.origin;
  if (
    typeof origin !== "string" ||
    new URL(origin).origin !== new URL(config.webOrigin).origin
  )
    throw new CsrfError();
  const header = request.headers["x-csrf-token"];
  const cookieValue = request.cookies[csrfCookie];
  if (
    typeof header !== "string" ||
    !cookieValue ||
    !safeEqual(header, cookieValue)
  )
    throw new CsrfError();
}
function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
function sessionCookieOptions(config: ServerConfig) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    maxAge: config.sessionTtlSeconds,
  };
}
function transientCookieOptions(config: ServerConfig) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
}
function csrfCookieOptions(config: ServerConfig) {
  return {
    httpOnly: false,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    maxAge: config.sessionTtlSeconds,
  };
}
