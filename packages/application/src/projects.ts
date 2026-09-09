import {
  ProjectDomainError,
  createProject,
  transitionProject,
  type InitiativeDecision,
  type Project,
  type ProjectMilestone,
  type ProjectNextAction,
  type ProjectParticipant,
  type ProjectStatus,
} from "@aether/domain";

import {
  AccessDeniedError,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";
import type { InitiativeStore } from "./initiatives.js";

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
  save(input: { project: Project; expectedVersion: number }): Promise<boolean>;
}
export interface ProjectExecutionStore {
  addMilestone(milestone: ProjectMilestone): Promise<void>;
  addNextAction(action: ProjectNextAction): Promise<void>;
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
      audit: ProjectAuditStore;
      decisions: ProjectDecisionLookup;
      initiatives: InitiativeStore;
      tenancy: TenantStore;
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
    if (await this.dependencies.projects.findByInitiative(initiative.id))
      throw new ProjectDomainError("INVALID_PROJECT_TRANSITION");
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
    await this.dependencies.projects.create(project);
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
    await this.assertExecutionAccess(input.actorId, project);
    if (project.version !== input.expectedVersion)
      throw new ProjectVersionConflictError();
    const updated = transitionProject(
      project,
      input.status,
      this.dependencies.clock.now(),
    );
    if (
      !(await this.dependencies.projects.save({
        project: updated,
        expectedVersion: project.version,
      }))
    )
      throw new ProjectVersionConflictError();
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
    await this.assertExecutionAccess(input.actorId, project);
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
    await this.assertExecutionAccess(input.actorId, project);
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
  async auditTrail(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
  }): Promise<readonly ProjectAuditEvent[]> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertMember(input.actorId, project.organizationId);
    return this.dependencies.audit.list({
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
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
  ): Promise<void> {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId: project.organizationId,
    });
    if (actorId !== project.leadActorId && role !== "owner" && role !== "admin")
      throw new AccessDeniedError("workspace:manage");
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
}
export class ProjectVersionConflictError extends Error {
  constructor() {
    super("PROJECT_VERSION_CONFLICT");
  }
}
export { ProjectDomainError };
