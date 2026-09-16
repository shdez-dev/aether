import { z } from "zod";

import { CorrelationIdSchema } from "./common.js";

export const ApiProblemCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_REQUEST_IN_PROGRESS",
  "PRECONDITION_FAILED",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "DEPENDENCY_UNAVAILABLE",
  "INVITATION_INVALID_OR_EXPIRED",
  "INVITATION_NOT_FOUND",
  "INVITATION_NOT_PENDING",
  "OIDC_PROVIDER_UNAVAILABLE",
  "RECENT_AUTH_REQUIRED",
  "WORKSPACE_ARCHIVED",
  "TARGET_MUST_BE_DIFFERENT",
  "TARGET_MUST_BE_MEMBER",
  "TARGET_NOT_MEMBER",
  "TARGET_IS_OWNER",
  "TARGET_HAS_OPEN_RESPONSIBILITIES",
  "REPLACEMENT_NOT_ACTIVE",
  "REPLACEMENT_CONFLICTS_WITH_PROJECT_ROLE",
  "INTERNAL_ERROR",
]);

export const FieldViolationSchema = z.object({
  field: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const ApiProblemSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  code: ApiProblemCodeSchema,
  detail: z.string().min(1),
  instance: z.string().min(1).optional(),
  correlationId: CorrelationIdSchema,
  errors: z.array(FieldViolationSchema).min(1).optional(),
});

export type ApiProblem = z.infer<typeof ApiProblemSchema>;
