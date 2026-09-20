import {
  ProjectDomainError,
  assignProjectLead,
  createProject,
  replaceProjectLead,
  transferProjectWorkspace,
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
  transfer(input: {
    project: Project;
    expectedVersion: number;
    auditEvent: ProjectAuditEvent;
  }): Promise<boolean>;
  createWithEvent?(input: {
    project: Project;
    event: DurableDomainEvent;
  }): Promise<void>;
  createWithEventAndAudit?(input: {
    project: Project;
    event: DurableDomainEvent;
    auditEvent: ProjectAuditEvent;
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
  hasMinimumPlan(projectId: string): Promise<boolean>;
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
    objective: string;
    boundaries: string;
    successCriteria: string;
    nextMilestone: string;
    sponsorActorId: string;
    leadActorId: string | null;
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
    if (
      decision.conditions?.some((condition) => condition.status === "pending")
    )
      throw new ProjectDomainError("DECISION_CONDITIONS_PENDING");
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    const existing = await this.dependencies.projects.findByInitiative(
      initiative.id,
    );
    if (existing) {
      if (this.isCanonicalConversion(existing, input)) return existing;
      throw new ProjectAlreadyExistsError();
    }
    await Promise.all(
      [
        input.sponsorActorId,
        ...(input.leadActorId ? [input.leadActorId] : []),
        ...input.participants.map((participant) => participant.actorId),
      ].map((actorId) => this.assertMember(actorId, input.organizationId)),
    );
    await this.assertProjectSponsorScoped(
      input.sponsorActorId,
      initiative.organizationId,
      initiative.workspaceId,
    );
    if (input.leadActorId)
      await this.assertProjectLeadActive({
        organizationId: initiative.organizationId,
        workspaceId: initiative.workspaceId,
        leadActorId: input.leadActorId,
      });
    const now = this.dependencies.clock.now();
    const project = createProject({
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      sourceInitiativeId: initiative.id,
      sourceDecisionId: decision.id,
      name: input.name,
      objective: input.objective,
      boundaries: input.boundaries,
      successCriteria: input.successCriteria,
      nextMilestone: input.nextMilestone,
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
    const auditEvent = this.auditEventFor(
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
    try {
      if (this.dependencies.projects.createWithEventAndAudit)
        await this.dependencies.projects.createWithEventAndAudit({
          project,
          event,
          auditEvent,
        });
      else if (this.dependencies.projects.createWithEvent)
        await this.dependencies.projects.createWithEvent({ project, event });
      else await this.dependencies.projects.create(project);
    } catch (error) {
      if (!(error instanceof ProjectAlreadyExistsError)) throw error;
      const concurrent = await this.dependencies.projects.findByInitiative(
        initiative.id,
      );
      if (concurrent && this.isCanonicalConversion(concurrent, input))
        return concurrent;
      throw error;
    }
    if (!this.dependencies.projects.createWithEventAndAudit)
      await this.dependencies.audit.record(auditEvent);
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
    await this.assertProjectLeadActive(project);
    if (project.version !== input.expectedVersion)
      throw new ProjectVersionConflictError();
    if (
      input.status === "active" &&
      !(await this.dependencies.execution.hasMinimumPlan(project.id))
    )
      throw new ProjectDomainError("PROJECT_MINIMUM_PLAN_REQUIRED");
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
  async assignLead(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    expectedVersion: number;
    leadActorId: string;
    correlationId: string;
  }): Promise<Project> {
    await this.assertOwner(input.actorId, input.organizationId);
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    if (project.version !== input.expectedVersion)
      throw new ProjectVersionConflictError();
    await this.assertProjectLeadActive({
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      leadActorId: input.leadActorId,
    });
    const updated = assignProjectLead({
      project,
      leadActorId: input.leadActorId,
      updatedAt: this.dependencies.clock.now(),
    });
    const saved = await this.dependencies.projects.save({
      project: updated,
      expectedVersion: project.version,
    });
    if (!saved) throw new ProjectVersionConflictError();
    await this.record(
      updated,
      input.actorId,
      input.correlationId,
      "project.lead_assigned.v1",
      { leadActorId: updated.leadActorId },
    );
    return updated;
  }
  async replaceLead(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    expectedVersion: number;
    leadActorId: string;
    reason: string;
    correlationId: string;
  }): Promise<Project> {
    await this.assertOwner(input.actorId, input.organizationId);
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    if (project.version !== input.expectedVersion)
      throw new ProjectVersionConflictError();
    await this.assertProjectLeadActive({
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      leadActorId: input.leadActorId,
    });
    const previousLeadActorId = project.leadActorId;
    const updated = replaceProjectLead({
      project,
      leadActorId: input.leadActorId,
      reason: input.reason,
      updatedAt: this.dependencies.clock.now(),
    });
    const saved = await this.dependencies.projects.save({
      project: updated,
      expectedVersion: project.version,
    });
    if (!saved) throw new ProjectVersionConflictError();
    await this.record(
      updated,
      input.actorId,
      input.correlationId,
      "project.lead_replaced.v1",
      {
        previousLeadActorId,
        leadActorId: updated.leadActorId,
        reason: input.reason.trim(),
        previousLeadRole: "contributor",
      },
    );
    return updated;
  }
  async transferWorkspace(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    expectedVersion: number;
    workspaceId: string;
    reason: string;
    correlationId: string;
  }): Promise<Project> {
    await this.assertOwner(input.actorId, input.organizationId);
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    if (project.version !== input.expectedVersion)
      throw new ProjectVersionConflictError();
    const targetWorkspace = await this.dependencies.tenancy.findWorkspace(
      input.workspaceId,
    );
    if (
      !targetWorkspace ||
      targetWorkspace.organizationId !== project.organizationId ||
      targetWorkspace.status !== "active"
    )
      throw new ProjectDomainError("PROJECT_WORKSPACE_TRANSFER_INVALID");
    await this.assertProjectLeadActive({
      organizationId: project.organizationId,
      workspaceId: targetWorkspace.id,
      leadActorId: project.leadActorId,
    });
    const updated = transferProjectWorkspace({
      project,
      workspaceId: input.workspaceId,
      reason: input.reason,
      updatedAt: this.dependencies.clock.now(),
    });
    const auditEvent = this.auditEventFor(
      updated,
      input.actorId,
      input.correlationId,
      "project.workspace_transferred.v1",
      {
        fromWorkspaceId: project.workspaceId,
        reason: input.reason.trim(),
      },
    );
    if (
      !(await this.dependencies.projects.transfer({
        project: updated,
        expectedVersion: project.version,
        auditEvent,
      }))
    )
      throw new ProjectVersionConflictError();
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
      document.document.resourceType !== "project" ||
      document.document.resourceId !== project.id ||
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
  private async assertProjectParticipant(
    actorId: string,
    organizationId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.assertMember(actorId, organizationId);
    if (
      !(await this.dependencies.tenancy.findWorkspaceRole({
        actorId,
        workspaceId,
      }))
    )
      throw new AccessDeniedError("workspace:manage");
  }
  private async assertProjectSponsorScoped(
    actorId: string,
    organizationId: string,
    workspaceId: string,
  ): Promise<void> {
    const organizationRole =
      await this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId,
      });
    if (organizationRole === "owner" || organizationRole === "admin") return;
    await this.assertProjectParticipant(actorId, organizationId, workspaceId);
  }
  private async assertProjectLeadActive(
    project: Pick<Project, "organizationId" | "workspaceId" | "leadActorId">,
  ): Promise<void> {
    if (!project.leadActorId)
      throw new ProjectDomainError("PROJECT_LEAD_ASSIGNMENT_INVALID");
    await this.assertProjectParticipant(
      project.leadActorId,
      project.organizationId,
      project.workspaceId,
    );
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
    if (
      (actorId === project.leadActorId && role !== null) ||
      role === "owner" ||
      role === "admin"
    )
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
    await this.dependencies.audit.record(
      this.auditEventFor(project, actorId, correlationId, eventType, payload),
    );
  }
  private auditEventFor(
    project: Project,
    actorId: string,
    correlationId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): ProjectAuditEvent {
    return {
      id: this.dependencies.ids.next(),
      eventType,
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId,
      correlationId,
      occurredAt: this.dependencies.clock.now(),
      payload,
    };
  }
  private isCanonicalConversion(
    project: Project,
    input: {
      decisionId: string;
      name: string;
      objective: string;
      boundaries: string;
      successCriteria: string;
      nextMilestone: string;
      sponsorActorId: string;
      leadActorId: string | null;
      participants: readonly ProjectParticipant[];
    },
  ): boolean {
    return (
      project.sourceDecisionId === input.decisionId &&
      project.name === input.name &&
      project.objective === input.objective &&
      project.boundaries === input.boundaries &&
      project.successCriteria === input.successCriteria &&
      project.nextMilestone === input.nextMilestone &&
      project.sponsorActorId === input.sponsorActorId &&
      project.leadActorId === input.leadActorId &&
      project.participants.length === input.participants.length &&
      project.participants.every(
        (participant, index) =>
          participant.actorId === input.participants[index]?.actorId &&
          participant.role === input.participants[index]?.role,
      )
    );
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
