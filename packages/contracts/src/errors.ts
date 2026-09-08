import { z } from "zod";

import { CorrelationIdSchema } from "./common.js";

export const ApiProblemCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
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
  detail: z.string().min(1).optional(),
  instance: z.string().min(1).optional(),
  correlationId: CorrelationIdSchema,
  errors: z.array(FieldViolationSchema).min(1).optional(),
});

export type ApiProblem = z.infer<typeof ApiProblemSchema>;
