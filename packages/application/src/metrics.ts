import { AccessDeniedError, type TenantStore } from "./tenancy.js";

/**
 * Contract semantics are intentionally versioned. Consumers must retain this
 * value with any exported series so a later definition cannot rewrite history.
 */
export const productMetricsCalculationVersion = "2026-09-v1";
export const productMetricsTimezone = "UTC";

export type ProductMetricsSnapshot = Readonly<{
  calculationVersion: typeof productMetricsCalculationVersion;
  timezone: typeof productMetricsTimezone;
  calculatedAt: Date;
  period: Readonly<{ startsAt: Date; endsAt: Date }>;
  initiativeDecision: Readonly<{
    decidedCount: number;
    averageHours: number | null;
    medianHours: number | null;
  }>;
  decisionEvidence: Readonly<{
    decidedCount: number;
    decisionsWithVerifiedEvidence: number;
    coveragePercent: number | null;
  }>;
  conversion: Readonly<{
    approvedDecisions: number;
    projectsCreatedFromApprovedDecisions: number;
    conversionPercent: number | null;
  }>;
  activeProjects: Readonly<{
    activeOrBlockedCount: number;
    withAssignedLeadCount: number;
    withUpcomingMilestoneCount: number;
    staleForThirtyDaysCount: number;
  }>;
  closures: Readonly<{
    closedCount: number;
    withLessonsLearnedCount: number;
    lessonsCoveragePercent: number | null;
  }>;
}>;

export interface ProductMetricsStore {
  snapshot(input: {
    organizationId: string;
    startsAt: Date;
    endsAt: Date;
    calculatedAt: Date;
  }): Promise<ProductMetricsSnapshot>;
}

export interface ProductMetricsClock {
  now(): Date;
}

/**
 * Organization-level product metrics are an administrative aggregate. They
 * never accept a workspace scope, which prevents a partial workspace view
 * from being presented as institutional coverage.
 */
export class ProductMetricsService {
  constructor(
    private readonly dependencies: {
      store: ProductMetricsStore;
      tenancy: TenantStore;
      clock: ProductMetricsClock;
    },
  ) {}

  async snapshot(input: {
    actorId: string;
    organizationId: string;
    startsAt?: Date;
    endsAt?: Date;
  }): Promise<ProductMetricsSnapshot> {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId: input.actorId,
      organizationId: input.organizationId,
    });
    if (role !== "owner" && role !== "admin")
      throw new AccessDeniedError("organization:manage");

    const calculatedAt = this.dependencies.clock.now();
    const endsAt = input.endsAt ?? calculatedAt;
    const startsAt =
      input.startsAt ?? new Date(endsAt.getTime() - 90 * 86_400_000);
    if (startsAt >= endsAt) throw new ProductMetricsRangeError();
    return this.dependencies.store.snapshot({
      organizationId: input.organizationId,
      startsAt,
      endsAt,
      calculatedAt,
    });
  }
}

export class ProductMetricsRangeError extends Error {
  constructor() {
    super("Product metrics start must be earlier than end");
  }
}
