import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import {
  AuthService,
  OidcProviderUnavailableError,
  randomOpaqueToken,
  type AuthSession,
} from "@aether/auth";
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
  InitiativeRelationshipService,
  DiagnosticService,
  IntakeService,
  IntakeDomainError,
  InitiativeVersionConflictError,
  IdempotencyStore,
  ProjectAlreadyExistsError,
  EvaluationService,
  TriageService,
  EvaluationConflictOfInterestError,
  ProjectService,
  ProjectDomainError,
  ProjectVersionConflictError,
  InvitationError,
  InvitationLifecycleError,
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
  WorkspaceArchivedError,
  BusinessHoursPolicyError,
  PolicyNotConfiguredError,
  TemporaryAccessGrantError,
  TemporaryAccessGrantService,
  SupportAccessGrantError,
  SupportAccessService,
  ExportService,
  CapacityDomainError,
  CapacityService,
} from "@aether/application";
import {
  CreateInvitationRequestSchema,
  InvitationTokenRequestSchema,
  TransferOrganizationOwnershipRequestSchema,
  ChangeMembershipStatusRequestSchema,
  ReassignMemberResponsibilitiesRequestSchema,
  CreateInitiativeDraftRequestSchema,
  SetInitiativeOperationalPriorityRequestSchema,
  CreateOrganizationRequestSchema,
  CreateWorkspaceRequestSchema,
  CreateTeamRequestSchema,
  ReplaceTeamMembersRequestSchema,
  TenancyPolicyValuesSchema,
  WorkspacePolicyOverrideRequestSchema,
  RequestTemporaryAccessGrantSchema,
  RevokeTemporaryAccessGrantSchema,
  ApproveTemporaryAccessGrantSchema,
  RequestSupportAccessGrantSchema,
  SupportAccessGrantContextSchema,
  RevokeSupportAccessGrantSchema,
  DecideInitiativeRequestSchema,
  ExemptDecisionConditionRequestSchema,
  FulfillDecisionConditionRequestSchema,
  ActivateEvaluationStandardRequestSchema,
  AssignEvaluationReviewerRequestSchema,
  AbstainFromEvaluationReviewRequestSchema,
  ReassignEvaluationReviewRequestSchema,
  EscalateEvaluationReviewAbstentionRequestSchema,
  AuditHistoryQuerySchema,
  AddProjectMilestoneRequestSchema,
  RegisterProjectRiskRequestSchema,
  ResolveProjectRiskRequestSchema,
  RecordProjectOperationalDecisionRequestSchema,
  AddProjectExternalDependencyRequestSchema,
  ResolveProjectExternalDependencyRequestSchema,
  RequestProjectChangeSchema,
  ReviewProjectChangeRequestSchema,
  AddProjectNextActionRequestSchema,
  ClaimProjectNextActionRequestSchema,
  ChangeProjectTaskDateRequestSchema,
  AddProjectNextActionCollaboratorRequestSchema,
  ReorderProjectNextActionRequestSchema,
  TransitionProjectNextActionWorkflowRequestSchema,
  DeclareProjectNextActionDependencyRequestSchema,
  ChangeProjectStatusRequestSchema,
  AssignProjectLeadRequestSchema,
  ReplaceProjectLeadRequestSchema,
  TransferProjectWorkspaceRequestSchema,
  CancelProjectRequestSchema,
  ArchiveProjectRequestSchema,
  PauseProjectRequestSchema,
  ResumeProjectRequestSchema,
  CreateProjectFromInitiativeRequestSchema,
  PublishEvaluationStandardRequestSchema,
  PublishTriageStandardRequestSchema,
  ActivateTriageStandardRequestSchema,
  TriageInitiativeRequestSchema,
  AssignIntakeResponsibilityRequestSchema,
  DeclareInitiativeRelationshipRequestSchema,
  SaveInitiativeDiagnosticRequestSchema,
  StartReviewRequestSchema,
  AnnulEvaluationRequestSchema,
  SubmitInitiativeRequestSchema,
  UpdateInitiativeRequestSchema,
  BeginDocumentUploadRequestSchema,
  DocumentListQuerySchema,
  RelocateDocumentRequestSchema,
  BeginDocumentReplacementRequestSchema,
  WithdrawDocumentVersionRequestSchema,
  AcceptProjectDeliverableRequestSchema,
  AttachEvidenceRequestSchema,
  CloseProjectRequestSchema,
  EvidenceReferenceSubjectTypeSchema,
  NotificationInboxQuerySchema,
  NotificationPreferenceRequestSchema,
  CreateCommentRequestSchema,
  EditCommentRequestSchema,
  ProductMetricsQuerySchema,
  OutboxDeadLetterQuerySchema,
  ReplayOutboxDeadLetterRequestSchema,
  ExportRequestSchema,
  CapacityBalanceQuerySchema,
  DeclareCapacityAvailabilityRequestSchema,
  DeclareProjectCapacityAllocationRequestSchema,
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
const authenticatedRequestSessions = new WeakMap<FastifyRequest, AuthSession>();
const callbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
});
export const PublicHttpRoutes = [
  "/health",
  "/metrics",
  "/ready",
  "/auth/login",
  "/auth/account-management/status",
  "/auth/account-management",
  "/auth/callback",
] as const;
const publicRoutes = new Set<string>(PublicHttpRoutes);

export async function buildServer(input: {
  config: ServerConfig;
  auth: AuthService;
  tenants: TenantService;
  accessGrants?: TemporaryAccessGrantService;
  supportAccess?: SupportAccessService;
  initiatives: InitiativeService;
  intake?: IntakeService;
  evaluations: EvaluationService;
  triage?: TriageService;
  relationships?: InitiativeRelationshipService;
  diagnostics?: DiagnosticService;
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
  exports?: ExportService;
  capacity?: CapacityService;
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
  app.addHook("preHandler", async (request, reply) => {
    const routeUrl = request.routeOptions.url;
    if (routeUrl && publicRoutes.has(routeUrl)) return;
    await requireSession(request, reply, input.auth, input.config);
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
        : error instanceof OidcProviderUnavailableError
          ? 503
          : error instanceof UnauthenticatedError
            ? 401
            : error instanceof IdempotencyKeyReusedError ||
                error instanceof IdempotencyRequestInProgressError ||
                error instanceof ProjectAlreadyExistsError
              ? 409
              : error instanceof WorkspaceArchivedError ||
                  (error instanceof TemporaryAccessGrantError &&
                    [
                      "GRANT_NOT_PENDING",
                      "GRANT_NOT_ACTIVE",
                      "GRANT_EXPIRED",
                    ].includes(error.code)) ||
                  (error instanceof SupportAccessGrantError &&
                    [
                      "SUPPORT_ACCESS_NOT_PENDING",
                      "SUPPORT_ACCESS_NOT_ACTIVE",
                      "SUPPORT_ACCESS_EXPIRED",
                    ].includes(error.code)) ||
                  (error instanceof InvitationLifecycleError &&
                    error.code === "INVITATION_NOT_PENDING")
                ? 409
                : error instanceof CsrfError ||
                    error instanceof RecentAuthenticationRequiredError ||
                    error instanceof EvaluationConflictOfInterestError ||
                    error instanceof AccessDeniedError ||
                    error instanceof DocumentAccessDeniedError ||
                    error instanceof IdentityEmailRequiredError ||
                    (error instanceof OwnershipTransferError &&
                      error.code === "ACTOR_MUST_BE_OWNER") ||
                    (error instanceof MembershipStatusError &&
                      error.code === "actor_not_manager") ||
                    (error instanceof TemporaryAccessGrantError &&
                      error.code === "GRANT_SEPARATION_OF_DUTIES") ||
                    (error instanceof SupportAccessGrantError &&
                      [
                        "SUPPORT_OPERATOR_NOT_ELIGIBLE",
                        "SUPPORT_ACCESS_SEPARATION_OF_DUTIES",
                        "SUPPORT_ACCESS_DENIED",
                      ].includes(error.code)) ||
                    error instanceof BusinessHoursPolicyError
                  ? 403
                  : error instanceof ResourceNotFoundError ||
                      (error instanceof InvitationLifecycleError &&
                        error.code === "INVITATION_NOT_FOUND") ||
                      error instanceof DocumentNotFoundError ||
                      error instanceof OutboxDeadLetterNotFoundError ||
                      error instanceof PolicyNotConfiguredError ||
                      error instanceof AccountManagementUnavailableError ||
                      (error instanceof TemporaryAccessGrantError &&
                        error.code === "GRANT_RESOURCE_NOT_FOUND")
                    ? 404
                    : error instanceof InitiativeVersionConflictError ||
                        error instanceof ProjectVersionConflictError ||
                        (error instanceof IntakeDomainError &&
                          error.code === "INTAKE_ALREADY_ASSIGNED")
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
    if (error instanceof OidcProviderUnavailableError)
      reply.header("Retry-After", "60");
    reply
      .code(status)
      .type("application/problem+json")
      .send({
        type: problemType(status),
        title:
          status === 413
            ? "Carga demasiado grande"
            : status === 429
              ? "Demasiadas solicitudes"
              : status === 503
                ? "Proveedor de identidad no disponible"
                : status === 401
                  ? "Sesión requerida"
                  : error instanceof RecentAuthenticationRequiredError
                    ? "Autenticación reciente requerida"
                    : status === 403
                      ? "Solicitud rechazada"
                      : status === 404
                        ? "Recurso no encontrado"
                        : status === 409
                          ? "Conflicto de versión"
                          : "Solicitud inválida",
        status,
        detail: safeProblemDetail(status),
        retryable:
          rateLimited ||
          status === 503 ||
          error instanceof IdempotencyRequestInProgressError,
        ...(error instanceof z.ZodError
          ? { errors: validationFieldViolations(error) }
          : {}),
        code: payloadTooLarge
          ? "PAYLOAD_TOO_LARGE"
          : rateLimited
            ? "RATE_LIMITED"
            : error instanceof OidcProviderUnavailableError
              ? "OIDC_PROVIDER_UNAVAILABLE"
              : error instanceof UnauthenticatedError
                ? "UNAUTHENTICATED"
                : error instanceof IdempotencyKeyReusedError
                  ? "IDEMPOTENCY_KEY_REUSED"
                  : error instanceof IdempotencyRequestInProgressError
                    ? "IDEMPOTENCY_REQUEST_IN_PROGRESS"
                    : error instanceof ProjectAlreadyExistsError
                      ? "CONFLICT"
                      : error instanceof WorkspaceArchivedError
                        ? "WORKSPACE_ARCHIVED"
                        : error instanceof RecentAuthenticationRequiredError
                          ? "RECENT_AUTH_REQUIRED"
                          : error instanceof AccountManagementUnavailableError
                            ? "ACCOUNT_MANAGEMENT_UNAVAILABLE"
                            : error instanceof BusinessHoursPolicyError
                              ? "BUSINESS_HOURS_ENFORCED"
                              : error instanceof
                                  EvaluationConflictOfInterestError
                                ? "CONFLICT_OF_INTEREST"
                                : error instanceof CsrfError ||
                                    error instanceof AccessDeniedError ||
                                    error instanceof
                                      DocumentAccessDeniedError ||
                                    error instanceof
                                      IdentityEmailRequiredError ||
                                    (error instanceof OwnershipTransferError &&
                                      error.code === "ACTOR_MUST_BE_OWNER") ||
                                    (error instanceof MembershipStatusError &&
                                      error.code === "actor_not_manager") ||
                                    (error instanceof
                                      TemporaryAccessGrantError &&
                                      error.code ===
                                        "GRANT_SEPARATION_OF_DUTIES") ||
                                    (error instanceof SupportAccessGrantError &&
                                      [
                                        "SUPPORT_OPERATOR_NOT_ELIGIBLE",
                                        "SUPPORT_ACCESS_SEPARATION_OF_DUTIES",
                                        "SUPPORT_ACCESS_DENIED",
                                      ].includes(error.code)) ||
                                    error instanceof BusinessHoursPolicyError
                                  ? "FORBIDDEN"
                                  : error instanceof ResourceNotFoundError ||
                                      (error instanceof
                                        InvitationLifecycleError &&
                                        error.code ===
                                          "INVITATION_NOT_FOUND") ||
                                      error instanceof DocumentNotFoundError ||
                                      error instanceof
                                        OutboxDeadLetterNotFoundError ||
                                      error instanceof
                                        PolicyNotConfiguredError ||
                                      (error instanceof
                                        TemporaryAccessGrantError &&
                                        error.code ===
                                          "GRANT_RESOURCE_NOT_FOUND")
                                    ? "NOT_FOUND"
                                    : error instanceof TemporaryAccessGrantError
                                      ? error.code
                                      : error instanceof SupportAccessGrantError
                                        ? error.code
                                        : error instanceof
                                              InitiativeVersionConflictError ||
                                            error instanceof
                                              ProjectVersionConflictError ||
                                            (error instanceof
                                              IntakeDomainError &&
                                              error.code ===
                                                "INTAKE_ALREADY_ASSIGNED")
                                          ? "CONFLICT"
                                          : error instanceof
                                                InitiativeDomainError ||
                                              (error instanceof
                                                IntakeDomainError &&
                                                error.code !==
                                                  "INTAKE_ALREADY_ASSIGNED") ||
                                              error instanceof
                                                DocumentValidationError ||
                                              error instanceof
                                                CapacityDomainError ||
                                              error instanceof
                                                ProjectDomainError
                                            ? "PRECONDITION_FAILED"
                                            : error instanceof InvitationError
                                              ? "INVITATION_INVALID_OR_EXPIRED"
                                              : error instanceof
                                                  InvitationLifecycleError
                                                ? error.code
                                                : error instanceof
                                                    OwnershipTransferError
                                                  ? error.code
                                                  : error instanceof
                                                      MembershipStatusError
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
  app.get("/auth/account-management/status", async () => ({
    available: Boolean(input.config.oidcAccountManagementUrl),
    authority: "oidc-provider" as const,
  }));
  app.get("/auth/account-management", async (_request, reply) => {
    if (!input.config.oidcAccountManagementUrl)
      throw new AccountManagementUnavailableError();
    return reply.redirect(input.config.oidcAccountManagementUrl);
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
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    await input.auth.logoutSession(session, correlationId(reply));
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
    return respondIdempotentlyWhenRequested({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: "organization.create",
      requestPayload: body,
      execute: async () => {
        const organization = await input.tenants.createOrganization({
          actorId: session.actorId,
          actorEmail: requireActorEmail(session.actorEmail),
          correlationId: correlationId(reply),
          ...body,
        });
        return { statusCode: 201, body: organization };
      },
    });
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
    "/v1/organizations/:organizationId/policy",
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
      return toEffectiveTenancyPolicyResponse(
        await input.tenants.getEffectivePolicy({
          actorId: session.actorId,
          ...params,
          ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        }),
      );
    },
  );
  app.put(
    "/v1/organizations/:organizationId/policy",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertCsrf(request, input.config);
      const params = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      const body = TenancyPolicyValuesSchema.parse(request.body);
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `organization.policy.update:${params.organizationId}`,
        requestPayload: { params, body },
        execute: async () => {
          const policy = await input.tenants.updateOrganizationPolicy({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
            ...body,
          });
          return {
            statusCode: 200,
            body: toOrganizationPolicyResponse(policy),
          };
        },
      });
    },
  );
  app.post("/v1/admin/support-access-grants", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    assertRecentAuthentication(session, input.config);
    if (!input.supportAccess)
      throw new Error("Support access is not configured");
    const body = RequestSupportAccessGrantSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `support_access_grant.request:${body.organizationId}`,
      requestPayload: body,
      execute: async () => {
        const grant = await input.supportAccess!.request({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...body,
        });
        return {
          statusCode: 201,
          body: toSupportAccessGrantResponse(input.supportAccess!, grant),
        };
      },
    });
  });
  app.get("/v1/admin/support-access-grants", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.supportAccess)
      throw new Error("Support access is not configured");
    const query = SupportAccessGrantContextSchema.parse(request.query);
    const grants = await input.supportAccess.list({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      ...query,
    });
    return grants.map((grant) =>
      toSupportAccessGrantResponse(input.supportAccess!, grant),
    );
  });
  app.post(
    "/v1/admin/support-access-grants/:grantId/approve",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertRecentAuthentication(session, input.config);
      if (!input.supportAccess)
        throw new Error("Support access is not configured");
      const params = z
        .object({ grantId: z.string().uuid() })
        .parse(request.params);
      const body = SupportAccessGrantContextSchema.parse(request.body);
      const grant = await input.supportAccess.approve({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        ...params,
        ...body,
      });
      return toSupportAccessGrantResponse(input.supportAccess, grant);
    },
  );
  app.post(
    "/v1/admin/support-access-grants/:grantId/revoke",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertRecentAuthentication(session, input.config);
      if (!input.supportAccess)
        throw new Error("Support access is not configured");
      const params = z
        .object({ grantId: z.string().uuid() })
        .parse(request.params);
      const body = RevokeSupportAccessGrantSchema.parse(request.body);
      const grant = await input.supportAccess.revoke({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        ...params,
        ...body,
      });
      return toSupportAccessGrantResponse(input.supportAccess, grant);
    },
  );
  app.get(
    "/v1/admin/support/organizations/:organizationId/diagnostics",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertRecentAuthentication(session, input.config);
      if (!input.supportAccess)
        throw new Error("Support access is not configured");
      const params = SupportAccessGrantContextSchema.parse(request.params);
      const diagnostic = await input.supportAccess.diagnose({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        ...params,
      });
      return {
        ...diagnostic,
        generatedAt: diagnostic.generatedAt.toISOString(),
      };
    },
  );
  app.post(
    "/v1/organizations/:organizationId/temporary-access-grants",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.accessGrants)
        throw new Error("Temporary access grants are not configured");
      const params = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      const body = RequestTemporaryAccessGrantSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `temporary_access_grant.request:${params.organizationId}`,
        requestPayload: body,
        execute: async () => {
          const grant = await input.accessGrants!.request({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
            ...body,
          });
          return {
            statusCode: 201,
            body: toTemporaryAccessGrantResponse(input.accessGrants!, grant),
          };
        },
      });
    },
  );
  app.get(
    "/v1/organizations/:organizationId/temporary-access-grants",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.accessGrants)
        throw new Error("Temporary access grants are not configured");
      const params = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      const grants = await input.accessGrants.list({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        ...params,
      });
      return grants.map((grant) =>
        toTemporaryAccessGrantResponse(input.accessGrants!, grant),
      );
    },
  );
  app.post(
    "/v1/organizations/:organizationId/temporary-access-grants/:grantId/approve",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertRecentAuthentication(session, input.config);
      if (!input.accessGrants)
        throw new Error("Temporary access grants are not configured");
      const params = z
        .object({
          organizationId: z.string().uuid(),
          grantId: z.string().uuid(),
        })
        .parse(request.params);
      ApproveTemporaryAccessGrantSchema.parse(request.body ?? {});
      const grant = await input.accessGrants.approve({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        ...params,
      });
      return toTemporaryAccessGrantResponse(input.accessGrants, grant);
    },
  );
  app.post(
    "/v1/organizations/:organizationId/temporary-access-grants/:grantId/revoke",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertRecentAuthentication(session, input.config);
      if (!input.accessGrants)
        throw new Error("Temporary access grants are not configured");
      const params = z
        .object({
          organizationId: z.string().uuid(),
          grantId: z.string().uuid(),
        })
        .parse(request.params);
      const body = RevokeTemporaryAccessGrantSchema.parse(request.body);
      const grant = await input.accessGrants.revoke({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        ...params,
        ...body,
      });
      return toTemporaryAccessGrantResponse(input.accessGrants, grant);
    },
  );
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
    return respondIdempotentlyWhenRequested({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `workspace.create:${body.organizationId}`,
      requestPayload: body,
      execute: async () => {
        const workspace = await input.tenants.createWorkspace({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          ...body,
        });
        return { statusCode: 201, body: workspace };
      },
    });
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
      correlationId: correlationId(reply),
      ...params,
      ...query,
    });
  });
  app.post(
    "/v1/organizations/:organizationId/workspaces/:workspaceId/archive",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertRecentAuthentication(session, input.config);
      const params = z
        .object({
          organizationId: z.string().uuid(),
          workspaceId: z.string().uuid(),
        })
        .parse(request.params);
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `workspace.archive:${params.organizationId}:${params.workspaceId}`,
        requestPayload: params,
        execute: async () => {
          await input.tenants.archiveWorkspace({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
          });
          return { statusCode: 204, body: {} };
        },
      });
    },
  );
  app.put(
    "/v1/organizations/:organizationId/workspaces/:workspaceId/policy-override",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertCsrf(request, input.config);
      const params = z
        .object({
          organizationId: z.string().uuid(),
          workspaceId: z.string().uuid(),
        })
        .parse(request.params);
      const body = WorkspacePolicyOverrideRequestSchema.parse(request.body);
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `workspace.policy_override.set:${params.organizationId}:${params.workspaceId}`,
        requestPayload: { params, body },
        execute: async () => {
          const override = await input.tenants.setWorkspacePolicyOverride({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
            ...body,
          });
          return {
            statusCode: 200,
            body: toWorkspacePolicyOverrideResponse(override),
          };
        },
      });
    },
  );
  app.delete(
    "/v1/organizations/:organizationId/workspaces/:workspaceId/policy-override",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertCsrf(request, input.config);
      const params = z
        .object({
          organizationId: z.string().uuid(),
          workspaceId: z.string().uuid(),
        })
        .parse(request.params);
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `workspace.policy_override.clear:${params.organizationId}:${params.workspaceId}`,
        requestPayload: params,
        execute: async () => {
          await input.tenants.clearWorkspacePolicyOverride({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
          });
          return { statusCode: 204, body: {} };
        },
      });
    },
  );
  app.put(
    "/v1/organizations/:organizationId/workspaces/:workspaceId/teams/:teamId/members",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({
          organizationId: z.string().uuid(),
          workspaceId: z.string().uuid(),
          teamId: z.string().uuid(),
        })
        .parse(request.params);
      const body = ReplaceTeamMembersRequestSchema.parse(request.body);
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `team.members.replace:${params.organizationId}:${params.workspaceId}:${params.teamId}`,
        requestPayload: { params, body },
        execute: async () => {
          await input.tenants.replaceTeamMembers({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
            ...body,
          });
          return { statusCode: 204, body: {} };
        },
      });
    },
  );
  app.get(
    "/v1/organizations/:organizationId/workspaces/:workspaceId/teams",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({
          organizationId: z.string().uuid(),
          workspaceId: z.string().uuid(),
        })
        .parse(request.params);
      return input.tenants.listTeams({ actorId: session.actorId, ...params });
    },
  );
  app.post(
    "/v1/organizations/:organizationId/workspaces/:workspaceId/teams",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({
          organizationId: z.string().uuid(),
          workspaceId: z.string().uuid(),
        })
        .parse(request.params);
      const body = CreateTeamRequestSchema.parse(request.body);
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `team.create:${params.organizationId}:${params.workspaceId}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 201,
          body: await input.tenants.createTeam({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
            ...body,
          }),
        }),
      });
    },
  );
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
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `invitation.create:${params.organizationId}`,
        requestPayload: { params, body },
        execute: async () => {
          const result = await input.tenants.invite({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
            ...body,
          });
          return {
            statusCode: 201,
            body: {
              ...result.invitation,
              expiresAt: result.invitation.expiresAt.toISOString(),
            },
          };
        },
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
      assertRecentAuthentication(session, input.config);
      const params = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      const body = TransferOrganizationOwnershipRequestSchema.parse(
        request.body,
      );
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `organization.ownership.transfer:${params.organizationId}`,
        requestPayload: { params, body },
        execute: async () => {
          await input.tenants.transferOwnership({
            actorId: session.actorId,
            organizationId: params.organizationId,
            targetActorId: body.targetActorId,
            correlationId: correlationId(reply),
          });
          return { statusCode: 204, body: {} };
        },
      });
    },
  );
  app.delete(
    "/v1/organizations/:organizationId/invitations/:invitationId",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertRecentAuthentication(session, input.config);
      const params = z
        .object({
          organizationId: z.string().uuid(),
          invitationId: z.string().uuid(),
        })
        .parse(request.params);
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `invitation.revoke:${params.organizationId}:${params.invitationId}`,
        requestPayload: params,
        execute: async () => {
          await input.tenants.revokeInvitation({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
          });
          return { statusCode: 204, body: {} };
        },
      });
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
      assertRecentAuthentication(session, input.config);
      const params = z
        .object({
          organizationId: z.string().uuid(),
          actorId: z.string().min(1).max(255),
        })
        .parse(request.params);
      const body = ChangeMembershipStatusRequestSchema.parse(request.body);
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `organization.membership.status:${params.organizationId}:${params.actorId}`,
        requestPayload: { params, body },
        execute: async () => {
          await input.tenants.changeMembershipStatus({
            actorId: session.actorId,
            organizationId: params.organizationId,
            targetActorId: params.actorId,
            status: body.status,
            correlationId: correlationId(reply),
          });
          return { statusCode: 204, body: {} };
        },
      });
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
      assertRecentAuthentication(session, input.config);
      const params = z
        .object({
          organizationId: z.string().uuid(),
          actorId: z.string().min(1).max(255),
        })
        .parse(request.params);
      const body = ReassignMemberResponsibilitiesRequestSchema.parse(
        request.body,
      );
      return respondIdempotentlyWhenRequested({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `organization.membership.reassign:${params.organizationId}:${params.actorId}`,
        requestPayload: { params, body },
        execute: async () => {
          await input.tenants.reassignMemberResponsibilities({
            actorId: session.actorId,
            organizationId: params.organizationId,
            targetActorId: params.actorId,
            replacementActorId: body.replacementActorId,
            correlationId: correlationId(reply),
          });
          return { statusCode: 204, body: {} };
        },
      });
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
  app.post("/v1/documents/:documentId/relocate", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    assertRecentAuthentication(session, input.config);
    if (!input.documents) throw new Error("Document service is not configured");
    const { documentId } = z
      .object({ documentId: z.string().uuid() })
      .parse(request.params);
    const body = RelocateDocumentRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `document.relocate:${documentId}`,
      requestPayload: { documentId, ...body },
      execute: async () => {
        const document = await input.documents!.relocate({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          documentId,
          ...body,
        });
        return {
          statusCode: 200,
          body: {
            documentId: document.id,
            resourceType: document.resourceType,
            resourceId: document.resourceId,
            classification: document.classification,
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
    const body = InvitationTokenRequestSchema.parse(request.body);
    return respondIdempotentlyWhenRequested({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: "invitation.accept",
      requestPayload: body,
      execute: async () => {
        const invitation = await input.tenants.acceptInvitation({
          token: body.token,
          actorId: session.actorId,
          actorEmail: requireActorEmail(session.actorEmail),
          correlationId: correlationId(reply),
        });
        const rotated = await input.auth.rotateSession({
          currentSession: session,
          correlationId: correlationId(reply),
        });
        reply.setCookie(
          sessionCookie,
          rotated.sessionToken,
          sessionCookieOptions(input.config),
        );
        reply.setCookie(
          csrfCookie,
          randomOpaqueToken(),
          csrfCookieOptions(input.config),
        );
        return {
          statusCode: 200,
          body: {
            ...invitation,
            expiresAt: invitation.expiresAt.toISOString(),
          },
        };
      },
    });
  });
  app.post("/v1/invitations/reject", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const body = InvitationTokenRequestSchema.parse(request.body);
    return respondIdempotentlyWhenRequested({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: "invitation.reject",
      requestPayload: body,
      execute: async () => {
        await input.tenants.rejectInvitation({
          token: body.token,
          actorId: session.actorId,
          actorEmail: requireActorEmail(session.actorEmail),
          correlationId: correlationId(reply),
        });
        return { statusCode: 204, body: {} };
      },
    });
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
              correlationId: correlationId(reply),
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
    return respondIdempotentlyWhenRequested({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: "evaluation-standard.publish",
      requestPayload: body,
      execute: async () => {
        const standard = await input.evaluations.publishStandard({
          actorId: session.actorId,
          ...body,
        });
        return {
          statusCode: 201,
          body: {
            ...standard,
            publishedAt: standard.publishedAt.toISOString(),
          },
        };
      },
    });
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
  app.post("/v1/triage-standards", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.triage) throw new Error("Triage service is not configured");
    const body = PublishTriageStandardRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: "triage-standard.publish",
      requestPayload: body,
      execute: async () => {
        const standard = await input.triage!.publishStandard({
          actorId: session.actorId,
          ...body,
        });
        return {
          statusCode: 201,
          body: {
            ...standard,
            publishedAt: standard.publishedAt.toISOString(),
          },
        };
      },
    });
  });
  app.get("/v1/triage-standards", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.triage) throw new Error("Triage service is not configured");
    const { organizationId } = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const standards = await input.triage.listStandards({
      actorId: session.actorId,
      organizationId,
    });
    return standards.map((standard) => ({
      ...standard,
      publishedAt: standard.publishedAt.toISOString(),
    }));
  });
  app.post(
    "/v1/triage-standards/:standardId/activate",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.triage) throw new Error("Triage service is not configured");
      const params = z
        .object({ standardId: z.string().uuid() })
        .parse(request.params);
      const body = ActivateTriageStandardRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `triage-standard.activate:${params.standardId}`,
        requestPayload: { params, body },
        execute: async () => {
          await input.triage!.activateStandard({
            actorId: session.actorId,
            ...params,
            ...body,
          });
          return { statusCode: 204, body: {} };
        },
      });
    },
  );
  app.get("/v1/triage-results/:triageId", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.triage) throw new Error("Triage service is not configured");
    const params = z
      .object({ triageId: z.string().uuid() })
      .parse(request.params);
    const { organizationId } = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    return toTriageResponse(
      await input.triage.getTriage({
        actorId: session.actorId,
        ...params,
        organizationId,
      }),
    );
  });
  app.get("/v1/intake-exceptions", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.intake) throw new Error("Intake service is not configured");
    const { organizationId } = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const exceptions = await input.intake.listUnassigned({
      actorId: session.actorId,
      organizationId,
    });
    return exceptions.map(toUnassignedIntakeExceptionResponse);
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
      correlationId: correlationId(reply),
      organizationId,
      evaluationId,
    });
    return toEvaluationResponse(evaluation);
  });
  app.post(
    "/v1/initiatives/:initiativeId/review-assignments",
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
      const body = AssignEvaluationReviewerRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `initiative.review-assignment:${params.initiativeId}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 201,
          body: toEvaluationReviewerAssignmentResponse(
            await input.evaluations.assignReviewer({
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
    "/v1/evaluation-review-assignments/:assignmentId/abstentions",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ assignmentId: z.string().uuid() })
        .parse(request.params);
      const body = AbstainFromEvaluationReviewRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `evaluation-review-assignment.abstain:${params.assignmentId}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 200,
          body: toEvaluationReviewerAssignmentResponse(
            await input.evaluations.abstainFromReview({
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
    "/v1/evaluation-review-assignments/:assignmentId/reassignments",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ assignmentId: z.string().uuid() })
        .parse(request.params);
      const body = ReassignEvaluationReviewRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `evaluation-review-assignment.reassign:${params.assignmentId}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 200,
          body: toEvaluationReviewerAssignmentResponse(
            await input.evaluations.reassignReview({
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
    "/v1/evaluation-review-assignments/:assignmentId/escalations",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ assignmentId: z.string().uuid() })
        .parse(request.params);
      const body = EscalateEvaluationReviewAbstentionRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `evaluation-review-assignment.escalate:${params.assignmentId}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 200,
          body: toEvaluationReviewerAssignmentResponse(
            await input.evaluations.escalateReviewAbstention({
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
    "/v1/evaluations/:evaluationId/annulments",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ evaluationId: z.string().uuid() })
        .parse(request.params);
      const body = AnnulEvaluationRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `evaluation.annul:${params.evaluationId}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 200,
          body: toEvaluationResponse(
            await input.evaluations.annulEvaluation({
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
      correlationId: correlationId(reply),
      organizationId,
      decisionId,
    });
    return toDecisionResponse(decision);
  });
  app.post(
    "/v1/decisions/:decisionId/conditions/:conditionId/exemptions",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertRecentAuthentication(session, input.config);
      const params = z
        .object({
          decisionId: z.string().uuid(),
          conditionId: z.string().uuid(),
        })
        .parse(request.params);
      const query = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.query);
      const body = ExemptDecisionConditionRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `decision.condition.exempt:${params.conditionId}`,
        requestPayload: { params, query, body },
        execute: async () => ({
          statusCode: 200,
          body: {
            decision: toDecisionResponse(
              await input.evaluations.exemptCondition({
                actorId: session.actorId,
                correlationId: correlationId(reply),
                ...params,
                ...query,
                ...body,
              }),
            ),
          },
        }),
      });
    },
  );
  app.post(
    "/v1/decisions/:decisionId/conditions/:conditionId/fulfillments",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      assertRecentAuthentication(session, input.config);
      const params = z
        .object({
          decisionId: z.string().uuid(),
          conditionId: z.string().uuid(),
        })
        .parse(request.params);
      const query = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.query);
      const body = FulfillDecisionConditionRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `decision.condition.fulfill:${params.conditionId}`,
        requestPayload: { params, query, body },
        execute: async () => ({
          statusCode: 200,
          body: {
            decision: toDecisionResponse(
              await input.evaluations.fulfillCondition({
                actorId: session.actorId,
                correlationId: correlationId(reply),
                ...params,
                ...query,
                ...body,
              }),
            ),
          },
        }),
      });
    },
  );
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
  app.post(
    "/v1/organizations/:organizationId/capacity-availability",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.capacity)
        throw new Error("Capacity service is not configured");
      const params = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      const body = DeclareCapacityAvailabilityRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `capacity.availability.declare:${params.organizationId}:${body.availableActorId}:${body.unit}:${body.period.startsOn}:${body.period.endsOn}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 201,
          body: toCapacityAvailabilityResponse(
            await input.capacity!.declareAvailability({
              actorId: session.actorId,
              organizationId: params.organizationId,
              ...body,
            }),
          ),
        }),
      });
    },
  );
  app.get(
    "/v1/organizations/:organizationId/capacity-balance",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.capacity)
        throw new Error("Capacity service is not configured");
      const params = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.params);
      const query = CapacityBalanceQuerySchema.parse(request.query);
      const balance = await input.capacity.balance({
        actorId: session.actorId,
        organizationId: params.organizationId,
        capacityActorId: query.capacityActorId,
        unit: query.unit,
        period: {
          startsOn: query.periodStartsOn,
          endsOn: query.periodEndsOn,
        },
      });
      return balance ? toCapacityBalanceResponse(balance) : null;
    },
  );
  app.post(
    "/v1/projects/:projectId/capacity-allocations",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.capacity)
        throw new Error("Capacity service is not configured");
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = DeclareProjectCapacityAllocationRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `capacity.allocation.declare:${params.projectId}:${body.allocatedActorId}:${body.unit}:${body.period.startsOn}:${body.period.endsOn}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 201,
          body: toCapacityAllocationResponse(
            await input.capacity!.allocate({
              actorId: session.actorId,
              projectId: params.projectId,
              ...body,
            }),
          ),
        }),
      });
    },
  );
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
        correlationId: correlationId(reply),
        organizationId,
        projectId,
      }),
    );
  });
  app.get("/v1/projects/:projectId/closure", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.evidence) throw new Error("Evidence service is not configured");
    const { projectId } = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const { organizationId } = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const dossier = await input.projects.closureDossier({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      organizationId,
      projectId,
    });
    const evidence = await input.evidence.list({
      actorId: session.actorId,
      organizationId,
      subjectType: "project_closure",
      subjectId: dossier.closure.id,
    });
    return {
      project: toProjectResponse(dossier.project),
      closure: {
        ...dossier.closure,
        closedAt: dossier.closure.closedAt.toISOString(),
      },
      evidence: evidence.map((reference) => ({
        ...reference,
        linkedAt: reference.linkedAt.toISOString(),
      })),
    };
  });
  app.get(
    "/v1/projects/:projectId/baseline-difference",
    async (request, reply) => {
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
      const result = await input.projects.baselineDifference({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        organizationId,
        projectId,
      });
      return {
        baseline: result.baseline
          ? {
              id: result.baseline.id,
              changeRequestId: result.baseline.changeRequestId,
              version: result.baseline.version,
              approvedByActorId: result.baseline.approvedByActorId,
              approvedAt: result.baseline.approvedAt.toISOString(),
            }
          : null,
        differences: result.differences,
      };
    },
  );
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
  app.patch("/v1/projects/:projectId/lead", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = AssignProjectLeadRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.lead:${params.projectId}`,
      requestPayload: body,
      execute: async () => ({
        statusCode: 200,
        body: toProjectResponse(
          await input.projects.assignLead({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            ...body,
          }),
        ),
      }),
    });
  });
  app.post(
    "/v1/projects/:projectId/lead-replacements",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = ReplaceProjectLeadRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.lead-replacement:${params.projectId}`,
        requestPayload: body,
        execute: async () => ({
          statusCode: 200,
          body: toProjectResponse(
            await input.projects.replaceLead({
              actorId: session.actorId,
              correlationId: correlationId(reply),
              projectId: params.projectId,
              ...body,
            }),
          ),
        }),
      });
    },
  );
  app.post("/v1/projects/:projectId/transfer", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = TransferProjectWorkspaceRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.transfer:${params.projectId}`,
      requestPayload: body,
      execute: async () => ({
        statusCode: 200,
        body: toProjectResponse(
          await input.projects.transferWorkspace({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            ...body,
          }),
        ),
      }),
    });
  });
  app.post("/v1/projects/:projectId/cancellation", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = CancelProjectRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.cancellation:${params.projectId}`,
      requestPayload: body,
      execute: async () => ({
        statusCode: 200,
        body: toProjectResponse(
          await input.projects.cancel({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            ...body,
          }),
        ),
      }),
    });
  });
  app.post("/v1/projects/:projectId/archive", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const { projectId } = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = ArchiveProjectRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.archive:${projectId}`,
      requestPayload: body,
      execute: async () => ({
        statusCode: 200,
        body: toProjectResponse(
          await input.projects.archive({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId,
            ...body,
          }),
        ),
      }),
    });
  });
  app.post("/v1/projects/:projectId/pause", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = PauseProjectRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.pause:${params.projectId}`,
      requestPayload: body,
      execute: async () => ({
        statusCode: 200,
        body: toProjectResponse(
          await input.projects.pause({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            ...body,
          }),
        ),
      }),
    });
  });
  app.post("/v1/projects/:projectId/resume", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = ResumeProjectRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.resume:${params.projectId}`,
      requestPayload: body,
      execute: async () => ({
        statusCode: 200,
        body: toProjectResponse(
          await input.projects.resume({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            ...body,
          }),
        ),
      }),
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
  app.post("/v1/projects/:projectId/risks", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const params = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const body = RegisterProjectRiskRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `project.risk.register:${params.projectId}`,
      requestPayload: body,
      execute: async () => {
        const risk = await input.projects.addRisk({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          projectId: params.projectId,
          ...body,
        });
        return {
          statusCode: 201,
          body: { ...risk, createdAt: risk.createdAt.toISOString() },
        };
      },
    });
  });
  app.get("/v1/projects/:projectId/risks", async (request, reply) => {
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
    return (
      await input.projects.listRisks({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        organizationId,
        projectId,
      })
    ).map((risk) => ({
      ...risk,
      createdAt: risk.createdAt.toISOString(),
      resolvedAt: risk.resolvedAt?.toISOString() ?? null,
    }));
  });
  app.post(
    "/v1/projects/:projectId/risks/:riskId/resolution",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { projectId, riskId } = z
        .object({ projectId: z.string().uuid(), riskId: z.string().uuid() })
        .parse(request.params);
      const body = ResolveProjectRiskRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.risk.resolve:${projectId}:${riskId}`,
        requestPayload: body,
        execute: async () => {
          const risk = await input.projects.resolveRisk({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId,
            riskId,
            ...body,
          });
          return {
            statusCode: 200,
            body: {
              ...risk,
              createdAt: risk.createdAt.toISOString(),
              resolvedAt: risk.resolvedAt?.toISOString() ?? null,
            },
          };
        },
      });
    },
  );
  app.post(
    "/v1/projects/:projectId/operational-decisions",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = RecordProjectOperationalDecisionRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.operational_decision.record:${params.projectId}`,
        requestPayload: body,
        execute: async () => {
          const decision = await input.projects.recordOperationalDecision({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            ...body,
          });
          return {
            statusCode: 201,
            body: { ...decision, decidedAt: decision.decidedAt.toISOString() },
          };
        },
      });
    },
  );
  app.get(
    "/v1/projects/:projectId/operational-decisions",
    async (request, reply) => {
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
      return (
        await input.projects.listOperationalDecisions({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          organizationId,
          projectId,
        })
      ).map((decision) => ({
        ...decision,
        decidedAt: decision.decidedAt.toISOString(),
      }));
    },
  );
  app.post(
    "/v1/projects/:projectId/external-dependencies",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { projectId } = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = AddProjectExternalDependencyRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.external_dependency.add:${projectId}`,
        requestPayload: body,
        execute: async () => {
          const dependency = await input.projects.addExternalDependency({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId,
            ...body,
          });
          return {
            statusCode: 201,
            body: {
              ...dependency,
              createdAt: dependency.createdAt.toISOString(),
            },
          };
        },
      });
    },
  );
  app.get(
    "/v1/projects/:projectId/external-dependencies",
    async (request, reply) => {
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
      return (
        await input.projects.listExternalDependencies({
          actorId: session.actorId,
          correlationId: correlationId(reply),
          organizationId,
          projectId,
        })
      ).map((dependency) => ({
        ...dependency,
        createdAt: dependency.createdAt.toISOString(),
        resolvedAt: dependency.resolvedAt?.toISOString() ?? null,
      }));
    },
  );
  app.post(
    "/v1/projects/:projectId/external-dependencies/:dependencyId/resolution",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { projectId, dependencyId } = z
        .object({
          projectId: z.string().uuid(),
          dependencyId: z.string().uuid(),
        })
        .parse(request.params);
      const body = ResolveProjectExternalDependencyRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.external-dependency.resolve:${projectId}:${dependencyId}`,
        requestPayload: body,
        execute: async () => {
          const dependency = await input.projects.resolveExternalDependency({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId,
            dependencyId,
            ...body,
          });
          return {
            statusCode: 200,
            body: {
              ...dependency,
              createdAt: dependency.createdAt.toISOString(),
              resolvedAt: dependency.resolvedAt?.toISOString() ?? null,
            },
          };
        },
      });
    },
  );
  app.post(
    "/v1/projects/:projectId/change-requests",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { projectId } = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = RequestProjectChangeSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.change.request:${projectId}`,
        requestPayload: body,
        execute: async () => {
          const change = await input.projects.requestChange({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId,
            ...body,
          });
          return {
            statusCode: 201,
            body: { ...change, requestedAt: change.requestedAt.toISOString() },
          };
        },
      });
    },
  );
  app.post(
    "/v1/projects/:projectId/change-requests/:changeRequestId/reviews",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { projectId, changeRequestId } = z
        .object({
          projectId: z.string().uuid(),
          changeRequestId: z.string().uuid(),
        })
        .parse(request.params);
      const body = ReviewProjectChangeRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.change.review:${projectId}:${changeRequestId}`,
        requestPayload: body,
        execute: async () => {
          const result = await input.projects.reviewChangeRequest({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId,
            changeRequestId,
            ...body,
          });
          return {
            statusCode: 200,
            body: {
              changeRequest: {
                ...result.changeRequest,
                requestedAt: result.changeRequest.requestedAt.toISOString(),
                reviewedAt:
                  result.changeRequest.reviewedAt?.toISOString() ?? null,
              },
              baseline: result.baseline
                ? {
                    ...result.baseline,
                    approvedAt: result.baseline.approvedAt.toISOString(),
                    snapshot: {
                      ...result.baseline.snapshot,
                      createdAt:
                        result.baseline.snapshot.createdAt.toISOString(),
                      updatedAt:
                        result.baseline.snapshot.updatedAt.toISOString(),
                    },
                  }
                : null,
            },
          };
        },
      });
    },
  );
  app.get(
    "/v1/organizations/:organizationId/my-work",
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
      const items = await input.projects.listMyWork({
        actorId: session.actorId,
        organizationId,
        correlationId: correlationId(reply),
      });
      return items.map(({ action, kinds }) => ({
        action: {
          ...action,
          completedAt: action.completedAt?.toISOString() ?? null,
          createdAt: action.createdAt.toISOString(),
        },
        kinds,
      }));
    },
  );
  app.get("/v1/projects/:projectId/next-actions", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    const { projectId } = z
      .object({ projectId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const actions = await input.projects.listNextActions({
      actorId: session.actorId,
      correlationId: correlationId(reply),
      projectId,
      ...query,
    });
    return actions.map((action) => ({
      ...action,
      completedAt: action.completedAt?.toISOString() ?? null,
      createdAt: action.createdAt.toISOString(),
    }));
  });
  app.get(
    "/v1/projects/:projectId/next-actions/calendar",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const { projectId } = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({
          organizationId: z.string().uuid(),
          fromOn: z.string().date(),
          toOn: z.string().date(),
          workflowStatus: z
            .enum(["to_do", "in_progress", "in_review", "done", "cancelled"])
            .optional(),
          executorTeamId: z.string().uuid().optional(),
          ownerActorId: z.string().min(1).max(255).optional(),
        })
        .refine((value) => value.fromOn <= value.toOn)
        .parse(request.query);
      const calendar = await input.projects.listTaskCalendar({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        projectId,
        ...query,
      });
      const serialize = (action: (typeof calendar.dated)[number]) => ({
        ...action,
        completedAt: action.completedAt?.toISOString() ?? null,
        createdAt: action.createdAt.toISOString(),
      });
      return {
        dated: calendar.dated.map(serialize),
        undated: calendar.undated.map(serialize),
      };
    },
  );
  app.get(
    "/v1/projects/:projectId/next-actions/:actionId/date-impact",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid(), actionId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({
          organizationId: z.string().uuid(),
          expectedVersion: z
            .string()
            .regex(/^\d+$/)
            .transform(Number)
            .pipe(z.number().int().nonnegative()),
          proposedDueOn: z.string().date().optional(),
        })
        .parse(request.query);
      return input.projects.previewTaskDateChange({
        actorId: session.actorId,
        projectId: params.projectId,
        actionId: params.actionId,
        organizationId: query.organizationId,
        expectedVersion: query.expectedVersion,
        proposedDueOn: query.proposedDueOn ?? null,
        correlationId: correlationId(reply),
      });
    },
  );
  app.post(
    "/v1/projects/:projectId/next-actions/:actionId/date",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid(), actionId: z.string().uuid() })
        .parse(request.params);
      const body = ChangeProjectTaskDateRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.next_action.date:${params.projectId}:${params.actionId}`,
        requestPayload: body,
        execute: async () => {
          const action = await input.projects.changeTaskDate({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            actionId: params.actionId,
            ...body,
          });
          return {
            statusCode: 200,
            body: {
              ...action,
              completedAt: action.completedAt?.toISOString() ?? null,
              createdAt: action.createdAt.toISOString(),
            },
          };
        },
      });
    },
  );
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
  app.post(
    "/v1/projects/:projectId/next-actions/:actionId/workflow",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid(), actionId: z.string().uuid() })
        .parse(request.params);
      const body = TransitionProjectNextActionWorkflowRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.next_action.workflow:${params.projectId}:${params.actionId}`,
        requestPayload: body,
        execute: async () => {
          const action = await input.projects.transitionNextActionWorkflow({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            actionId: params.actionId,
            ...body,
          });
          return {
            statusCode: 200,
            body: {
              ...action,
              completedAt: action.completedAt?.toISOString() ?? null,
              createdAt: action.createdAt.toISOString(),
            },
          };
        },
      });
    },
  );
  app.post(
    "/v1/projects/:projectId/next-actions/:actionId/reorder",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid(), actionId: z.string().uuid() })
        .parse(request.params);
      const body = ReorderProjectNextActionRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.next_action.reorder:${params.projectId}:${params.actionId}`,
        requestPayload: body,
        execute: async () => {
          const action = await input.projects.reorderNextAction({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            actionId: params.actionId,
            ...body,
          });
          return {
            statusCode: 200,
            body: {
              ...action,
              completedAt: action.completedAt?.toISOString() ?? null,
              createdAt: action.createdAt.toISOString(),
            },
          };
        },
      });
    },
  );
  app.post(
    "/v1/projects/:projectId/next-actions/:actionId/claim",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid(), actionId: z.string().uuid() })
        .parse(request.params);
      const body = ClaimProjectNextActionRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.next_action.claim:${params.projectId}:${params.actionId}`,
        requestPayload: body,
        execute: async () => {
          const action = await input.projects.claimNextAction({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            actionId: params.actionId,
            ...body,
          });
          return {
            statusCode: 200,
            body: {
              ...action,
              completedAt: action.completedAt?.toISOString() ?? null,
              createdAt: action.createdAt.toISOString(),
            },
          };
        },
      });
    },
  );
  app.post(
    "/v1/projects/:projectId/next-actions/:actionId/collaborators",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid(), actionId: z.string().uuid() })
        .parse(request.params);
      const body = AddProjectNextActionCollaboratorRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.next_action.collaborator:${params.projectId}:${params.actionId}`,
        requestPayload: body,
        execute: async () => {
          await input.projects.addNextActionCollaborator({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            actionId: params.actionId,
            collaboratorActorId: body.actorId,
            organizationId: body.organizationId,
            expectedVersion: body.expectedVersion,
          });
          return { statusCode: 204, body: null };
        },
      });
    },
  );
  app.get(
    "/v1/projects/:projectId/next-actions/:actionId/collaborators",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid(), actionId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.query);
      return input.projects.listNextActionCollaborators({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        projectId: params.projectId,
        actionId: params.actionId,
        ...query,
      });
    },
  );
  app.post(
    "/v1/projects/:projectId/next-action-dependencies",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = DeclareProjectNextActionDependencyRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `project.next_action.dependency:${params.projectId}`,
        requestPayload: body,
        execute: async () => ({
          statusCode: 201,
          body: await input.projects.declareNextActionDependency({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            projectId: params.projectId,
            ...body,
          }),
        }),
      });
    },
  );
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
    app.post(
      "/v1/organizations/:organizationId/exports",
      async (request, reply) => {
        const session = await requireSession(
          request,
          reply,
          input.auth,
          input.config,
        );
        assertRecentAuthentication(session, input.config);
        if (!input.exports) throw new Error("Export service is not configured");
        const { organizationId } = z
          .object({ organizationId: z.string().uuid() })
          .parse(request.params);
        const job = await input.exports.request({
          actorId: session.actorId,
          organizationId,
          ...ExportRequestSchema.parse(request.body),
        });
        return reply.code(201).send(job);
      },
    );
    app.get(
      "/v1/organizations/:organizationId/exports",
      async (request, reply) => {
        const session = await requireSession(
          request,
          reply,
          input.auth,
          input.config,
        );
        if (!input.exports) throw new Error("Export service is not configured");
        const { organizationId } = z
          .object({ organizationId: z.string().uuid() })
          .parse(request.params);
        return input.exports.list({ actorId: session.actorId, organizationId });
      },
    );
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
        correlationId: correlationId(reply),
        ...(reopen === undefined ? {} : { reopen }),
      });
    });
    app.patch("/v1/comments/:commentId", async (request, reply) => {
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
      return input.comments.edit({
        actorId: session.actorId,
        commentId,
        correlationId: correlationId(reply),
        ...EditCommentRequestSchema.parse(request.body),
      });
    });
    app.delete("/v1/comments/:commentId", async (request, reply) => {
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
      await input.comments.delete({
        actorId: session.actorId,
        commentId,
        correlationId: correlationId(reply),
      });
      return reply.code(204).send();
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
      correlationId: correlationId(reply),
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
      correlationId: correlationId(reply),
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
        correlationId: correlationId(reply),
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
              correlationId: correlationId(reply),
              organizationId: initiative.organizationId,
              initiativeId: initiative.id,
            }),
          ),
        };
      },
    });
  });
  app.post(
    "/v1/initiatives/:initiativeId/operational-priority",
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
      const body = SetInitiativeOperationalPriorityRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `initiative.operational-priority:${params.initiativeId}`,
        requestPayload: body,
        execute: async () => {
          const initiative = await input.initiatives.setOperationalPriority({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
            ...body,
          });
          return {
            statusCode: 200,
            body: await toInitiativeResponse(
              await input.initiatives.detail({
                actorId: session.actorId,
                correlationId: correlationId(reply),
                organizationId: initiative.organizationId,
                initiativeId: initiative.id,
              }),
            ),
          };
        },
      });
    },
  );
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
              correlationId: correlationId(reply),
              organizationId: initiative.organizationId,
              initiativeId: initiative.id,
            }),
          ),
        };
      },
    });
  });
  app.post(
    "/v1/initiatives/:initiativeId/intake-assignments",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.intake) throw new Error("Intake service is not configured");
      const params = z
        .object({ initiativeId: z.string().uuid() })
        .parse(request.params);
      const body = AssignIntakeResponsibilityRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `initiative.intake-assignment:${params.initiativeId}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 201,
          body: toIntakeResponsibilityResponse(
            await input.intake!.assign({
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
  app.post("/v1/initiatives/:initiativeId/triage", async (request, reply) => {
    const session = await requireSession(
      request,
      reply,
      input.auth,
      input.config,
    );
    if (!input.triage) throw new Error("Triage service is not configured");
    const params = z
      .object({ initiativeId: z.string().uuid() })
      .parse(request.params);
    const query = z
      .object({ organizationId: z.string().uuid() })
      .parse(request.query);
    const body = TriageInitiativeRequestSchema.parse(request.body);
    return respondIdempotently({
      request,
      reply,
      store: input.idempotency,
      actorId: session.actorId,
      operation: `initiative.triage:${params.initiativeId}`,
      requestPayload: { query, body },
      execute: async () => ({
        statusCode: 201,
        body: toTriageResponse(
          await input.triage!.triage({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
            ...query,
            ...body,
          }),
        ),
      }),
    });
  });
  app.get(
    "/v1/initiatives/:initiativeId/relationships",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.relationships)
        throw new Error("Initiative relationship service is not configured");
      const params = z
        .object({ initiativeId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.query);
      return (
        await input.relationships.list({
          actorId: session.actorId,
          ...params,
          ...query,
        })
      ).map(toInitiativeRelationshipResponse);
    },
  );
  app.get(
    "/v1/initiatives/:initiativeId/diagnostic",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.diagnostics)
        throw new Error("Diagnostic service is not configured");
      const params = z
        .object({ initiativeId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({ organizationId: z.string().uuid() })
        .parse(request.query);
      const diagnostic = await input.diagnostics.get({
        actorId: session.actorId,
        ...params,
        ...query,
      });
      return diagnostic
        ? { ...diagnostic, savedAt: diagnostic.savedAt.toISOString() }
        : null;
    },
  );
  app.put(
    "/v1/initiatives/:initiativeId/diagnostic",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.diagnostics)
        throw new Error("Diagnostic service is not configured");
      const params = z
        .object({ initiativeId: z.string().uuid() })
        .parse(request.params);
      const body = SaveInitiativeDiagnosticRequestSchema.parse(request.body);
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `initiative.diagnostic:${params.initiativeId}`,
        requestPayload: { params, body },
        execute: async () => {
          const diagnostic = await input.diagnostics!.save({
            actorId: session.actorId,
            correlationId: correlationId(reply),
            ...params,
            ...body,
          });
          return {
            statusCode: 200,
            body: { ...diagnostic, savedAt: diagnostic.savedAt.toISOString() },
          };
        },
      });
    },
  );
  app.post(
    "/v1/initiatives/:initiativeId/relationships",
    async (request, reply) => {
      const session = await requireSession(
        request,
        reply,
        input.auth,
        input.config,
      );
      if (!input.relationships)
        throw new Error("Initiative relationship service is not configured");
      const params = z
        .object({ initiativeId: z.string().uuid() })
        .parse(request.params);
      const body = DeclareInitiativeRelationshipRequestSchema.parse(
        request.body,
      );
      return respondIdempotently({
        request,
        reply,
        store: input.idempotency,
        actorId: session.actorId,
        operation: `initiative.relationship:${params.initiativeId}`,
        requestPayload: { params, body },
        execute: async () => ({
          statusCode: 201,
          body: toInitiativeRelationshipResponse(
            await input.relationships!.declare({
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
                correlationId: correlationId(reply),
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
                correlationId: correlationId(reply),
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
        correlationId: correlationId(reply),
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
      assertRecentAuthentication(session, input.config);
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
      await input.documents.list({
        actorId: session.actorId,
        correlationId: correlationId(reply),
        ...query,
      })
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
  const { initiative, allowedActions, duplicateWarnings } = detail;
  return {
    ...initiative,
    createdAt: initiative.createdAt.toISOString(),
    updatedAt: initiative.updatedAt.toISOString(),
    allowedActions,
    duplicateWarnings: duplicateWarnings.map((warning) => ({
      ...warning,
      createdAt: warning.createdAt.toISOString(),
    })),
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
  evaluation: {
    evaluatedAt: Date;
    annulledAt?: Date | null;
  } & Record<string, unknown>,
) {
  return {
    ...evaluation,
    evaluatedAt: evaluation.evaluatedAt.toISOString(),
    annulledAt: evaluation.annulledAt?.toISOString() ?? null,
  };
}
function toTriageResponse(
  triage: { assessedAt: Date } & Record<string, unknown>,
) {
  return { ...triage, assessedAt: triage.assessedAt.toISOString() };
}
function toInitiativeRelationshipResponse(
  relationship: { declaredAt: Date } & Record<string, unknown>,
) {
  return { ...relationship, declaredAt: relationship.declaredAt.toISOString() };
}
function toIntakeResponsibilityResponse(
  assignment: { assignedAt: Date } & Record<string, unknown>,
) {
  return { ...assignment, assignedAt: assignment.assignedAt.toISOString() };
}
function toUnassignedIntakeExceptionResponse(
  exception: { updatedAt: Date } & Record<string, unknown>,
) {
  return { ...exception, updatedAt: exception.updatedAt.toISOString() };
}
function toEvaluationReviewerAssignmentResponse(
  assignment: {
    assignedAt: Date;
    statusChangedAt: Date;
  } & Record<string, unknown>,
) {
  return {
    ...assignment,
    assignedAt: assignment.assignedAt.toISOString(),
    statusChangedAt: assignment.statusChangedAt.toISOString(),
  };
}
function toDecisionResponse(
  decision: {
    decidedAt: Date;
    conditions?: readonly {
      resolvedAt: Date | null;
    }[];
  } & Record<string, unknown>,
) {
  return {
    ...decision,
    decidedAt: decision.decidedAt.toISOString(),
    conditions: (decision.conditions ?? []).map((condition) => ({
      ...condition,
      resolvedAt: condition.resolvedAt?.toISOString() ?? null,
    })),
  };
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
function toCapacityAvailabilityResponse(
  availability: {
    declaredAt: Date;
  } & Record<string, unknown>,
) {
  return { ...availability, declaredAt: availability.declaredAt.toISOString() };
}
function toCapacityAllocationResponse(
  allocation: {
    declaredAt: Date;
  } & Record<string, unknown>,
) {
  return { ...allocation, declaredAt: allocation.declaredAt.toISOString() };
}
function toCapacityBalanceResponse(balance: {
  availability: { declaredAt: Date } & Record<string, unknown>;
  allocatedEffort: number;
  remainingEffort: number;
  overloadEffort: number;
}) {
  return {
    ...balance,
    availability: toCapacityAvailabilityResponse(balance.availability),
  };
}
function toOrganizationPolicyResponse(policy: {
  organizationId: string;
  dataResidencyRegion: string;
  retentionDays: number;
  businessHours: {
    mode: "disabled" | "audit" | "enforce";
    timezone: string;
    windows: readonly {
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
    }[];
  } | null;
  version: number;
  updatedByActorId: string;
  updatedAt: Date;
}) {
  return {
    ...policy,
    updatedAt: policy.updatedAt.toISOString(),
  };
}
function toWorkspacePolicyOverrideResponse(
  override: {
    organizationId: string;
    workspaceId: string;
    dataResidencyRegion: string | null;
    retentionDays: number | null;
    businessHours: {
      mode: "disabled" | "audit" | "enforce";
      timezone: string;
      windows: readonly {
        dayOfWeek: number;
        startMinute: number;
        endMinute: number;
      }[];
    } | null;
    version: number;
    updatedByActorId: string;
    updatedAt: Date;
  } | null,
) {
  if (!override) return null;
  return {
    ...override,
    updatedAt: override.updatedAt.toISOString(),
  };
}
function toEffectiveTenancyPolicyResponse(policy: {
  organizationId: string;
  workspaceId: string | null;
  dataResidencyRegion: { value: string; origin: "organization" | "workspace" };
  retentionDays: { value: number; origin: "organization" | "workspace" };
  businessHours: {
    value: {
      mode: "disabled" | "audit" | "enforce";
      timezone: string;
      windows: readonly {
        dayOfWeek: number;
        startMinute: number;
        endMinute: number;
      }[];
    };
    origin: "default" | "organization" | "workspace";
  };
  organizationPolicy: Parameters<typeof toOrganizationPolicyResponse>[0];
  workspaceOverride: Parameters<typeof toWorkspacePolicyOverrideResponse>[0];
}) {
  return {
    organizationId: policy.organizationId,
    workspaceId: policy.workspaceId,
    dataResidencyRegion: policy.dataResidencyRegion,
    retentionDays: policy.retentionDays,
    businessHours: policy.businessHours,
    organizationPolicy: toOrganizationPolicyResponse(policy.organizationPolicy),
    workspaceOverride: toWorkspacePolicyOverrideResponse(
      policy.workspaceOverride,
    ),
  };
}
function toTemporaryAccessGrantResponse(
  service: TemporaryAccessGrantService,
  grant: Parameters<TemporaryAccessGrantService["status"]>[0],
) {
  return {
    ...grant,
    createdAt: grant.createdAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
    approvedAt: grant.approvedAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    status: service.status(grant),
  };
}
function toSupportAccessGrantResponse(
  service: SupportAccessService,
  grant: Parameters<SupportAccessService["status"]>[0],
) {
  return {
    ...grant,
    createdAt: grant.createdAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
    approvedAt: grant.approvedAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    status: service.status(grant),
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
  const cached = authenticatedRequestSessions.get(request);
  const session =
    cached ?? (await auth.authenticate(request.cookies[sessionCookie]));
  if (!session) throw new UnauthenticatedError();
  if (!cached) authenticatedRequestSessions.set(request, session);
  reply.setCookie(
    sessionCookie,
    request.cookies[sessionCookie]!,
    sessionCookieOptions(config),
  );
  return session;
}

function assertRecentAuthentication(
  session: AuthSession,
  config: ServerConfig,
  now = new Date(),
): void {
  const maximumAgeMs = config.recentAuthMaxAgeSeconds * 1_000;
  if (now.getTime() - session.createdAt.getTime() > maximumAgeMs)
    throw new RecentAuthenticationRequiredError();
}

class CsrfError extends Error {}
class UnauthenticatedError extends Error {}
class RecentAuthenticationRequiredError extends Error {}
class IdentityEmailRequiredError extends Error {}
class AccountManagementUnavailableError extends Error {}
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
function safeProblemDetail(status: number): string {
  if (status === 401) return "Inicie sesión e intente nuevamente.";
  if (status === 403)
    return "No tiene autorización para realizar esta operación.";
  if (status === 404) return "El recurso solicitado no está disponible.";
  if (status === 409)
    return "La operación entra en conflicto con el estado actual.";
  if (status === 413) return "La carga excede el tamaño permitido.";
  if (status === 429)
    return "Se excedió el límite de solicitudes. Intente más tarde.";
  if (status === 503)
    return "El servicio requerido no está disponible. Intente más tarde.";
  return "La solicitud no cumple los requisitos necesarios.";
}
function validationFieldViolations(error: z.ZodError): Array<{
  field: string;
  code: string;
  message: string;
}> {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "request",
    code: issue.code,
    message: "El valor no cumple el formato requerido.",
  }));
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

type IdempotentResponseInput = {
  request: FastifyRequest;
  reply: FastifyReply;
  store: IdempotencyStore;
  actorId: string;
  operation: string;
  requestPayload: unknown;
  execute: () => Promise<{ statusCode: number; body: unknown }>;
};

async function respondIdempotentlyWhenRequested(
  input: IdempotentResponseInput,
): Promise<FastifyReply> {
  if (typeof input.request.headers["idempotency-key"] !== "string") {
    const response = await input.execute();
    return input.reply.code(response.statusCode).send(response.body);
  }
  return respondIdempotently(input);
}

async function respondIdempotently(
  input: IdempotentResponseInput,
): Promise<FastifyReply> {
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

function problemType(status: number): string {
  const category =
    status === 401
      ? "authentication"
      : status === 403
        ? "authorization"
        : status === 404
          ? "not-found"
          : status === 409
            ? "conflict"
            : status === 413
              ? "payload-too-large"
              : status === 429
                ? "rate-limited"
                : status === 503
                  ? "dependency-unavailable"
                  : "validation";
  return `https://aether.local/problems/${category}`;
}
