import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { AuthService } from "@aether/auth";
import {
  createOperationalMetrics,
  telemetryTracer,
  type OperationalMetrics,
  type TelemetrySpan,
} from "@aether/observability";
import {
  AccessDeniedError,
  AuditHistoryService,
  SecurityAuditStore,
  InitiativeDomainError,
  InitiativeService,
  InitiativeVersionConflictError,
  IdempotencyStore,
  ProjectAlreadyExistsError,
  EvaluationService,
  ProjectService,
  ProjectDomainError,
  ProjectVersionConflictError,
  InvitationError,
  OwnershipTransferError,
  MembershipStatusError,
  ResourceNotFoundError,
  TenantService,
  DocumentService,
  DocumentAccessDeniedError,
  DocumentNotFoundError,
  DocumentValidationError,
  EvidenceService,
  NotificationService,
  CommentService,
  ProductMetricsService,
  OutboxAdministrationService,
  OutboxDeadLetterNotFoundError,
} from "@aether/application";
import {
  CreateInvitationRequestSchema,
  TransferOrganizationOwnershipRequestSchema,
  ChangeMembershipStatusRequestSchema,
  ReassignMemberResponsibilitiesRequestSchema,
  CreateInitiativeDraftRequestSchema,
  CreateOrganizationRequestSchema,
  CreateWorkspaceRequestSchema,
  DecideInitiativeRequestSchema,
  ActivateEvaluationStandardRequestSchema,
  AuditHistoryQuerySchema,
  AddProjectMilestoneRequestSchema,
  AddProjectNextActionRequestSchema,
  ChangeProjectStatusRequestSchema,
  CreateProjectFromInitiativeRequestSchema,
  PublishEvaluationStandardRequestSchema,
  StartReviewRequestSchema,
  SubmitInitiativeRequestSchema,
  UpdateInitiativeRequestSchema,
  BeginDocumentUploadRequestSchema,
  DocumentListQuerySchema,
  BeginDocumentReplacementRequestSchema,
  WithdrawDocumentVersionRequestSchema,
  AcceptProjectDeliverableRequestSchema,
  AttachEvidenceRequestSchema,
  CloseProjectRequestSchema,
  EvidenceReferenceSubjectTypeSchema,
  NotificationInboxQuerySchema,
  NotificationPreferenceRequestSchema,
  CreateCommentRequestSchema,
  ProductMetricsQuerySchema,
  OutboxDeadLetterQuerySchema,
  ReplayOutboxDeadLetterRequestSchema,
} from "@aether/contracts";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
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
  documents?: DocumentService;
  evidence?: EvidenceService;
  notifications?: NotificationService;
  comments?: CommentService;
  idempotency: IdempotencyStore;
  auditHistory?: AuditHistoryService;
  securityAudit?: SecurityAuditStore;
  productMetrics?: ProductMetricsService;
  outboxAdministration?: OutboxAdministrationService;
  readinessCheck?: () => Promise<void>;
  metrics?: OperationalMetrics;
}): Promise<FastifyInstance> {
  const metrics = input.metrics ?? createOperationalMetrics("aether-server");
  const requestSpans = new WeakMap<
    FastifyRequest,
    { startedAt: number; span: TelemetrySpan }
  >();
  const app = Fastify({
    bodyLimit: input.config.maxRequestBodyBytes,
    logger:
      input.config.nodeEnv !== "test"
        ? {
            level: input.config.logLevel,
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.headers.x-csrf-token",
                "req.headers.idempotency-key",
                "req.body",
                "res.headers.set-cookie",
              ],
              censor: "[REDACTED]",
            },
          }
        : false,
    trustProxy: input.config.nodeEnv === "production",
    genReqId: (request) => {
      const supplied = request.headers["x-correlation-id"];
      return typeof supplied === "string" &&
        z.uuid().safeParse(supplied).success
        ? supplied
        : randomUUID();
    },
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
  });
  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, origin === input.config.webOrigin);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "origin",
      "x-correlation-id",
      "x-csrf-token",
      "idempotency-key",
    ],
    exposedHeaders: ["x-correlation-id", "idempotent-replayed"],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: input.config.rateLimitMax,
    timeWindow: input.config.rateLimitWindowSeconds * 1_000,
    keyGenerator: (request) => {
      const sessionToken = request.cookies[sessionCookie];
      return sessionToken
        ? `session:${hashOpaqueValue(sessionToken)}`
        : `ip:${request.ip}`;
    },
    errorResponseBuilder: (request) => ({
      type: "https://aether.local/problems/rate-limit",
      title: "Demasiadas solicitudes",
      status: 429,
      code: "RATE_LIMITED",
      correlationId: request.id,
      instance: request.url,
    }),
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Correlation-ID", request.id);
    const route = request.url.split("?")[0] ?? "/";
    requestSpans.set(request, {
      startedAt: performance.now(),
      span: telemetryTracer("aether-server").startSpan(
        `HTTP ${request.method}`,
        {
          attributes: {
            "http.request.method": request.method,
            "url.path": route,
            "aether.correlation_id": request.id,
          },
        },
      ),
    });
  });
  app.addHook("onResponse", async (request, reply) => {
    const telemetry = requestSpans.get(request);
    if (!telemetry) return;
    const route = request.routeOptions.url ?? request.url.split("?")[0] ?? "/";
    const durationMs = performance.now() - telemetry.startedAt;
    telemetry.span.setAttributes({
      "http.route": route,
      "http.response.status_code": reply.statusCode,
    });
    if (reply.statusCode >= 500)
      telemetry.span.setAttribute("error.type", "server_error");
    telemetry.span.end();
    metrics.recordHttpRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs,
    });
  });
  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(request.method) &&
      (path === "/auth/logout" ||
        path.startsWith("/auth/sessions") ||
        path.startsWith("/v1/"))
    ) {
      assertCsrf(request, input.config);
    }
  });
  app.setErrorHandler(async (error, request, reply) => {
    const errorStatusCode =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : null;
    const errorCode =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    const payloadTooLarge = errorStatusCode === 413;
    const rateLimited =
      errorStatusCode === 429 ||
      errorCode === "FST_ERR_RATE_LIMIT" ||
      errorCode === "RATE_LIMITED";
    const status = payloadTooLarge
      ? 413
      : rateLimited
        ? 429
        : error instanceof UnauthenticatedError
          ? 401
          : error instanceof IdempotencyKeyReusedError ||
              error instanceof IdempotencyRequestInProgressError ||
              error instanceof ProjectAlreadyExistsError
            ? 409
            : error instanceof CsrfError ||
                error instanceof AccessDeniedError ||
                error instanceof DocumentAccessDeniedError ||
                error instanceof IdentityEmailRequiredError ||
                (error instanceof OwnershipTransferError &&
                  error.code === "ACTOR_MUST_BE_OWNER") ||
                (error instanceof MembershipStatusError &&
                  error.code === "actor_not_manager")
              ? 403
              : error instanceof ResourceNotFoundError ||
                  error instanceof DocumentNotFoundError ||
                  error instanceof OutboxDeadLetterNotFoundError
                ? 404
                : error instanceof InitiativeVersionConflictError ||
                    error instanceof ProjectVersionConflictError
                  ? 409
                  : 400;
    if (input.securityAudit && (status === 401 || status === 403)) {
      const session = await input.auth.authenticate(
        request.cookies[sessionCookie],
      );
      await input.securityAudit.record({
        id: randomUUID(),
        actorId: session?.actorId ?? null,
        action:
          status === 401
            ? "security.authentication_denied.v1"
            : "security.authorization_denied.v1",
        method: request.method,
        path: request.url.split("?")[0] ?? request.url,
        statusCode: status,
        correlationId: correlationId(reply),
        occurredAt: new Date(),
        metadata: {},
      });
    }
    reply
      .code(status)
      .type("application/problem+json")
      .send({
        type: "https://aether.local/problems/authentication",
        title:
          status === 413
            ? "Carga demasiado grande"
            : status === 429
              ? "Demasiadas solicitudes"
              : status === 401
                ? "Sesión requerida"
                : status === 403
                  ? "Solicitud rechazada"
                  : status === 404
                    ? "Recurso no encontrado"
                    : status === 409
                      ? "Conflicto de versión"
                      : "Solicitud inválida",
        status,
        code: payloadTooLarge
          ? "PAYLOAD_TOO_LARGE"
          : rateLimited
            ? "RATE_LIMITED"
            : error instanceof UnauthenticatedError
              ? "UNAUTHENTICATED"
              : error instanceof IdempotencyKeyReusedError
                ? "IDEMPOTENCY_KEY_REUSED"
                : error instanceof IdempotencyRequestInProgressError
                  ? "IDEMPOTENCY_REQUEST_IN_PROGRESS"
                  : error instanceof ProjectAlreadyExistsError
                    ? "CONFLICT"
                    : error instanceof CsrfError ||
                        error instanceof AccessDeniedError ||
                        error instanceof DocumentAccessDeniedError ||
                        error instanceof IdentityEmailRequiredError ||
                        (error instanceof OwnershipTransferError &&
                          error.code === "ACTOR_MUST_BE_OWNER") ||
                        (error instanceof MembershipStatusError &&
                          error.code === "actor_not_manager")
                      ? "FORBIDDEN"
                      : error instanceof ResourceNotFoundError ||
                          error instanceof DocumentNotFoundError ||
                          error instanceof OutboxDeadLetterNotFoundError
                        ? "NOT_FOUND"
                        : error instanceof InitiativeVersionConflictError ||
                            error instanceof ProjectVersionConflictError
                          ? "CONFLICT"
                          : error instanceof InitiativeDomainError ||
                              error instanceof DocumentValidationError ||
                              error instanceof ProjectDomainError
                            ? "PRECONDITION_FAILED"
                            : error instanceof InvitationError
                              ? "INVITATION_INVALID_OR_EXPIRED"
                              : error instanceof OwnershipTransferError
                                ? error.code
                                : error instanceof MembershipStatusError
                                  ? error.code.toUpperCase()
                                  : "VALIDATION_ERROR",
        correlationId: reply.getHeader("X-Correlation-ID"),
        instance: request.url,
      });
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/metrics", async (request, reply) => {
    if (
      input.config.metricsToken &&
      !safeEqual(
        request.headers.authorization ?? "",
        `Bearer ${input.config.metricsToken}`,
      )
    )
      return reply.code(401).send({ status: "unauthorized" });
    return metrics.snapshot();
  });
  app.get("/ready", async (_request, reply) => {
    try {
      await input.readinessCheck?.();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
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
    await input.auth.logout(
      request.cookies[sessionCookie],
      correlationId(reply),
    );
    reply.clearCookie(sessionCookie, sessionCookieOptions(input.config));
    reply.clearCookie(csrfCookie, csrfCookieOptions(input.config));
    return reply.code(204).send();
  });
  app.get("/auth/sessions", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const sessions = await input.auth.listSessions(session.actorId, session.id);
    return {
      sessions: sessions.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        lastSeenAt: item.lastSeenAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
        isCurrent: item.isCurrent,
      })),
    };
  });
  app.post("/auth/sessions/revoke-others", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const revoked = await input.auth.revokeOtherSessions({
      actorId: session.actorId,
      currentSessionId: session.id,
      correlationId: correlationId(reply),
    });
    return reply.code(200).send({ revoked });
  });
  app.post("/auth/sessions/:sessionId/revoke", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const { sessionId } = z
      .object({ sessionId: z.string().uuid() })
      .parse(request.params);
    const revoked = await input.auth.revokeSession({
      actorId: session.actorId,
      sessionId,
      correlationId: correlationId(reply),
    });
    if (revoked && session.id === sessionId) {
      reply.clearCookie(sessionCookie, sessionCookieOptions(input.config));
      reply.clearCookie(csrfCookie, csrfCookieOptions(input.config));
    }
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
  app.get("/v1/organizations", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    return input.tenants.listOrganizations(session.actorId);
  });
  app.get(
    "/v1/organizations/:organizationId/workspaces",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { organizationId } = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      return input.tenants.listWorkspaces({
        actorId: session.actorId,
        organizationId,
      });
    },
  );
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
  app.post(
    "/v1/organizations/:organizationId/ownership-transfers",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { organizationId } = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      const body = TransferOrganizationOwnershipRequestSchema.parse(
        request.body,
      );
      await input.tenants.transferOwnership({
        actorId: session.actorId,
        organizationId,
        targetActorId: body.targetActorId,
        correlationId: correlationId(reply),
      });
      return reply.code(204).send();
    },
  );
  app.patch(
    "/v1/organizations/:organizationId/members/:actorId/status",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { organizationId, actorId } = z
        .object({
          organizationId: z.string().uuid(),
          actorId: z.string().min(1).max(255),
        })
        .parse(request.params);
      const body = ChangeMembershipStatusRequestSchema.parse(request.body);
      await input.tenants.changeMembershipStatus({
        actorId: session.actorId,
        organizationId,
        targetActorId: actorId,
        status: body.status,
        correlationId: correlationId(reply),
      });
      return reply.code(204).send();
    },
  );
  app.post(
    "/v1/organizations/:organizationId/members/:actorId/reassignments",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { organizationId, actorId } = z
        .object({
          organizationId: z.string().uuid(),
          actorId: z.string().min(1).max(255),
        })
        .parse(request.params);
      const body = ReassignMemberResponsibilitiesRequestSchema.parse(
        request.body,
      );
      await input.tenants.reassignMemberResponsibilities({
        actorId: session.actorId,
        organizationId,
        targetActorId: actorId,
        replacementActorId: body.replacementActorId,
        correlationId: correlationId(reply),
      });
      return reply.code(204).send();
    },
  );
  app.post("/v1/documents/:documentId/replacements", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.documents) throw new Error("Document service is not configured");
    const { documentId } = z
      .object({ documentId: z.string().uuid() })
      .parse(request.params);
    const body = BeginDocumentReplacementRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `document.replacement.begin:${documentId}:${body.replacedVersionId}`,
      requestPayload: body,
      execute: async () => {
        const result = await input.documents!.beginReplacement({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          documentId,
          ...body,
        });
        return {
          statusCode: 201,
          body: {
            documentId: result.document.id,
            versionId: result.version.id,
            status: result.version.status,
            upload: {
              url: result.upload.url,
              headers: result.upload.headers,
              expiresAt: result.expiresAt.toISOString(),
            },
          },
        };
      },
    });
  });
  app.post(
    "/v1/documents/:documentId/versions/:versionId/withdraw",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.documents)
        throw new Error("Document service is not configured");
      const params = z
        .object({ documentId: z.string().uuid(), versionId: z.string().uuid() })
        .parse(request.params);
      const body = WithdrawDocumentVersionRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `document.withdraw:${params.documentId}:${params.versionId}`,
        requestPayload: body,
        execute: async () => ({
          statusCode: 200,
          body: toDocumentVersionResponse(
            await input.documents!.withdraw({
              actorId: session.actorId,
              correlationId: correlationId(reply),
              ...params,
              ...body,
            }),
          ),
        }),
      });
    },
  );
  app.post(
    "/v1/documents/:documentId/versions/:versionId/restore",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.documents)
        throw new Error("Document service is not configured");
      const params = z
        .object({ documentId: z.string().uuid(), versionId: z.string().uuid() })
        .parse(request.params);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `document.restore:${params.documentId}:${params.versionId}`,
        requestPayload: params,
        execute: async () => ({
          statusCode: 202,
          body: toDocumentVersionResponse(
            await input.documents!.restoreVersion({
              actorId: session.actorId,
              correlationId: correlationId(reply),
              ...params,
            }),
          ),
        }),
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
      correlationId: correlationId(reply),
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
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: "initiative.create",
      requestPayload: body,
      execute: async () => {
        const initiative = await input.initiatives.create({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...body,
        });
        return {
          statusCode: 201,
          body: await toInitiativeResponse(
            await input.initiatives.detail({
              actorId: session.actorId,
              organizationId: initiative.organizationId,
              initiativeId: initiative.id,
            }),
          ),
        };
      },
    });
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
  app.get("/v1/evaluation-standards", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const { organizationId } = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const standards = await input.evaluations.listStandards({
      actorId: session.actorId,
      organizationId,
    });
    return standards.map((standard) => ({
      ...standard,
      publishedAt: standard.publishedAt.toISOString(),
    }));
  });
  app.get("/v1/evaluations/:evaluationId", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const { evaluationId } = z
      .object({ evaluationId: z.string().uuid() })
      .parse(request.params);
    const { organizationId } = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const evaluation = await input.evaluations.getEvaluation({
      actorId: session.actorId,
      organizationId,
      evaluationId,
    });
    return { ...evaluation, evaluatedAt: evaluation.evaluatedAt.toISOString() };
  });
  app.get("/v1/decisions/:decisionId", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const { decisionId } = z
      .object({ decisionId: z.string().uuid() })
      .parse(request.params);
    const { organizationId } = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const decision = await input.evaluations.getDecision({
      actorId: session.actorId,
      organizationId,
      decisionId,
    });
    return { ...decision, decidedAt: decision.decidedAt.toISOString() };
  });
  app.post("/v1/projects", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const body = CreateProjectFromInitiativeRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.create:${body.initiativeId}`,
      requestPayload: body,
      execute: async () => {
        const project = await input.projects.createFromInitiative({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...body,
        });
        return { statusCode: 201, body: toProjectResponse(project) };
      },
    });
  });
  app.get("/v1/projects", async (request, reply) => {
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
    return (
      await input.projects.list({ actorId: session.actorId, ...query })
    ).map(toProjectResponse);
  });
  app.get("/v1/projects/:projectId", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const { projectId } = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const { organizationId } = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    return toProjectResponse(
      await input.projects.detail({
        actorId: session.actorId,
        organizationId,
        projectId,
      }),
    );
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
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.status:${params.projectId}`,
      requestPayload: body,
      execute: async () => {
        const project = await input.projects.changeStatus({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          projectId: params.projectId,
          ...body,
        });
        return { statusCode: 200, body: toProjectResponse(project) };
      },
    });
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
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.milestone.add:${params.projectId}`,
      requestPayload: body,
      execute: async () => {
        const milestone = await input.projects.addMilestone({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          projectId: params.projectId,
          ...body,
        });
        return {
          statusCode: 201,
          body: { ...milestone, createdAt: milestone.createdAt.toISOString() },
        };
      },
    });
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
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.next_action.add:${params.projectId}`,
      requestPayload: body,
      execute: async () => {
        const action = await input.projects.addNextAction({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          projectId: params.projectId,
          ...body,
        });
        return {
          statusCode: 201,
          body: { ...action, createdAt: action.createdAt.toISOString() },
        };
      },
    });
  });
  app.post("/v1/projects/:projectId/deliverables", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const { projectId } = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = AcceptProjectDeliverableRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.deliverable.accept:${projectId}:${body.documentVersionId}`,
      requestPayload: body,
      execute: async () => {
        const acceptance = await input.projects.acceptDeliverable({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          projectId,
          ...body,
        });
        return {
          statusCode: 201,
          body: {
            ...acceptance,
            acceptedAt: acceptance.acceptedAt.toISOString(),
          },
        };
      },
    });
  });
  app.post("/v1/projects/:projectId/closure", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const { projectId } = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = CloseProjectRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.close:${projectId}`,
      requestPayload: body,
      execute: async () => {
        const closure = await input.projects.close({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          projectId,
          ...body,
        });
        return {
          statusCode: 201,
          body: { ...closure, closedAt: closure.closedAt.toISOString() },
        };
      },
    });
  });
  app.post("/v1/evidence/:subjectType/:subjectId", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.evidence) throw new Error("Evidence service is not configured");
    const params = z
      .object({
        subjectType: EvidenceReferenceSubjectTypeSchema,
        subjectId: z.string().uuid(),
      })
      .parse(request.params);
    const body = AttachEvidenceRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `evidence.attach:${params.subjectType}:${params.subjectId}:${body.documentVersionId}`,
      requestPayload: body,
      execute: async () => {
        const reference = await input.evidence!.attach({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...params,
          ...body,
        });
        return {
          statusCode: 201,
          body: {
            ...reference,
            linkedAt: reference.linkedAt.toISOString(),
            compliance: "valid",
          },
        };
      },
    });
  });
  app.get("/v1/evidence/:subjectType/:subjectId", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.evidence) throw new Error("Evidence service is not configured");
    const params = z
      .object({
        subjectType: EvidenceReferenceSubjectTypeSchema,
        subjectId: z.string().uuid(),
      })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const references = await input.evidence.list({
      actorId: session.actorId,
      ...params,
      ...query,
    });
    app.get("/v1/notifications", async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.notifications)
        throw new Error("Notification service is not configured");
      const query = NotificationInboxQuerySchema.parse(request.query);
      return (
        await input.notifications.inbox({ actorId: session.actorId, ...query })
      ).map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
      }));
    });
    app.patch(
      "/v1/notifications/:notificationId/read",
      async (request, reply) => {
        const session = await requireSession(
          request,
          reply,
          input.auth,
          input.config,
        );
        if (!input.notifications)
          throw new Error("Notification service is not configured");
        const { notificationId } = z
          .object({ notificationId: z.string().uuid() })
          .parse(request.params);
        const notification = await input.notifications.read({
          actorId: session.actorId,
          notificationId,
        });
        return {
          ...notification,
          createdAt: notification.createdAt.toISOString(),
          readAt: notification.readAt?.toISOString() ?? null,
        };
      },
    );
    app.put("/v1/notification-preferences", async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.notifications)
        throw new Error("Notification service is not configured");
      await input.notifications.setEmailPreference({
        actorId: session.actorId,
        ...NotificationPreferenceRequestSchema.parse(request.body),
      });
      return reply.code(204).send();
    });
    app.post("/v1/comments", async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.comments) throw new Error("Comment service is not configured");
      const body = CreateCommentRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `comment.create:${body.resourceType}:${body.resourceId}`,
        requestPayload: body,
        execute: async () => ({
          statusCode: 201,
          body: await input.comments!.create({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...body,
          }),
        }),
      });
    });
    app.get("/v1/comments", async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.comments) throw new Error("Comment service is not configured");
      const query = z
        .object({
          resourceType: z.enum([
            "initiative",
            "evaluation",
            "decision",
            "project",
          ]),
          resourceId: z.string().uuid(),
        })
        .parse(request.query);
      return input.comments.list({ actorId: session.actorId, ...query });
    });
    app.patch("/v1/comments/:commentId/resolution", async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.comments) throw new Error("Comment service is not configured");
      const { commentId } = z
        .object({ commentId: z.string().uuid() })
        .parse(request.params);
      const { reopen } = z
        .object({ reopen: z.boolean().optional() })
        .parse(request.body);
      return input.comments.resolve({
        actorId: session.actorId,
        commentId,
        ...(reopen === undefined ? {} : { reopen }),
      });
    });
    return references.map((reference) => ({
      ...reference,
      linkedAt: reference.linkedAt.toISOString(),
    }));
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
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `initiative.edit:${params.initiativeId}`,
      requestPayload: { query, body },
      execute: async () => {
        const initiative = await input.initiatives.edit({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...params,
          ...query,
          ...body,
        });
        return {
          statusCode: 200,
          body: await toInitiativeResponse(
            await input.initiatives.detail({
              actorId: session.actorId,
              organizationId: initiative.organizationId,
              initiativeId: initiative.id,
            }),
          ),
        };
      },
    });
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
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `initiative.submit:${params.initiativeId}`,
      requestPayload: { query, body },
      execute: async () => {
        const initiative = await input.initiatives.present({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...params,
          ...query,
          ...body,
        });
        return {
          statusCode: 200,
          body: await toInitiativeResponse(
            await input.initiatives.detail({
              actorId: session.actorId,
              organizationId: initiative.organizationId,
              initiativeId: initiative.id,
            }),
          ),
        };
      },
    });
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
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `initiative.review:${params.initiativeId}`,
      requestPayload: { query, body },
      execute: async () => {
        const evaluation = await input.evaluations.review({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...params,
          ...query,
          ...body,
        });
        return {
          statusCode: 200,
          body: {
            evaluation: toEvaluationResponse(evaluation),
            initiative: await toInitiativeResponse(
              await input.initiatives.detail({
                actorId: session.actorId,
                organizationId: query.organizationId,
                initiativeId: params.initiativeId,
              }),
            ),
          },
        };
      },
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
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `initiative.decide:${params.initiativeId}`,
      requestPayload: { query, body },
      execute: async () => {
        const decision = await input.evaluations.decide({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...params,
          ...query,
          ...body,
        });
        return {
          statusCode: 200,
          body: {
            decision: toDecisionResponse(decision),
            initiative: await toInitiativeResponse(
              await input.initiatives.detail({
                actorId: session.actorId,
                organizationId: query.organizationId,
                initiativeId: params.initiativeId,
              }),
            ),
          },
        };
      },
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
  app.get("/v1/audit-events", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.auditHistory) throw new Error("Audit history is not configured");
    const query = AuditHistoryQuerySchema.parse(request.query);
    const events = await input.auditHistory.history({
      actorId: session.actorId,
      ...query,
    });
    return events.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
    }));
  });
  app.get("/v1/admin/product-metrics", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.productMetrics)
      throw new Error("Product metrics service is not configured");
    const query = ProductMetricsQuerySchema.parse(request.query);
    return toProductMetricsResponse(
      await input.productMetrics.snapshot({
        actorId: session.actorId,
        organizationId: query.organizationId,
        ...(query.startsAt ? { startsAt: new Date(query.startsAt) } : {}),
        ...(query.endsAt ? { endsAt: new Date(query.endsAt) } : {}),
      }),
    );
  });
  app.get("/v1/admin/outbox/dead-letters", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.outboxAdministration)
      throw new Error("Outbox administration service is not configured");
    const query = OutboxDeadLetterQuerySchema.parse(request.query);
    const letters = await input.outboxAdministration.listDeadLetters({
      actorId: session.actorId,
      ...query,
    });
    return letters.map(toOutboxDeadLetterResponse);
  });
  app.post(
    "/v1/admin/outbox/dead-letters/:eventId/replay",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.outboxAdministration)
        throw new Error("Outbox administration service is not configured");
      const params = z
        .object({ eventId: z.string().uuid() })
        .parse(request.params);
      const body = ReplayOutboxDeadLetterRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `outbox.dead_letter.replay:${params.eventId}`,
        requestPayload: { params, body },
        execute: async () => {
          await input.outboxAdministration!.replayDeadLetter({
            actorId: session.actorId,
            eventId: params.eventId,
            correlationId: correlationId(reply),
            ...body,
          });
          return { statusCode: 202, body: { eventId: params.eventId } };
        },
      });
    },
  );
  app.post("/v1/documents/uploads", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.documents) throw new Error("Document service is not configured");
    const body = BeginDocumentUploadRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `document.upload.begin:${body.resourceType}:${body.resourceId}`,
      requestPayload: body,
      execute: async () => {
        const result = await input.documents!.beginUpload({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...body,
        });
        return {
          statusCode: 201,
          body: {
            documentId: result.document.id,
            versionId: result.version.id,
            status: result.version.status,
            upload: {
              url: result.upload.url,
              headers: result.upload.headers,
              expiresAt: result.expiresAt.toISOString(),
            },
          },
        };
      },
    });
  });
  app.post(
    "/v1/documents/:documentId/versions/:versionId/complete",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.documents)
        throw new Error("Document service is not configured");
      const params = z
        .object({ documentId: z.string().uuid(), versionId: z.string().uuid() })
        .parse(request.params);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `document.upload.complete:${params.documentId}:${params.versionId}`,
        requestPayload: params,
        execute: async () => ({
          statusCode: 200,
          body: toDocumentVersionResponse(
            await input.documents!.completeUpload({
              actorId: session.actorId,
              correlationId: correlationId(reply),
              ...params,
            }),
          ),
        }),
      });
    },
  );
  app.get("/v1/documents", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.documents) throw new Error("Document service is not configured");
    const query = DocumentListQuerySchema.parse(request.query);
    return (
      await input.documents.list({ actorId: session.actorId, ...query })
    ).map(toDocumentVersionResponse);
  });
  app.get(
    "/v1/documents/:documentId/versions/:versionId/download",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.documents)
        throw new Error("Document service is not configured");
      const params = z
        .object({ documentId: z.string().uuid(), versionId: z.string().uuid() })
        .parse(request.params);
      const download = await input.documents.download({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        ...params,
      });
      return { url: download.url, expiresAt: download.expiresAt.toISOString() };
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

function toProductMetricsResponse(
  snapshot: Awaited<ReturnType<ProductMetricsService["snapshot"]>>,
) {
  return {
    ...snapshot,
    calculatedAt: snapshot.calculatedAt.toISOString(),
    period: {
      startsAt: snapshot.period.startsAt.toISOString(),
      endsAt: snapshot.period.endsAt.toISOString(),
    },
  };
}
function toOutboxDeadLetterResponse(
  deadLetter: Awaited<
    ReturnType<OutboxAdministrationService["listDeadLetters"]>
  >[number],
) {
  return { ...deadLetter, failedAt: deadLetter.failedAt.toISOString() };
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
function toDocumentVersionResponse(value: {
  document: {
    id: string;
    resourceType: string;
    resourceId: string;
    classification: string;
  };
  version: {
    id: string;
    versionNumber: number;
    originalName: string;
    declaredContentType: string;
    byteLength: number;
    sha256: string;
    status: string;
    createdAt: Date;
    publishedAt: Date | null;
    retentionUntil: Date | null;
    evidenceStatus: string;
    supersedesVersionId: string | null;
  };
}) {
  return {
    documentId: value.document.id,
    versionId: value.version.id,
    resourceType: value.document.resourceType,
    resourceId: value.document.resourceId,
    classification: value.document.classification,
    versionNumber: value.version.versionNumber,
    fileName: value.version.originalName,
    contentType: value.version.declaredContentType,
    byteLength: value.version.byteLength,
    sha256: value.version.sha256,
    status: value.version.status,
    evidenceStatus: value.version.evidenceStatus,
    createdAt: value.version.createdAt.toISOString(),
    publishedAt: value.version.publishedAt?.toISOString() ?? null,
    retentionUntil: value.version.retentionUntil?.toISOString() ?? null,
    supersedesVersionId: value.version.supersedesVersionId,
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
class IdempotencyKeyRequiredError extends Error {}
class IdempotencyKeyReusedError extends Error {}
class IdempotencyRequestInProgressError extends Error {}
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
function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
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

async function respondIdempotently(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  store: IdempotencyStore;
  actorId: string;
  operation: string;
  requestPayload: unknown;
  execute: () => Promise<{ statusCode: number; body: unknown }>;
}): Promise<FastifyReply> {
  const supplied = input.request.headers["idempotency-key"];
  if (typeof supplied !== "string") throw new IdempotencyKeyRequiredError();
  const key = z.string().trim().min(1).max(255).parse(supplied);
  const requestHash = createHash("sha256")
    .update(canonicalJson(input.requestPayload))
    .digest("base64url");
  const reservation = await input.store.reserve({
    actorId: input.actorId,
    operation: input.operation,
    key,
    requestHash,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  if (reservation.kind === "key_reused") throw new IdempotencyKeyReusedError();
  if (reservation.kind === "in_progress")
    throw new IdempotencyRequestInProgressError();
  if (reservation.kind === "completed")
    return input.reply
      .header("Idempotent-Replayed", "true")
      .code(reservation.response.statusCode)
      .send(reservation.response.body);
  try {
    const response = await input.execute();
    await input.store.complete({
      actorId: input.actorId,
      operation: input.operation,
      key,
      requestHash,
      response,
    });
    return input.reply.code(response.statusCode).send(response.body);
  } catch (error) {
    await input.store.abandon({
      actorId: input.actorId,
      operation: input.operation,
      key,
      requestHash,
    });
    throw error;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
