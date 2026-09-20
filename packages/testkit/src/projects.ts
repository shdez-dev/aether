import {
  ProjectAlreadyExistsError,
  ProjectAuditEvent,
  ProjectAuditStore,
  ProjectExecutionStore,
  ProjectClosureStore,
  ProjectStore,
  DurableDomainEvent,
} from "@aether/application";
import type {
  Project,
  ProjectMilestone,
  ProjectNextAction,
  ProjectNextActionDependency,
  ProjectRisk,
  ProjectOperationalDecision,
  ProjectExternalDependency,
  ProjectChangeRequest,
  ProjectBaseline,
  ProjectClosure,
  ProjectDeliverableAcceptance,
} from "@aether/domain";

export class InMemoryProjectStore implements ProjectStore {
  readonly projects = new Map<string, Project>();
  readonly durableEvents: DurableDomainEvent[] = [];
  async create(project: Project): Promise<void> {
    this.assertInitiativeIsUnique(project);
    this.projects.set(project.id, project);
  }
  async findById(projectId: string): Promise<Project | null> {
    return this.projects.get(projectId) ?? null;
  }
  async findByInitiative(initiativeId: string): Promise<Project | null> {
    return (
      [...this.projects.values()].find(
        (project) => project.sourceInitiativeId === initiativeId,
      ) ?? null
    );
  }
  async list(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Project[]> {
    return [...this.projects.values()].filter(
      (project) =>
        project.organizationId === input.organizationId &&
        project.workspaceId === input.workspaceId,
    );
  }
  async save(input: {
    project: Project;
    expectedVersion: number;
  }): Promise<boolean> {
    const current = this.projects.get(input.project.id);
    if (!current || current.version !== input.expectedVersion) return false;
    this.projects.set(input.project.id, input.project);
    return true;
  }
  async transfer(input: {
    project: Project;
    expectedVersion: number;
    auditEvent: ProjectAuditEvent;
  }): Promise<boolean> {
    return this.save(input);
  }
  async createWithEvent(input: {
    project: Project;
    event: DurableDomainEvent;
  }): Promise<void> {
    this.assertInitiativeIsUnique(input.project);
    this.projects.set(input.project.id, input.project);
    this.durableEvents.push(input.event);
  }
  async saveWithEvent(input: {
    project: Project;
    expectedVersion: number;
    event: DurableDomainEvent;
  }): Promise<boolean> {
    const saved = await this.save(input);
    if (saved) this.durableEvents.push(input.event);
    return saved;
  }
  private assertInitiativeIsUnique(project: Project): void {
    if (
      [...this.projects.values()].some(
        (existing) =>
          existing.sourceInitiativeId === project.sourceInitiativeId &&
          existing.id !== project.id,
      )
    )
      throw new ProjectAlreadyExistsError();
  }
}
export class InMemoryProjectExecutionStore implements ProjectExecutionStore {
  readonly milestones: ProjectMilestone[] = [];
  readonly actions: ProjectNextAction[] = [];
  readonly dependencies: ProjectNextActionDependency[] = [];
  readonly risks: ProjectRisk[] = [];
  readonly operationalDecisions: ProjectOperationalDecision[] = [];
  readonly externalDependencies: ProjectExternalDependency[] = [];
  readonly changeRequests: ProjectChangeRequest[] = [];
  readonly baselines: ProjectBaseline[] = [];
  async addMilestone(milestone: ProjectMilestone): Promise<void> {
    this.milestones.push(milestone);
  }
  async addNextAction(action: ProjectNextAction): Promise<void> {
    this.actions.push(action);
  }
  async addRisk(risk: ProjectRisk): Promise<void> {
    this.risks.push(risk);
  }
  async addOperationalDecision(
    decision: ProjectOperationalDecision,
  ): Promise<void> {
    this.operationalDecisions.push(decision);
  }
  async addExternalDependency(
    dependency: ProjectExternalDependency,
  ): Promise<void> {
    this.externalDependencies.push(dependency);
  }
  async addChangeRequest(request: ProjectChangeRequest): Promise<void> {
    this.changeRequests.push(request);
  }
  async findChangeRequest(
    changeRequestId: string,
  ): Promise<ProjectChangeRequest | null> {
    return (
      this.changeRequests.find((request) => request.id === changeRequestId) ??
      null
    );
  }
  async reviewChangeRequest(input: {
    changeRequest: ProjectChangeRequest;
    outcome: "approved" | "rejected";
    reviewedByActorId: string;
    reviewedAt: Date;
    reviewNote: string;
    baselineId: string | null;
    projectSnapshot: Project;
  }): Promise<Readonly<{
    changeRequest: ProjectChangeRequest;
    baseline: ProjectBaseline | null;
  }> | null> {
    const index = this.changeRequests.findIndex(
      (request) => request.id === input.changeRequest.id,
    );
    if (index < 0 || this.changeRequests[index]?.status !== "pending")
      return null;
    const changeRequest: ProjectChangeRequest = {
      ...input.changeRequest,
      status: input.outcome,
      reviewedByActorId: input.reviewedByActorId,
      reviewedAt: input.reviewedAt,
      reviewNote: input.reviewNote,
    };
    this.changeRequests[index] = changeRequest;
    const baseline =
      input.outcome === "approved" && input.baselineId
        ? {
            id: input.baselineId,
            projectId: input.projectSnapshot.id,
            changeRequestId: changeRequest.id,
            version: this.baselines.length + 1,
            snapshot: input.projectSnapshot,
            approvedByActorId: input.reviewedByActorId,
            approvedAt: input.reviewedAt,
          }
        : null;
    if (baseline) this.baselines.push(baseline);
    return { changeRequest, baseline };
  }
  async findLatestBaseline(projectId: string): Promise<ProjectBaseline | null> {
    return (
      [...this.baselines]
        .reverse()
        .find((baseline) => baseline.projectId === projectId) ?? null
    );
  }
  async hasMinimumPlan(projectId: string): Promise<boolean> {
    return (
      this.milestones.some((milestone) => milestone.projectId === projectId) &&
      this.actions.some((action) => action.projectId === projectId)
    );
  }
  async findNextAction(actionId: string): Promise<ProjectNextAction | null> {
    return this.actions.find((action) => action.id === actionId) ?? null;
  }
  async listDependencies(
    projectId: string,
  ): Promise<readonly ProjectNextActionDependency[]> {
    const actionIds = new Set(
      this.actions
        .filter((action) => action.projectId === projectId)
        .map((action) => action.id),
    );
    return this.dependencies.filter((dependency) =>
      actionIds.has(dependency.actionId),
    );
  }
  async addDependency(dependency: ProjectNextActionDependency): Promise<void> {
    this.dependencies.push(dependency);
  }
}
export class InMemoryProjectClosureStore implements ProjectClosureStore {
  readonly closures = new Map<string, ProjectClosure>();
  readonly deliverables: ProjectDeliverableAcceptance[] = [];
  async createClosure(closure: ProjectClosure): Promise<void> {
    this.closures.set(closure.projectId, closure);
  }
  async findClosure(projectId: string): Promise<ProjectClosure | null> {
    return this.closures.get(projectId) ?? null;
  }
  async acceptDeliverable(
    acceptance: ProjectDeliverableAcceptance,
  ): Promise<void> {
    this.deliverables.push(acceptance);
  }
}
export class InMemoryProjectAuditStore implements ProjectAuditStore {
  readonly events: ProjectAuditEvent[] = [];
  async record(event: ProjectAuditEvent): Promise<void> {
    this.events.push(event);
  }
  async list(input: {
    organizationId: string;
    projectId: string;
  }): Promise<readonly ProjectAuditEvent[]> {
    return this.events.filter(
      (event) =>
        event.organizationId === input.organizationId &&
        event.projectId === input.projectId,
    );
  }
}
