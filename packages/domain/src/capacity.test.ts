import { describe, expect, it } from "vitest";

import {
  calculateCapacityBalance,
  type CapacityAllocation,
  type CapacityAvailability,
} from "./capacity.js";

const availability: CapacityAvailability = {
  id: "availability",
  organizationId: "organization",
  actorId: "person",
  unit: "hours",
  period: { startsOn: "2026-10-01", endsOn: "2026-10-07" },
  availableEffort: 20,
  declaredByActorId: "manager",
  declaredAt: new Date("2026-09-20T00:00:00.000Z"),
};

describe("calculateCapacityBalance", () => {
  it("calculates overload from explicit availability and allocations, not tasks", () => {
    const allocations: CapacityAllocation[] = [
      {
        id: "allocation-one",
        organizationId: "organization",
        workspaceId: "workspace-one",
        projectId: "project-one",
        actorId: "person",
        unit: "hours",
        period: availability.period,
        allocatedEffort: 12,
        declaredByActorId: "manager",
        declaredAt: availability.declaredAt,
      },
      {
        id: "allocation-two",
        organizationId: "organization",
        workspaceId: "workspace-two",
        projectId: "project-two",
        actorId: "person",
        unit: "hours",
        period: availability.period,
        allocatedEffort: 15,
        declaredByActorId: "manager",
        declaredAt: availability.declaredAt,
      },
      {
        id: "different-unit",
        organizationId: "organization",
        workspaceId: "workspace-one",
        projectId: "project-one",
        actorId: "person",
        unit: "points",
        period: availability.period,
        allocatedEffort: 100,
        declaredByActorId: "manager",
        declaredAt: availability.declaredAt,
      },
    ];

    expect(
      calculateCapacityBalance({ availability, allocations }),
    ).toMatchObject({
      allocatedEffort: 27,
      remainingEffort: 0,
      overloadEffort: 7,
    });
  });
});
