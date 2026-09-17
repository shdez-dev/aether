import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  ProductMetricsRangeError,
  ProductMetricsService,
  type ProductMetricsSnapshot,
} from "@aether/application";

import { InMemoryProductMetricsStore } from "./metrics.js";
import { InMemoryTenantStore } from "./tenancy.js";

const startsAt = new Date("2026-01-01T00:00:00.000Z");
const endsAt = new Date("2026-04-01T00:00:00.000Z");
const calculatedAt = new Date("2026-04-01T12:00:00.000Z");

function snapshot(): ProductMetricsSnapshot {
  return {
    calculationVersion: "2026-09-v1",
    timezone: "UTC",
    calculatedAt,
    period: { startsAt, endsAt },
    initiativeDecision: {
      decidedCount: 2,
      averageHours: 36,
      medianHours: 36,
    },
    decisionEvidence: {
      decidedCount: 2,
      decisionsWithVerifiedEvidence: 1,
      coveragePercent: 50,
    },
    conversion: {
      approvedDecisions: 1,
      projectsCreatedFromApprovedDecisions: 1,
      conversionPercent: 100,
    },
    activeProjects: {
      activeOrBlockedCount: 1,
      withAssignedLeadCount: 1,
      withUpcomingMilestoneCount: 1,
      staleForThirtyDaysCount: 0,
    },
    closures: {
      closedCount: 1,
      withLessonsLearnedCount: 1,
      lessonsCoveragePercent: 100,
    },
  };
}

describe("institutional product metrics", () => {
  it("returns the exact versioned aggregate only for an organization manager", async () => {
    const tenancy = new InMemoryTenantStore();
    const organizationId = "00000000-0000-4000-8000-000000000001";
    await tenancy.bootstrapOrganization({
      organization: {
        id: organizationId,
        name: "Aether",
        organizationType: null,
        timezone: "America/Santiago",
        locale: "es-CL",
        version: 0,
      },
      ownerActorId: "owner",
      ownerEmail: "owner@example.test",
    });
    const store = new InMemoryProductMetricsStore();
    const expected = snapshot();
    store.setSnapshot(organizationId, expected);
    const service = new ProductMetricsService({
      store,
      tenancy,
      clock: { now: () => calculatedAt },
    });

    await expect(
      service.snapshot({ actorId: "owner", organizationId, startsAt, endsAt }),
    ).resolves.toEqual(expected);
    expect(store.calls).toEqual([
      { organizationId, startsAt, endsAt, calculatedAt },
    ]);
  });

  it("does not query another organization's aggregate and rejects invalid ranges", async () => {
    const tenancy = new InMemoryTenantStore();
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
    await tenancy.bootstrapOrganization({
      organization: {
        id: organizationId,
        name: "Aether",
        organizationType: null,
        timezone: "UTC",
        locale: "es-CL",
        version: 0,
      },
      ownerActorId: "owner",
      ownerEmail: "owner@example.test",
    });
    await tenancy.bootstrapOrganization({
      organization: {
        id: otherOrganizationId,
        name: "Other",
        organizationType: null,
        timezone: "UTC",
        locale: "es-CL",
        version: 0,
      },
      ownerActorId: "other-owner",
      ownerEmail: "other@example.test",
    });
    const store = new InMemoryProductMetricsStore();
    store.setSnapshot(organizationId, snapshot());
    const service = new ProductMetricsService({
      store,
      tenancy,
      clock: { now: () => calculatedAt },
    });

    await expect(
      service.snapshot({
        actorId: "owner",
        organizationId: otherOrganizationId,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(store.calls).toHaveLength(0);
    await expect(
      service.snapshot({
        actorId: "owner",
        organizationId,
        startsAt: endsAt,
        endsAt,
      }),
    ).rejects.toBeInstanceOf(ProductMetricsRangeError);
  });
});
