import {
  ProjectDomainError,
  createProject,
  transitionProject,
  type InitiativeDecision,
  type Project,
  type ProjectMilestone,
  type ProjectNextAction,
  type ProjectClosure,
  type ProjectDeliverableAcceptance,
  type ProjectParticipant,
  type ProjectStatus,
} from "@aether/domain";

import {
  AccessDeniedError,
  assertWorkspaceWritable,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";
import type { InitiativeStore } from "./initiatives.js";
import type { DurableDomainEvent } from "./outbox.js";
import { DocumentNotFoundError, type DocumentStore } from "./documents.js";
import type { TemporaryAccessGrantAuthorizer } from "./access-grants.js";

export type ProjectAuditEvent = Readonly<{
  id: string;
  eventType: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  actorId: string;
  correlationId: string;
  occurredAt: Date;
  payload: Readonly<Record<string, unknown>>;
}>;
export interface ProjectStore {
  create(project: Project): Promise<void>;
  findById(projectId: string): Promise<Project | null>;
  findByInitiative(initiativeId: string): Promise<Project | null>;
  list(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Project[]>;
  save(input: { project: Project; expectedVersion: number }): Promise<boolean>;
  createWithEvent?(input: {
    project: Project;
    event: DurableDomainEvent;
  }): Promise<void>;
  saveWithEvent?(input: {
    project: Project;
    expectedVersion: number;
    event: DurableDomainEvent;
  }): Promise<boolean>;
}
export interface ProjectExecutionStore {
  addMilestone(milestone: ProjectMilestone): Promise<void>;
  addNextAction(action: ProjectNextAction): Promise<void>;
}
export interface ProjectClosureStore {
  createClosure(closure: ProjectClosure): Promise<void>;
  findClosure(projectId: string): Promise<ProjectClosure | null>;
  acceptDeliverable(acceptance: ProjectDeliverableAcceptance): Promise<void>;
}
export interface ProjectAuditStore {
  record(event: ProjectAuditEvent): Promise<void>;
  list(input: {
    organizationId: string;
    projectId: string;
  }): Promise<readonly ProjectAuditEvent[]>;
}
export interface ProjectDecisionLookup {
  findDecision(decisionId: string): Promise<InitiativeDecision | null>;
}
export interface ProjectIdGenerator {
  next(): string;
}
export interface ProjectClock {
  now(): Date;
}

export class ProjectService {
  constructor(
    private readonly dependencies: {
      projects: ProjectStore;
      execution: ProjectExecutionStore;
      closures: ProjectClosureStore;
      documents: DocumentStore;
      audit: ProjectAuditStore;
      decisions: ProjectDecisionLookup;
      initiatives: InitiativeStore;
      tenancy: TenantStore;
      accessGrants?: TemporaryAccessGrantAuthorizer;
      ids: ProjectIdGenerator;
      clock: ProjectClock;
    },
  ) {}
  async createFromInitiative(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    decisionId: string;
    name: string;
    sponsorActorId: string;
    leadActorId: string;
    participants: readonly ProjectParticipant[];
    correlationId: string;
  }): Promise<Project> {
    await this.assertOwner(input.actorId, input.organizationId);
    const initiative = await this.dependencies.initiatives.findById(
      input.initiativeId,
    );
    const decision = await this.dependencies.decisions.findDecision(
      input.decisionId,
    );
    if (
      !initiative ||
      initiative.organizationId !== input.organizationId ||
      initiative.status !== "approved" ||
      !decision ||
      decision.initiativeId !== initiative.id ||
      decision.outcome !== "approved"
    )
      throw new ProjectDomainError("INVALID_PROJECT_TRANSITION");
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    if (await this.dependencies.projects.findByInitiative(initiative.id))
      throw new ProjectAlreadyExistsError();
    await Promise.all(
      [
        input.sponsorActorId,
        input.leadActorId,
        ...input.participants.map((participant) => participant.actorId),
      ].map((actorId) => this.assertMember(actorId, input.organizationId)),
    );
    const now = this.dependencies.clock.now();
    const project = createProject({
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      sourceInitiativeId: initiative.id,
      sourceDecisionId: decision.id,
      name: input.name,
      sponsorActorId: input.sponsorActorId,
      leadActorId: input.leadActorId,
      participants: input.participants,
      createdAt: now,
      updatedAt: now,
    });
    const event = this.eventFor(
      project,
      input.correlationId,
      "project.created.v1",
      { initiativeId: initiative.id, decisionId: decision.id },
    );
    if (this.dependencies.projects.createWithEvent)
      await this.dependencies.projects.createWithEvent({ project, event });
    else await this.dependencies.projects.create(project);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.created_from_initiative.v1",
      {
        initiativeId: initiative.id,
        decisionId: decision.id,
        sponsorActorId: project.sponsorActorId,
        leadActorId: project.leadActorId,
      },
    );
    return project;
  }
  async changeStatus(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    expectedVersion: number;
    status: ProjectStatus;
    correlationId: string;
  }): Promise<Project> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    if (project.version !== input.expectedVersion)
      throw new ProjectVersionConflictError();
    const updated = transitionProject(
      project,
      input.status,
      this.dependencies.clock.now(),
    );
    const event = this.eventFor(
      updated,
      input.correlationId,
      "project.status_changed.v1",
      { fromStatus: project.status, toStatus: updated.status },
    );
    const saved = this.dependencies.projects.saveWithEvent
      ? await this.dependencies.projects.saveWithEvent({
          project: updated,
          expectedVersion: project.version,
          event,
        })
      : await this.dependencies.projects.save({
          project: updated,
          expectedVersion: project.version,
        });
    if (!saved) throw new ProjectVersionConflictError();
    await this.record(
      updated,
      input.actorId,
      input.correlationId,
      "project.status_changed.v1",
      { fromStatus: project.status, toStatus: updated.status },
    );
    return updated;
  }
  async addMilestone(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    title: string;
    dueOn: string | null;
    correlationId: string;
  }): Promise<ProjectMilestone> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    const milestone: ProjectMilestone = {
      id: this.dependencies.ids.next(),
      projectId: project.id,
      title: input.title,
      dueOn: input.dueOn,
      completedAt: null,
      createdByActorId: input.actorId,
      createdAt: this.dependencies.clock.now(),
    };
    await this.dependencies.execution.addMilestone(milestone);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.milestone_added.v1",
      { milestoneId: milestone.id },
    );
    return milestone;
  }
  async addNextAction(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    description: string;
    ownerActorId: string;
    dueOn: string | null;
    correlationId: string;
  }): Promise<ProjectNextAction> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    await this.assertMember(input.ownerActorId, project.organizationId);
    const action: ProjectNextAction = {
      id: this.dependencies.ids.next(),
      projectId: project.id,
      description: input.description,
      ownerActorId: input.ownerActorId,
      dueOn: input.dueOn,
      completedAt: null,
      createdByActorId: input.actorId,
      createdAt: this.dependencies.clock.now(),
    };
    await this.dependencies.execution.addNextAction(action);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.next_action_added.v1",
      { actionId: action.id, ownerActorId: action.ownerActorId },
    );
    return action;
  }
  async acceptDeliverable(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    name: string;
    documentId: string;
    documentVersionId: string;
    correlationId: string;
  }): Promise<ProjectDeliverableAcceptance> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    const document = await this.dependencies.documents.findVersion({
      documentId: input.documentId,
      versionId: input.documentVersionId,
    });
    if (
      !document ||
      document.document.organizationId !== project.organizationId ||
      document.document.workspaceId !== project.workspaceId ||
      document.version.status !== "published"
    )
      throw new DocumentNotFoundError();
    const acceptance: ProjectDeliverableAcceptance = {
      id: this.dependencies.ids.next(),
      projectId: project.id,
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      name: input.name,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      acceptedByActorId: input.actorId,
      acceptedAt: this.dependencies.clock.now(),
    };
    await this.dependencies.closures.acceptDeliverable(acceptance);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.deliverable_accepted.v1",
      {
        deliverableAcceptanceId: acceptance.id,
        documentId: acceptance.documentId,
        documentVersionId: acceptance.documentVersionId,
      },
    );
    return acceptance;
  }
  async close(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    outcomes: string;
    lessonsLearned: string;
    pendingItems: readonly string[];
    correlationId: string;
  }): Promise<ProjectClosure> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    if (project.status !== "completed")
      throw new ProjectDomainError("INVALID_PROJECT_TRANSITION");
    if (await this.dependencies.closures.findClosure(project.id))
      throw new ProjectAlreadyClosedError();
    const closure: ProjectClosure = {
      id: this.dependencies.ids.next(),
      projectId: project.id,
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      outcomes: input.outcomes,
      lessonsLearned: input.lessonsLearned,
      pendingItems: [...input.pendingItems],
      closedByActorId: input.actorId,
      closedAt: this.dependencies.clock.now(),
    };
    await this.dependencies.closures.createClosure(closure);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.closed.v1",
      {
        closureId: closure.id,
        pendingItems: closure.pendingItems.length,
      },
    );
    return closure;
  }
  async auditTrail(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    correlationId?: string;
  }): Promise<readonly ProjectAuditEvent[]> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertProjectRead(input.actorId, project, input.correlationId);
    return this.dependencies.audit.list({
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
  }
  async list(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Project[]> {
    await this.assertMember(input.actorId, input.organizationId);
    return this.dependencies.projects.list(input);
  }
  async detail(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    correlationId?: string;
  }): Promise<Project> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertProjectRead(input.actorId, project, input.correlationId);
    return project;
  }
  private async requireProject(
    projectId: string,
    organizationId: string,
  ): Promise<Project> {
    const project = await this.dependencies.projects.findById(projectId);
    if (!project || project.organizationId !== organizationId)
      throw new ResourceNotFoundError("PROJECT_NOT_FOUND");
    return project;
  }
  private async assertOwner(
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    if (
      (await this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId,
      })) !== "owner"
    )
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
  private async assertExecutionAccess(
    actorId: string,
    project: Project,
    correlationId: string,
  ): Promise<void> {
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      project.workspaceId,
    );
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId: project.organizationId,
    });
    if (actorId === project.leadActorId || role === "owner" || role === "admin")
      return;
    if (
      await this.dependencies.accessGrants?.authorize({
        actorId,
        organizationId: project.organizationId,
        workspaceId: project.workspaceId,
        resourceType: "project",
        resourceId: project.id,
        action: "contribute",
        correlationId,
      })
    )
      return;
    throw new AccessDeniedError("workspace:manage");
  }
  private async assertProjectRead(
    actorId: string,
    project: Project,
    correlationId?: string,
  ): Promise<void> {
    if (
      await this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId: project.organizationId,
      })
    )
      return;
    if (
      await this.dependencies.accessGrants?.authorize({
        actorId,
        organizationId: project.organizationId,
        workspaceId: project.workspaceId,
        resourceType: "project",
        resourceId: project.id,
        action: "read",
        correlationId: correlationId ?? this.dependencies.ids.next(),
      })
    )
      return;
    throw new AccessDeniedError("organization:read");
  }
  private async record(
    project: Project,
    actorId: string,
    correlationId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.dependencies.audit.record({
      id: this.dependencies.ids.next(),
      eventType,
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId,
      correlationId,
      occurredAt: this.dependencies.clock.now(),
      payload,
    });
  }
  private eventFor(
    project: Project,
    correlationId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): DurableDomainEvent {
    return {
      eventId: this.dependencies.ids.next(),
      eventType,
      occurredAt: this.dependencies.clock.now(),
      aggregateId: project.id,
      aggregateType: "project",
      aggregateVersion: project.version,
      organizationId: project.organizationId,
      correlationId,
      causationId: null,
      schemaVersion: 1,
      payload,
    };
  }
}
export class ProjectVersionConflictError extends Error {
  constructor() {
    super("PROJECT_VERSION_CONFLICT");
  }
}
export class ProjectAlreadyExistsError extends Error {
  constructor() {
    super("PROJECT_ALREADY_EXISTS");
  }
}
export class ProjectAlreadyClosedError extends Error {
  constructor() {
    super("PROJECT_ALREADY_CLOSED");
  }
}
export { ProjectDomainError };
