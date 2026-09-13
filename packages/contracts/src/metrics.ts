import { z } from "zod";

import { UuidSchema } from "./common.js";

export const ProductMetricsQuerySchema = z
  .object({
    organizationId: UuidSchema,
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.startsAt &&
      value.endsAt &&
      new Date(value.startsAt) >= new Date(value.endsAt)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startsAt"],
        message: "startsAt must be earlier than endsAt",
      });
  });

export const ProductMetricsResponseSchema = z.object({
  calculationVersion: z.literal("2026-09-v1"),
  timezone: z.literal("UTC"),
  calculatedAt: z.string().datetime(),
  period: z.object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
  initiativeDecision: z.object({
    decidedCount: z.number().int().nonnegative(),
    averageHours: z.number().nonnegative().nullable(),
    medianHours: z.number().nonnegative().nullable(),
  }),
  decisionEvidence: z.object({
    decidedCount: z.number().int().nonnegative(),
    decisionsWithVerifiedEvidence: z.number().int().nonnegative(),
    coveragePercent: z.number().min(0).max(100).nullable(),
  }),
  conversion: z.object({
    approvedDecisions: z.number().int().nonnegative(),
    projectsCreatedFromApprovedDecisions: z.number().int().nonnegative(),
    conversionPercent: z.number().min(0).max(100).nullable(),
  }),
  activeProjects: z.object({
    activeOrBlockedCount: z.number().int().nonnegative(),
    withAssignedLeadCount: z.number().int().nonnegative(),
    withUpcomingMilestoneCount: z.number().int().nonnegative(),
    staleForThirtyDaysCount: z.number().int().nonnegative(),
  }),
  closures: z.object({
    closedCount: z.number().int().nonnegative(),
    withLessonsLearnedCount: z.number().int().nonnegative(),
    lessonsCoveragePercent: z.number().min(0).max(100).nullable(),
  }),
});
export type ProductMetricsResponse = z.infer<
  typeof ProductMetricsResponseSchema
>;
