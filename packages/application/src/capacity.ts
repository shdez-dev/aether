import {
  calculateCapacityBalance,
  type CapacityAllocation,
  type CapacityAvailability,
  type CapacityBalance,
  type CapacityPeriod,
  type CapacityUnit,
  type Project,
} from "@aether/domain";

export { CapacityDomainError } from "@aether/domain";

import {
  AccessDeniedError,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";

export interface CapacityStore {
  saveAvailability(availability: CapacityAvailability): Promise<void>;
  saveAllocation(allocation: CapacityAllocation): Promise<void>;
  findAvailability(input: {
    organizationId: string;
    actorId: string;
    unit: CapacityUnit;
    period: CapacityPeriod;
  }): Promise<CapacityAvailability | null>;
  listAllocations(input: {
    organizationId: string;
    actorId: string;
    unit: CapacityUnit;
    period: CapacityPeriod;
  }): Promise<readonly CapacityAllocation[]>;
}

export interface CapacityProjectStore {
  findById(projectId: string): Promise<Project | null>;
}

export interface CapacityClock {
  now(): Date;
}

export interface CapacityIdGenerator {
  next(): string;
}

/**
 * Capacity is an organization-wide planning measure. It intentionally remains
 * independent from the number or status of work items in any project.
 */
export class CapacityService {
  constructor(
    private readonly dependencies: {
      store: CapacityStore;
      projects: CapacityProjectStore;
      tenancy: TenantStore;
      ids: CapacityIdGenerator;
      clock: CapacityClock;
    },
  ) {}

  async declareAvailability(input: {
    actorId: string;
    organizationId: string;
    availableActorId: string;
    unit: CapacityUnit;
    period: CapacityPeriod;
    availableEffort: number;
  }): Promise<CapacityAvailability> {
    await this.assertManager(input.actorId, input.organizationId);
    await this.assertMember(input.availableActorId, input.organizationId);
    const existing = await this.dependencies.store.findAvailability({
      organizationId: input.organizationId,
      actorId: input.availableActorId,
      unit: input.unit,
      period: input.period,
    });
    const availability: CapacityAvailability = {
      id: existing?.id ?? this.dependencies.ids.next(),
      organizationId: input.organizationId,
      actorId: input.availableActorId,
      unit: input.unit,
      period: input.period,
      availableEffort: input.availableEffort,
      declaredByActorId: input.actorId,
      declaredAt: this.dependencies.clock.now(),
    };
    calculateCapacityBalance({ availability, allocations: [] });
    await this.dependencies.store.saveAvailability(availability);
    return availability;
  }

  async allocate(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    allocatedActorId: string;
    unit: CapacityUnit;
    period: CapacityPeriod;
    allocatedEffort: number;
  }): Promise<CapacityAllocation> {
    await this.assertManager(input.actorId, input.organizationId);
    const project = await this.dependencies.projects.findById(input.projectId);
    if (!project || project.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("PROJECT_NOT_FOUND");
    await this.assertMember(input.allocatedActorId, input.organizationId);
    if (
      !(await this.dependencies.tenancy.findWorkspaceRole({
        actorId: input.allocatedActorId,
        workspaceId: project.workspaceId,
      }))
    )
      throw new AccessDeniedError("workspace:read");
    if (
      !project.participants.some(
        (participant) => participant.actorId === input.allocatedActorId,
      )
    )
      throw new AccessDeniedError("workspace:read");
    const allocation: CapacityAllocation = {
      id: this.dependencies.ids.next(),
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: input.allocatedActorId,
      unit: input.unit,
      period: input.period,
      allocatedEffort: input.allocatedEffort,
      declaredByActorId: input.actorId,
      declaredAt: this.dependencies.clock.now(),
    };
    calculateCapacityBalance({
      availability: {
        id: "validation",
        organizationId: allocation.organizationId,
        actorId: allocation.actorId,
        unit: allocation.unit,
        period: allocation.period,
        availableEffort: allocation.allocatedEffort,
        declaredByActorId: allocation.declaredByActorId,
        declaredAt: allocation.declaredAt,
      },
      allocations: [allocation],
    });
    await this.dependencies.store.saveAllocation(allocation);
    return allocation;
  }

  async balance(input: {
    actorId: string;
    organizationId: string;
    capacityActorId: string;
    unit: CapacityUnit;
    period: CapacityPeriod;
  }): Promise<CapacityBalance | null> {
    await this.assertManager(input.actorId, input.organizationId);
    const availability = await this.dependencies.store.findAvailability({
      organizationId: input.organizationId,
      actorId: input.capacityActorId,
      unit: input.unit,
      period: input.period,
    });
    if (!availability) return null;
    const allocations = await this.dependencies.store.listAllocations({
      organizationId: input.organizationId,
      actorId: input.capacityActorId,
      unit: input.unit,
      period: input.period,
    });
    return calculateCapacityBalance({ availability, allocations });
  }

  private async assertManager(
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (role !== "owner" && role !== "admin")
      throw new AccessDeniedError("organization:manage");
  }

  private async assertMember(
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    if (
      !(await this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId,
      }))
    )
      throw new AccessDeniedError("organization:read");
  }
}
