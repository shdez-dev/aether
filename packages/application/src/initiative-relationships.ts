import {
  declareInitiativeRelationship,
  type InitiativeRelationship,
  type InitiativeRelationshipKind,
} from "@aether/domain";

import type { InitiativeAuditStore, InitiativeStore } from "./initiatives.js";
import { InitiativeVersionConflictError } from "./initiatives.js";
import {
  AccessDeniedError,
  assertWorkspaceWritable,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";

export interface InitiativeRelationshipStore {
  create(relationship: InitiativeRelationship): Promise<void>;
  list(input: {
    organizationId: string;
    initiativeId: string;
  }): Promise<readonly InitiativeRelationship[]>;
}
export interface InitiativeRelationshipIdGenerator {
  next(): string;
}
export interface InitiativeRelationshipClock {
  now(): Date;
}

export class InitiativeRelationshipService {
  constructor(
    private readonly dependencies: {
      relationships: InitiativeRelationshipStore;
      initiatives: InitiativeStore;
      audit: InitiativeAuditStore;
      tenancy: TenantStore;
      ids: InitiativeRelationshipIdGenerator;
      clock: InitiativeRelationshipClock;
    },
  ) {}

  async declare(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    expectedVersion: number;
    targetInitiativeId: string;
    kind: InitiativeRelationshipKind;
    correlationId: string;
  }): Promise<InitiativeRelationship> {
    const source = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    const target = await this.requireInitiative(
      input.targetInitiativeId,
      input.organizationId,
    );
    if (source.workspaceId !== target.workspaceId)
      throw new InitiativeRelationshipScopeError();
    if (source.version !== input.expectedVersion)
      throw new InitiativeVersionConflictError();
    if (source.status !== "draft" && source.status !== "returned")
      throw new InitiativeRelationshipStateError();
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      source.workspaceId,
    );
    await this.assertCanDeclare(input.actorId, source);
    await this.assertCanRead(input.actorId, target);
    const relationship = declareInitiativeRelationship({
      id: this.dependencies.ids.next(),
      organizationId: source.organizationId,
      workspaceId: source.workspaceId,
      sourceInitiativeId: source.id,
      targetInitiativeId: target.id,
      kind: input.kind,
      declaredByActorId: input.actorId,
      declaredAt: this.dependencies.clock.now(),
    });
    await this.dependencies.relationships.create(relationship);
    await this.dependencies.audit.record({
      id: this.dependencies.ids.next(),
      eventType: "initiative.relationship_declared.v1",
      organizationId: source.organizationId,
      workspaceId: source.workspaceId,
      initiativeId: source.id,
      actorId: input.actorId,
      correlationId: input.correlationId,
      occurredAt: relationship.declaredAt,
      fromStatus: source.status,
      toStatus: source.status,
      payload: {
        relationshipId: relationship.id,
        targetInitiativeId: target.id,
        kind: relationship.kind,
      },
    });
    return relationship;
  }

  async list(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
  }): Promise<readonly InitiativeRelationship[]> {
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await this.assertCanRead(input.actorId, initiative);
    return this.dependencies.relationships.list({
      organizationId: input.organizationId,
      initiativeId: input.initiativeId,
    });
  }

  private async requireInitiative(
    initiativeId: string,
    organizationId: string,
  ) {
    const initiative =
      await this.dependencies.initiatives.findById(initiativeId);
    if (!initiative || initiative.organizationId !== organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    return initiative;
  }
  private async assertCanDeclare(
    actorId: string,
    initiative: Awaited<ReturnType<InitiativeStore["findById"]>> & {},
  ) {
    const [organizationRole, workspaceRole] = await Promise.all([
      this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId: initiative.organizationId,
      }),
      this.dependencies.tenancy.findWorkspaceRole({
        actorId,
        workspaceId: initiative.workspaceId,
      }),
    ]);
    if (
      actorId === initiative.createdByActorId &&
      (organizationRole !== null || workspaceRole !== null)
    )
      return;
    throw new AccessDeniedError("workspace:manage");
  }
  private async assertCanRead(
    actorId: string,
    initiative: Awaited<ReturnType<InitiativeStore["findById"]>> & {},
  ) {
    const [organizationRole, workspaceRole] = await Promise.all([
      this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId: initiative.organizationId,
      }),
      this.dependencies.tenancy.findWorkspaceRole({
        actorId,
        workspaceId: initiative.workspaceId,
      }),
    ]);
    if (organizationRole || workspaceRole) return;
    throw new AccessDeniedError("workspace:read");
  }
}

export class InitiativeRelationshipScopeError extends Error {}
export class InitiativeRelationshipStateError extends Error {}
