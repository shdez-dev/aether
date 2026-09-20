import { describe, expect, it } from "vitest";

import {
  createProject,
  type CapacityAllocation,
  type CapacityAvailability,
} from "@aether/domain";

import { CapacityService, type CapacityStore } from "./capacity.js";
import type { TenantStore } from "./tenancy.js";

describe("CapacityService", () => {
  it("keeps availability and allocations independent from project task counts", async () => {
    const project = createProject({
      id: "project",
      organizationId: "organization",
      workspaceId: "workspace",
      sourceInitiativeId: "initiative",
      sourceDecisionId: "decision",
      name: "Project",
      objective: "Objective",
      boundaries: "Boundaries",
      successCriteria: "Criterion",
      nextMilestone: "Milestone",
      sponsorActorId: "manager",
      leadActorId: "person",
      participants: [
        { actorId: "manager", role: "sponsor" },
        { actorId: "person", role: "lead" },
      ],
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    });
    const availabilities: CapacityAvailability[] = [];
    const allocations: CapacityAllocation[] = [];
    const store: CapacityStore = {
      async saveAvailability(availability) {
        availabilities.splice(0, availabilities.length, availability);
      },
      async saveAllocation(allocation) {
        allocations.push(allocation);
      },
      async findAvailability(input) {
        return (
          availabilities.find(
            (availability) =>
              availability.organizationId === input.organizationId &&
              availability.actorId === input.actorId &&
              availability.unit === input.unit &&
              availability.period.startsOn === input.period.startsOn &&
              availability.period.endsOn === input.period.endsOn,
          ) ?? null
        );
      },
      async listAllocations() {
        return allocations;
      },
    };
    let sequence = 0;
    const service = new CapacityService({
      store,
      projects: {
        async findById() {
          return project;
        },
      },
      tenancy: {
        async findOrganizationRole() {
          return "owner";
        },
        async findWorkspaceRole() {
          return "member";
        },
      } as unknown as TenantStore,
      ids: { next: () => `capacity-${++sequence}` },
      clock: { now: () => new Date("2026-09-20T00:00:00.000Z") },
    });
    const period = { startsOn: "2026-10-01", endsOn: "2026-10-07" };
    await service.declareAvailability({
      actorId: "manager",
      organizationId: "organization",
      availableActorId: "person",
      unit: "hours",
      period,
      availableEffort: 20,
    });
    await service.allocate({
      actorId: "manager",
      organizationId: "organization",
      projectId: project.id,
      allocatedActorId: "person",
      unit: "hours",
      period,
      allocatedEffort: 12,
    });
    await service.allocate({
      actorId: "manager",
      organizationId: "organization",
      projectId: project.id,
      allocatedActorId: "person",
      unit: "hours",
      period,
      allocatedEffort: 15,
    });

    await expect(
      service.balance({
        actorId: "manager",
        organizationId: "organization",
        capacityActorId: "person",
        unit: "hours",
        period,
      }),
    ).resolves.toMatchObject({ allocatedEffort: 27, overloadEffort: 7 });
  });
});
