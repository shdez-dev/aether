import { randomUUID, timingSafeEqual } from "node:crypto";

import { AuthService } from "@aether/auth";
import {
  AccessDeniedError,
  InitiativeDomainError,
  InitiativeService,
  InitiativeVersionConflictError,
  EvaluationService,
  ProjectService,
  ProjectDomainError,
  ProjectVersionConflictError,
  InvitationError,
  ResourceNotFoundError,
  TenantService,
} from "@aether/application";
import {
  CreateInvitationRequestSchema,
  CreateInitiativeDraftRequestSchema,
  CreateOrganizationRequestSchema,
  CreateWorkspaceRequestSchema,
  DecideInitiativeRequestSchema,
  ActivateEvaluationStandardRequestSchema,
  AddProjectMilestoneRequestSchema,
  AddProjectNextActionRequestSchema,
  ChangeProjectStatusRequestSchema,
  CreateProjectFromInitiativeRequestSchema,
  PublishEvaluationStandardRequestSchema,
  StartReviewRequestSchema,
  SubmitInitiativeRequestSchema,
  UpdateInitiativeRequestSchema,
} from "@aether/contracts";
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
  tenants: TenantService;
  initiatives: InitiativeService;
  evaluations: EvaluationService;
  projects: ProjectService;
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
    const path = request.url.split("?")[0] ?? "";
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(request.method) &&
      (path === "/auth/logout" || path.startsWith("/v1/"))
    ) {
      assertCsrf(request, input.config);
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof UnauthenticatedError
        ? 401
        : error instanceof CsrfError ||
            error instanceof AccessDeniedError ||
            error instanceof IdentityEmailRequiredError
          ? 403
          : error instanceof ResourceNotFoundError
            ? 404
            : error instanceof InitiativeVersionConflictError ||
                error instanceof ProjectVersionConflictError
              ? 409
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
              : status === 404
                ? "Recurso no encontrado"
                : status === 409
                  ? "Conflicto de versión"
                  : "Solicitud inválida",
        status,
        code:
          error instanceof UnauthenticatedError
            ? "UNAUTHENTICATED"
            : error instanceof CsrfError ||
                error instanceof AccessDeniedError ||
                error instanceof IdentityEmailRequiredError
              ? "FORBIDDEN"
              : error instanceof ResourceNotFoundError
                ? "NOT_FOUND"
                : error instanceof InitiativeVersionConflictError ||
                    error instanceof ProjectVersionConflictError
                  ? "CONFLICT"
                  : error instanceof InitiativeDomainError ||
                      error instanceof ProjectDomainError
                    ? "PRECONDITION_FAILED"
                    : error instanceof InvitationError
                      ? "INVITATION_INVALID_OR_EXPIRED"
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
  app.post("/v1/organizations", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const body = CreateOrganizationRequestSchema.parse(request.body);
    const organization = await input.tenants.createOrganization({
      actorId: session.actorId,
      actorEmail: requireActorEmail(session.actorEmail),
      ...body,
    });
    return reply.code(201).send(organization);
  });
  app.post("/v1/workspaces", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const body = CreateWorkspaceRequestSchema.parse(request.body);
    const workspace = await input.tenants.createWorkspace({
      actorId: session.actorId,
      ...body,
    });
    return reply.code(201).send(workspace);
  });
  app.get("/v1/workspaces/:workspaceId", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ workspaceId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    return input.tenants.getWorkspace({
      actorId: session.actorId,
      ...params,
      ...query,
    });
  });
  app.get(
    "/v1/organizations/:organizationId/capabilities",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({ workspaceId: z.string().uuid().optional() })
        .parse(request.query);
      return input.tenants.capabilities({
        actorId: session.actorId,
        ...params,
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      });
    },
  );
  app.post(
    "/v1/organizations/:organizationId/invitations",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      const body = CreateInvitationRequestSchema.parse(request.body);
      const result = await input.tenants.invite({
        actorId: session.actorId,
        ...params,
        ...body,
      });
      // La entrega del token queda delimitada para el adaptador de correo/outbox.
      return reply.code(201).send({
        ...result.invitation,
        expiresAt: result.invitation.expiresAt.toISOString(),
      });
    },
  );
  app.post("/v1/invitations/accept", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const body = z
      .object({ token: z.string().min(32).max(255) })
      .parse(request.body);
    const invitation = await input.tenants.acceptInvitation({
      token: body.token,
      actorId: session.actorId,
      actorEmail: requireActorEmail(session.actorEmail),
    });
    return reply
      .code(200)
      .send({ ...invitation, expiresAt: invitation.expiresAt.toISOString() });
  });
  app.post("/v1/initiatives", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const body = CreateInitiativeDraftRequestSchema.parse(request.body);
    const initiative = await input.initiatives.create({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      ...body,
    });
    return reply.code(201).send(
      await toInitiativeResponse(
        await input.initiatives.detail({
          actorId: session.actorId,
          organizationId: initiative.organizationId,
          initiativeId: initiative.id,
        }),
      ),
    );
  });
  app.post("/v1/evaluation-standards", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const body = PublishEvaluationStandardRequestSchema.parse(request.body);
    const standard = await input.evaluations.publishStandard({
      actorId: session.actorId,
      ...body,
    });
    return reply
      .code(201)
      .send({ ...standard, publishedAt: standard.publishedAt.toISOString() });
  });
  app.post("/v1/projects", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const body = CreateProjectFromInitiativeRequestSchema.parse(request.body);
    const project = await input.projects.createFromInitiative({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      ...body,
    });
    return reply.code(201).send(toProjectResponse(project));
  });
  app.patch("/v1/projects/:projectId/status", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = ChangeProjectStatusRequestSchema.parse(request.body);
    const project = await input.projects.changeStatus({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      projectId: params.projectId,
      ...body,
    });
    return toProjectResponse(project);
  });
  app.post("/v1/projects/:projectId/milestones", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = AddProjectMilestoneRequestSchema.parse(request.body);
    const milestone = await input.projects.addMilestone({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      projectId: params.projectId,
      ...body,
    });
    return reply
      .code(201)
      .send({ ...milestone, createdAt: milestone.createdAt.toISOString() });
  });
  app.post("/v1/projects/:projectId/next-actions", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = AddProjectNextActionRequestSchema.parse(request.body);
    const action = await input.projects.addNextAction({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      projectId: params.projectId,
      ...body,
    });
    return reply
      .code(201)
      .send({ ...action, createdAt: action.createdAt.toISOString() });
  });
  app.get("/v1/projects/:projectId/audit-events", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const events = await input.projects.auditTrail({
      actorId: session.actorId,
      projectId: params.projectId,
      ...query,
    });
    return events.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
    }));
  });
  app.post(
    "/v1/evaluation-standards/:standardId/activate",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ standardId: z.string().uuid() })
        .parse(request.params);
      const body = ActivateEvaluationStandardRequestSchema.parse(request.body);
      await input.evaluations.activateStandard({
        actorId: session.actorId,
        standardId: params.standardId,
        ...body,
      });
      return reply.code(204).send();
    },
  );
  app.get("/v1/initiatives", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const query = z
      .object({
        organizationId: z.string().uuid(),
        workspaceId: z.string().uuid(),
      })
      .parse(request.query);
    const initiatives = await input.initiatives.list({
      actorId: session.actorId,
      ...query,
    });
    return Promise.all(initiatives.map(toInitiativeResponse));
  });
  app.get("/v1/initiatives/:initiativeId", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ initiativeId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    return toInitiativeResponse(
      await input.initiatives.detail({
        actorId: session.actorId,
        ...params,
        ...query,
      }),
    );
  });
  app.patch("/v1/initiatives/:initiativeId", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ initiativeId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const body = UpdateInitiativeRequestSchema.parse(request.body);
    const initiative = await input.initiatives.edit({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      ...params,
      ...query,
      ...body,
    });
    return toInitiativeResponse(
      await input.initiatives.detail({
        actorId: session.actorId,
        organizationId: initiative.organizationId,
        initiativeId: initiative.id,
      }),
    );
  });
  app.post("/v1/initiatives/:initiativeId/submit", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ initiativeId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const body = SubmitInitiativeRequestSchema.parse(request.body);
    const initiative = await input.initiatives.present({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      ...params,
      ...query,
      ...body,
    });
    return toInitiativeResponse(
      await input.initiatives.detail({
        actorId: session.actorId,
        organizationId: initiative.organizationId,
        initiativeId: initiative.id,
      }),
    );
  });
  app.post("/v1/initiatives/:initiativeId/review", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ initiativeId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const body = StartReviewRequestSchema.parse(request.body);
    const evaluation = await input.evaluations.review({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      ...params,
      ...query,
      ...body,
    });
    return reply.send({
      evaluation: toEvaluationResponse(evaluation),
      initiative: await toInitiativeResponse(
        await input.initiatives.detail({
          actorId: session.actorId,
          organizationId: query.organizationId,
          initiativeId: params.initiativeId,
        }),
      ),
    });
  });
  app.post("/v1/initiatives/:initiativeId/decide", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ initiativeId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const body = DecideInitiativeRequestSchema.parse(request.body);
    const decision = await input.evaluations.decide({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      ...params,
      ...query,
      ...body,
    });
    return reply.send({
      decision: toDecisionResponse(decision),
      initiative: await toInitiativeResponse(
        await input.initiatives.detail({
          actorId: session.actorId,
          organizationId: query.organizationId,
          initiativeId: params.initiativeId,
        }),
      ),
    });
  });
  app.get(
    "/v1/initiatives/:initiativeId/audit-events",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ initiativeId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.query);
      const events = await input.initiatives.auditTrail({
        actorId: session.actorId,
        ...params,
        ...query,
      });
      return events.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      }));
    },
  );
  return app;
}

async function toInitiativeResponse(
  detail: Awaited<ReturnType<InitiativeService["detail"]>>,
) {
  const { initiative, allowedActions } = detail;
  return {
    ...initiative,
    createdAt: initiative.createdAt.toISOString(),
    updatedAt: initiative.updatedAt.toISOString(),
    allowedActions,
  };
}
function toEvaluationResponse(
  evaluation: { evaluatedAt: Date } & Record<string, unknown>,
) {
  return { ...evaluation, evaluatedAt: evaluation.evaluatedAt.toISOString() };
}
function toDecisionResponse(
  decision: { decidedAt: Date } & Record<string, unknown>,
) {
  return { ...decision, decidedAt: decision.decidedAt.toISOString() };
}
function toProjectResponse(
  project: { createdAt: Date; updatedAt: Date } & Record<string, unknown>,
) {
  return {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
function correlationId(reply: FastifyReply): string {
  const value = reply.getHeader("X-Correlation-ID");
  return typeof value === "string" ? value : String(value);
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
class IdentityEmailRequiredError extends Error {}
function requireActorEmail(email: string | null): string {
  if (!email) throw new IdentityEmailRequiredError();
  return email;
}
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
