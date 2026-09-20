import { z } from "zod";

import { UuidSchema } from "./common.js";

export const CapacityUnitSchema = z.enum(["hours", "days", "points"]);
export const CapacityPeriodSchema = z
  .object({
    startsOn: z.string().date(),
    endsOn: z.string().date(),
  })
  .superRefine((value, context) => {
    if (value.startsOn > value.endsOn)
      context.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "El período no puede terminar antes de comenzar.",
      });
  });

export const DeclareCapacityAvailabilityRequestSchema = z.object({
  availableActorId: z.string().min(1).max(255),
  unit: CapacityUnitSchema,
  period: CapacityPeriodSchema,
  availableEffort: z.number().positive().max(1_000_000),
});

export const CapacityBalanceQuerySchema = z
  .object({
    capacityActorId: z.string().min(1).max(255),
    unit: CapacityUnitSchema,
    periodStartsOn: z.string().date(),
    periodEndsOn: z.string().date(),
  })
  .superRefine((value, context) => {
    if (value.periodStartsOn > value.periodEndsOn)
      context.addIssue({
        code: "custom",
        path: ["periodEndsOn"],
        message: "El período no puede terminar antes de comenzar.",
      });
  });

export const DeclareProjectCapacityAllocationRequestSchema = z.object({
  organizationId: UuidSchema,
  allocatedActorId: z.string().min(1).max(255),
  unit: CapacityUnitSchema,
  period: CapacityPeriodSchema,
  allocatedEffort: z.number().positive().max(1_000_000),
});
