export const CapacityUnits = ["hours", "days", "points"] as const;
export type CapacityUnit = (typeof CapacityUnits)[number];

export type CapacityPeriod = Readonly<{
  startsOn: string;
  endsOn: string;
}>;

export type CapacityAvailability = Readonly<{
  id: string;
  organizationId: string;
  actorId: string;
  unit: CapacityUnit;
  period: CapacityPeriod;
  availableEffort: number;
  declaredByActorId: string;
  declaredAt: Date;
}>;

export type CapacityAllocation = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  actorId: string;
  unit: CapacityUnit;
  period: CapacityPeriod;
  allocatedEffort: number;
  declaredByActorId: string;
  declaredAt: Date;
}>;

export type CapacityBalance = Readonly<{
  availability: CapacityAvailability;
  allocatedEffort: number;
  remainingEffort: number;
  overloadEffort: number;
}>;

/**
 * Calculates capacity from declared availability and allocations, never from
 * the count of tasks. Only assignments sharing actor, unit and exact period
 * contribute to a balance; the remaining records belong to another measure.
 */
export function calculateCapacityBalance(input: {
  availability: CapacityAvailability;
  allocations: readonly CapacityAllocation[];
}): CapacityBalance {
  assertCapacityPeriod(input.availability.period);
  assertPositiveEffort(input.availability.availableEffort);
  const allocatedEffort = input.allocations
    .filter(
      (allocation) =>
        allocation.organizationId === input.availability.organizationId &&
        allocation.actorId === input.availability.actorId &&
        allocation.unit === input.availability.unit &&
        allocation.period.startsOn === input.availability.period.startsOn &&
        allocation.period.endsOn === input.availability.period.endsOn,
    )
    .reduce((total, allocation) => {
      assertCapacityPeriod(allocation.period);
      assertPositiveEffort(allocation.allocatedEffort);
      return total + allocation.allocatedEffort;
    }, 0);
  const remainingEffort = Math.max(
    0,
    input.availability.availableEffort - allocatedEffort,
  );
  return {
    availability: input.availability,
    allocatedEffort,
    remainingEffort,
    overloadEffort: Math.max(
      0,
      allocatedEffort - input.availability.availableEffort,
    ),
  };
}

export class CapacityDomainError extends Error {
  constructor() {
    super("CAPACITY_INVALID");
    this.name = "CapacityDomainError";
  }
}

function assertCapacityPeriod(period: CapacityPeriod): void {
  if (!period.startsOn || !period.endsOn || period.startsOn > period.endsOn)
    throw new CapacityDomainError();
}

function assertPositiveEffort(effort: number): void {
  if (!Number.isFinite(effort) || effort <= 0) throw new CapacityDomainError();
}
