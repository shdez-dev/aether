import {
  InitiativeDomainError,
  allowedInitiativeActions,
  canCreateInitiative,
  calculateCapabilities,
  createInitiative,
  editInitiative,
  findPotentialInitiativeDuplicates,
  isActionAllowed,
  transitionInitiative,
  setInitiativeOperationalPriority,
  type Initiative,
  type InitiativeAction,
  type InitiativeClassification,
  type InitiativePriority,
  type InitiativeStatus,
} from "@aether/domain";

import type { TenantStore } from "./tenancy.js";
import {
  AccessDeniedError,
  assertWorkspaceWritable,
  ResourceNotFoundError,
} from "./tenancy.js";
import type { TemporaryAccessGrantAuthorizer } from "./access-grants.js";

export type InitiativeAuditEvent = Readonly<{
  id: string;
  eventType: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  actorId: string;
  correlationId: string;
  occurredAt: Date;
  fromStatus: InitiativeStatus | null;
  toStatus: InitiativeStatus | null;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface InitiativeStore {
  create(initiative: Initiative): Promise<void>;
  findById(initiativeId: string): Promise<Initiative | null>;
  list(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Initiative[]>;
  save(input: {
    initiative: Initiative;
    expectedVersion: number;
  }): Promise<boolean>;
}
export interface InitiativeAuditStore {
  record(event: InitiativeAuditEvent): Promise<void>;
  list(input: {
    organizationId: string;
    initiativeId: string;
  }): Promise<readonly InitiativeAuditEvent[]>;
}
export interface InitiativeIdGenerator {
  next(): string;
}
export interface InitiativeClock {
  now(): Date;
}

export type InitiativeAccess = Readonly<{
  initiative: Initiative;
  allowedActions: readonly InitiativeAction[];
  duplicateWarnings: readonly import("@aether/domain").InitiativeDuplicateWarning[];
}>;

export class InitiativeService {
  constructor(
    private readonly dependencies: {
      store: InitiativeStore;
      audit: InitiativeAuditStore;
      tenancy: TenantStore;
      accessGrants?: TemporaryAccessGrantAuthorizer;
      ids: InitiativeIdGenerator;
      clock: InitiativeClock;
    },
  ) {}

  async create(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    correlationId: string;
    title: string;
    problemStatement: string;
    expectedOutcome: string;
    classification: InitiativeClassification;
    requestedPriority: InitiativePriority;
  }): Promise<Initiative> {
    await assertWorkspaceWritable(this.dependencies.tenancy, input.workspaceId);
    await this.assertCreateAllowed(
      input.actorId,
      input.organizationId,
      input.workspaceId,
      input.correlationId,
    );
    const now = this.dependencies.clock.now();
    const initiative = createInitiative({
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      createdByActorId: input.actorId,
      title: input.title,
      problemStatement: input.problemStatement,
      expectedOutcome: input.expectedOutcome,
      classification: input.classification,
      requestedPriority: input.requestedPriority,
      operationalPriority: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.dependencies.store.create(initiative);
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.created.v1",
      null,
      "draft",
      { title: initiative.title },
    );
    return initiative;
  }

  async edit(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    correlationId: string;
    expectedVersion: number;
    title: string;
    problemStatement: string;
    expectedOutcome: string;
    classification: InitiativeClassification;
  }): Promise<Initiative> {
    const current = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      current.workspaceId,
    );
    await this.assertInitiativeAction(
      input.actorId,
      current,
      "edit",
      input.correlationId,
    );
    this.assertVersion(current, input.expectedVersion);
    const updated = editInitiative(
      current,
      {
        title: input.title,
        problemStatement: input.problemStatement,
        expectedOutcome: input.expectedOutcome,
        classification: input.classification,
      },
      this.dependencies.clock.now(),
    );
    await this.save(updated, current.version);
    await this.record(
      updated,
      input.actorId,
      input.correlationId,
      "initiative.edited.v1",
      current.status,
      updated.status,
      {
        changed: [
          "title",
          "problemStatement",
          "expectedOutcome",
          "classification",
        ],
      },
    );
    return updated;
  }

  async detail(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    correlationId?: string;
  }): Promise<InitiativeAccess> {
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await this.assertReadAllowed(
      input.actorId,
      initiative.organizationId,
      initiative.workspaceId,
      "initiative",
      initiative.id,
      input.correlationId,
    );
    return this.toInitiativeAccess(input.actorId, initiative);
  }

  async list(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    correlationId?: string;
  }): Promise<readonly InitiativeAccess[]> {
    await this.assertReadAllowed(
      input.actorId,
      input.organizationId,
      input.workspaceId,
      "workspace",
      input.workspaceId,
      input.correlationId,
    );
    const initiatives = await this.dependencies.store.list({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
    });
    return Promise.all(
      initiatives.map((initiative) =>
        this.toInitiativeAccess(input.actorId, initiative, initiatives),
      ),
    );
  }

  async present(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    correlationId: string;
    expectedVersion: number;
  }): Promise<Initiative> {
    return this.changeState(
      input,
      "presented",
      "present",
      "initiative.presented.v1",
    );
  }
  async startReview(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    correlationId: string;
    expectedVersion: number;
  }): Promise<Initiative> {
    return this.changeState(
      input,
      "under_review",
      "review",
      "initiative.review_started.v1",
    );
  }
  async decide(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    correlationId: string;
    expectedVersion: number;
    decision: "approved" | "rejected";
  }): Promise<Initiative> {
    return this.changeState(
      input,
      input.decision,
      "decide",
      "initiative.decided.v1",
    );
  }

  async auditTrail(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    correlationId?: string;
  }): Promise<readonly InitiativeAuditEvent[]> {
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await this.assertReadAllowed(
      input.actorId,
      initiative.organizationId,
      initiative.workspaceId,
      "initiative",
      initiative.id,
      input.correlationId,
    );
    return this.dependencies.audit.list({
      organizationId: input.organizationId,
      initiativeId: input.initiativeId,
    });
  }

  async setOperationalPriority(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    correlationId: string;
    expectedVersion: number;
    operationalPriority: InitiativePriority;
  }): Promise<Initiative> {
    const current = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      current.workspaceId,
    );
    const { organizationRole, workspaceRole } = await this.rolesFor(
      input.actorId,
      current.organizationId,
      current.workspaceId,
    );
    if (
      !isActionAllowed(
        "organization:manage",
        calculateCapabilities({ organizationRole, workspaceRole }),
      )
    )
      throw new AccessDeniedError("organization:manage");
    this.assertVersion(current, input.expectedVersion);
    const updated = setInitiativeOperationalPriority(
      current,
      input.operationalPriority,
      this.dependencies.clock.now(),
    );
    await this.save(updated, current.version);
    await this.record(
      updated,
      input.actorId,
      input.correlationId,
      "initiative.operational_priority_set.v1",
      current.status,
      updated.status,
      { operationalPriority: updated.operationalPriority },
    );
    return updated;
  }

  private async changeState(
    input: {
      actorId: string;
      organizationId: string;
      initiativeId: string;
      correlationId: string;
      expectedVersion: number;
    },
    target: InitiativeStatus,
    action: InitiativeAction,
    eventType: string,
  ): Promise<Initiative> {
    const current = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      current.workspaceId,
    );
    await this.assertInitiativeAction(
      input.actorId,
      current,
      action,
      input.correlationId,
    );
    this.assertVersion(current, input.expectedVersion);
    const updated = transitionInitiative(
      current,
      target,
      this.dependencies.clock.now(),
    );
    await this.save(updated, current.version);
    await this.record(
      updated,
      input.actorId,
      input.correlationId,
      eventType,
      current.status,
      updated.status,
      {},
    );
    return updated;
  }

  private async requireInitiative(
    initiativeId: string,
    organizationId: string,
  ): Promise<Initiative> {
    const initiative = await this.dependencies.store.findById(initiativeId);
    if (!initiative || initiative.organizationId !== organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    return initiative;
  }
  private async assertCreateAllowed(
    actorId: string,
    organizationId: string,
    workspaceId: string,
    correlationId: string,
  ): Promise<void> {
    const { organizationRole, workspaceRole } = await this.rolesFor(
      actorId,
      organizationId,
      workspaceId,
    );
    if (canCreateInitiative({ organizationRole, workspaceRole })) return;
    if (
      await this.dependencies.accessGrants?.authorize({
        actorId,
        organizationId,
        workspaceId,
        resourceType: "workspace",
        resourceId: workspaceId,
        action: "contribute",
        correlationId,
      })
    )
      return;
    throw new AccessDeniedError("workspace:manage");
  }
  private async assertReadAllowed(
    actorId: string,
    organizationId: string,
    workspaceId: string,
    resourceType: "workspace" | "initiative",
    resourceId: string,
    correlationId?: string,
  ): Promise<void> {
    const { organizationRole, workspaceRole } = await this.rolesFor(
      actorId,
      organizationId,
      workspaceId,
    );
    if (
      isActionAllowed(
        "workspace:read",
        calculateCapabilities({ organizationRole, workspaceRole }),
      )
    )
      return;
    if (
      await this.dependencies.accessGrants?.authorize({
        actorId,
        organizationId,
        workspaceId,
        resourceType,
        resourceId,
        action: "read",
        correlationId: correlationId ?? this.dependencies.ids.next(),
      })
    )
      return;
    throw new AccessDeniedError("workspace:read");
  }
  private async assertInitiativeAction(
    actorId: string,
    initiative: Initiative,
    action: InitiativeAction,
    correlationId: string,
  ): Promise<void> {
    const actions = await this.actionsFor(actorId, initiative);
    if (actions.includes(action)) return;
    if (
      (action === "edit" || action === "present") &&
      (initiative.status === "draft" || initiative.status === "returned") &&
      (await this.dependencies.accessGrants?.authorize({
        actorId,
        organizationId: initiative.organizationId,
        workspaceId: initiative.workspaceId,
        resourceType: "initiative",
        resourceId: initiative.id,
        action: "contribute",
        correlationId,
      }))
    )
      return;
    throw new AccessDeniedError("workspace:manage");
  }
  private async actionsFor(
    actorId: string,
    initiative: Initiative,
  ): Promise<readonly InitiativeAction[]> {
    const { organizationRole, workspaceRole } = await this.rolesFor(
      actorId,
      initiative.organizationId,
      initiative.workspaceId,
    );
    return allowedInitiativeActions({
      organizationRole,
      workspaceRole,
      actorId,
      createdByActorId: initiative.createdByActorId,
      status: initiative.status,
    });
  }
  private async toInitiativeAccess(
    actorId: string,
    initiative: Initiative,
    candidates?: readonly Initiative[],
  ): Promise<InitiativeAccess> {
    const workspaceInitiatives =
      candidates ??
      (await this.dependencies.store.list({
        organizationId: initiative.organizationId,
        workspaceId: initiative.workspaceId,
      }));
    return {
      initiative,
      allowedActions: await this.actionsFor(actorId, initiative),
      duplicateWarnings: findPotentialInitiativeDuplicates({
        reference: initiative,
        candidates: workspaceInitiatives,
      }),
    };
  }
  private async rolesFor(
    actorId: string,
    organizationId: string,
    workspaceId: string,
  ) {
    const workspace =
      await this.dependencies.tenancy.findWorkspace(workspaceId);
    if (!workspace || workspace.organizationId !== organizationId)
      throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
    const [organizationRole, workspaceRole] = await Promise.all([
      this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId,
      }),
      this.dependencies.tenancy.findWorkspaceRole({ actorId, workspaceId }),
    ]);
    return { organizationRole, workspaceRole };
  }
  private assertVersion(initiative: Initiative, expectedVersion: number): void {
    if (initiative.version !== expectedVersion)
      throw new InitiativeVersionConflictError();
  }
  private async save(
    initiative: Initiative,
    expectedVersion: number,
  ): Promise<void> {
    if (!(await this.dependencies.store.save({ initiative, expectedVersion })))
      throw new InitiativeVersionConflictError();
  }
  private async record(
    initiative: Initiative,
    actorId: string,
    correlationId: string,
    eventType: string,
    fromStatus: InitiativeStatus | null,
    toStatus: InitiativeStatus | null,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.dependencies.audit.record({
      id: this.dependencies.ids.next(),
      eventType,
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      actorId,
      correlationId,
      occurredAt: this.dependencies.clock.now(),
      fromStatus,
      toStatus,
      payload,
    });
  }
}

export class InitiativeVersionConflictError extends Error {
  constructor() {
    super("INITIATIVE_VERSION_CONFLICT");
  }
}
export { InitiativeDomainError };
