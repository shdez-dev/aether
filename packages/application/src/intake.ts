import {
  assignIntakeResponsibility,
  IntakeDomainError,
  type IntakeResponsibility,
} from "@aether/domain";

import {
  InitiativeVersionConflictError,
  type InitiativeAuditEvent,
  type InitiativeStore,
} from "./initiatives.js";
import {
  AccessDeniedError,
  assertWorkspaceWritable,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";

export type UnassignedIntakeException = Readonly<{
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  title: string;
  updatedAt: Date;
}>;

export interface IntakeAssignmentStore {
  createWithAudit(input: {
    assignment: IntakeResponsibility;
    auditEvent: InitiativeAuditEvent;
  }): Promise<void>;
  findActiveByInitiative(
    initiativeId: string,
  ): Promise<IntakeResponsibility | null>;
  listUnassigned(input: {
    organizationId: string;
  }): Promise<readonly UnassignedIntakeException[]>;
}

export interface IntakeIdGenerator {
  next(): string;
}
export interface IntakeClock {
  now(): Date;
}

export class IntakeService {
  constructor(
    private readonly dependencies: {
      assignments: IntakeAssignmentStore;
      initiatives: InitiativeStore;
      tenancy: TenantStore;
      ids: IntakeIdGenerator;
      clock: IntakeClock;
    },
  ) {}

  async assign(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    expectedVersion: number;
    responsibleActorId: string;
    nextReviewOn: string;
    correlationId: string;
  }): Promise<IntakeResponsibility> {
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    const initiative = await this.dependencies.initiatives.findById(
      input.initiativeId,
    );
    if (!initiative || initiative.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    if (initiative.status !== "presented")
      throw new IntakeDomainError("INTAKE_NOT_ALLOWED_FOR_INITIATIVE_STATE");
    if (initiative.version !== input.expectedVersion)
      throw new InitiativeVersionConflictError();
    await this.assertResponsibleCanAccessWorkspace(
      input.responsibleActorId,
      initiative.organizationId,
      initiative.workspaceId,
    );
    if (
      await this.dependencies.assignments.findActiveByInitiative(initiative.id)
    )
      throw new IntakeDomainError("INTAKE_ALREADY_ASSIGNED");
    const assignment = assignIntakeResponsibility({
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      responsibleActorId: input.responsibleActorId,
      assignedByActorId: input.actorId,
      assignedAt: this.dependencies.clock.now(),
      nextReviewOn: input.nextReviewOn,
    });
    const auditEvent: InitiativeAuditEvent = {
      id: this.dependencies.ids.next(),
      eventType: "initiative.intake_assigned.v1",
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      actorId: input.actorId,
      correlationId: input.correlationId,
      occurredAt: assignment.assignedAt,
      fromStatus: initiative.status,
      toStatus: initiative.status,
      payload: {
        assignmentId: assignment.id,
        responsibleActorId: assignment.responsibleActorId,
        nextReviewOn: assignment.nextReviewOn,
      },
    };
    await this.dependencies.assignments.createWithAudit({ assignment, auditEvent });
    return assignment;
  }

  async listUnassigned(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly UnassignedIntakeException[]> {
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    return this.dependencies.assignments.listUnassigned({
      organizationId: input.organizationId,
    });
  }

  private async assertOrganizationManager(actorId: string, organizationId: string) {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (role !== "owner" && role !== "admin")
      throw new AccessDeniedError("organization:manage");
  }

  private async assertResponsibleCanAccessWorkspace(
    actorId: string,
    organizationId: string,
    workspaceId: string,
  ) {
    const organizationRole = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (organizationRole === "owner" || organizationRole === "admin") return;
    if (organizationRole && (await this.dependencies.tenancy.findWorkspaceRole({ actorId, workspaceId })))
      return;
    throw new AccessDeniedError("workspace:manage");
  }
}

export { IntakeDomainError };
