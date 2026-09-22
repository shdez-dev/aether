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
import { reorderNextAction } from "@aether/domain";

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
  constructor(private readonly audit?: ProjectAuditStore) {}
  readonly collaborators: Array<{
    actionId: string;
    actorId: string;
    addedByActorId: string;
    addedAt: Date;
  }> = [];
  async listMyWorkCandidates(input: {
    organizationId: string;
    actorId: string;
    teamIds: readonly string[];
  }): Promise<
    readonly { projectId: string; actionId: string; collaborator: boolean }[]
  > {
    return this.actions
      .filter(
        (action) =>
          action.workflowStatus !== "done" &&
          action.workflowStatus !== "cancelled",
      )
      .filter(
        (action) =>
          action.ownerActorId === input.actorId ||
          (action.workflowStatus === "in_review" &&
            action.reviewerActorId === input.actorId) ||
          (action.workflowStatus === "to_do" &&
            action.ownerActorId === null &&
            action.executorTeamId !== null &&
            input.teamIds.includes(action.executorTeamId)) ||
          (action.blockedReason !== null &&
            action.unblockResponsibleActorId === input.actorId) ||
          this.collaborators.some(
            (item) =>
              item.actionId === action.id && item.actorId === input.actorId,
          ),
      )
      .map((action) => ({
        projectId: action.projectId,
        actionId: action.id,
        collaborator: this.collaborators.some(
          (item) =>
            item.actionId === action.id && item.actorId === input.actorId,
        ),
      }));
  }
  readonly milestones: ProjectMilestone[] = [];
  readonly actions: ProjectNextAction[] = [];
  readonly dependencies: ProjectNextActionDependency[] = [];
  readonly risks: ProjectRisk[] = [];
  readonly operationalDecisions: ProjectOperationalDecision[] = [];
  readonly externalDependencies: ProjectExternalDependency[] = [];
  readonly changeRequests: ProjectChangeRequest[] = [];
  readonly baselines: ProjectBaseline[] = [];
  private reorderTail: Promise<void> = Promise.resolve();
  async addMilestone(milestone: ProjectMilestone): Promise<void> {
    this.milestones.push(milestone);
  }
  async listMilestones(
    projectId: string,
  ): Promise<readonly ProjectMilestone[]> {
    return this.milestones.filter((item) => item.projectId === projectId);
  }
  async addNextAction(action: ProjectNextAction): Promise<void> {
    const position =
      this.actions.filter(
        (item) =>
          item.projectId === action.projectId &&
          item.workflowStatus === action.workflowStatus,
      ).length + 1;
    this.actions.push({ ...action, position });
  }
  async addNextActionCollaborator(input: {
    actionId: string;
    actorId: string;
    addedByActorId: string;
    addedAt: Date;
    expectedVersion: number;
    auditEvent: ProjectAuditEvent;
  }): Promise<boolean> {
    const index = this.actions.findIndex(
      (action) =>
        action.id === input.actionId &&
        action.version === input.expectedVersion,
    );
    if (
      index < 0 ||
      this.collaborators.some(
        (item) =>
          item.actionId === input.actionId && item.actorId === input.actorId,
      )
    )
      return false;
    this.actions[index] = {
      ...this.actions[index]!,
      version: input.expectedVersion + 1,
    };
    this.collaborators.push({
      actionId: input.actionId,
      actorId: input.actorId,
      addedByActorId: input.addedByActorId,
      addedAt: input.addedAt,
    });
    await this.audit?.record(input.auditEvent);
    return true;
  }
  async changeNextActionDueOn(input: {
    actionId: string;
    projectId: string;
    dueOn: string | null;
    expectedVersion: number;
    auditEvent: ProjectAuditEvent;
  }): Promise<boolean> {
    const index = this.actions.findIndex(
      (item) =>
        item.id === input.actionId &&
        item.projectId === input.projectId &&
        item.version === input.expectedVersion,
    );
    if (index < 0) return false;
    await this.audit?.record(input.auditEvent);
    this.actions[index] = {
      ...this.actions[index]!,
      dueOn: input.dueOn,
      version: input.expectedVersion + 1,
    };
    return true;
  }
  async listNextActionCollaborators(
    actionId: string,
  ): Promise<readonly string[]> {
    return this.collaborators
      .filter((item) => item.actionId === actionId)
      .map((item) => item.actorId)
      .sort();
  }
  async claimNextAction(input: {
    action: ProjectNextAction;
    ownerActorId: string;
    expectedVersion: number;
    auditEvent: ProjectAuditEvent;
  }): Promise<ProjectNextAction | null> {
    const index = this.actions.findIndex(
      (action) =>
        action.id === input.action.id &&
        action.version === input.expectedVersion &&
        action.ownerActorId === null &&
        action.workflowStatus === "to_do" &&
        action.executorTeamId !== null,
    );
    if (index < 0) return null;
    const action = this.actions[index]!;
    const claimed = {
      ...action,
      ownerActorId: input.ownerActorId,
      version: action.version + 1,
    };
    this.actions[index] = claimed;
    return claimed;
  }
  async reorderNextAction(input: {
    action: ProjectNextAction;
    position: number;
    expectedVersion: number;
    auditEvent: ProjectAuditEvent;
  }): Promise<ProjectNextAction | null> {
    let release: () => void = () => {};
    const previous = this.reorderTail;
    this.reorderTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = await this.findNextAction(input.action.id);
      if (!current || current.version !== input.expectedVersion) return null;
      const ordered = reorderNextAction({
        actions: this.actions,
        actionId: input.action.id,
        position: input.position,
      });
      for (const action of ordered) {
        const index = this.actions.findIndex((item) => item.id === action.id);
        this.actions[index] = action;
      }
      return this.findNextAction(input.action.id);
    } finally {
      release();
    }
  }
  async updateNextAction(input: {
    action: ProjectNextAction;
    expectedVersion: number;
  }): Promise<boolean> {
    const index = this.actions.findIndex(
      (action) =>
        action.id === input.action.id &&
        action.version === input.expectedVersion,
    );
    if (index < 0) return false;
    const current = this.actions[index]!;
    const position =
      current.workflowStatus === input.action.workflowStatus
        ? input.action.position
        : this.actions.filter(
            (item) =>
              item.projectId === input.action.projectId &&
              item.workflowStatus === input.action.workflowStatus,
          ).length + 1;
    this.actions[index] = { ...input.action, position };
    return true;
  }
  async addRisk(risk: ProjectRisk): Promise<void> {
    this.risks.push(risk);
  }
  async listRisks(projectId: string): Promise<readonly ProjectRisk[]> {
    return this.risks.filter((risk) => risk.projectId === projectId);
  }
  async findRisk(riskId: string): Promise<ProjectRisk | null> {
    return this.risks.find((risk) => risk.id === riskId) ?? null;
  }
  async resolveRisk(risk: ProjectRisk): Promise<boolean> {
    const index = this.risks.findIndex(
      (current) => current.id === risk.id && current.status === "open",
    );
    if (index < 0) return false;
    this.risks[index] = risk;
    return true;
  }
  async addOperationalDecision(
    decision: ProjectOperationalDecision,
  ): Promise<void> {
    this.operationalDecisions.push(decision);
  }
  async listOperationalDecisions(
    projectId: string,
  ): Promise<readonly ProjectOperationalDecision[]> {
    return this.operationalDecisions.filter(
      (decision) => decision.projectId === projectId,
    );
  }
  async findOperationalDecision(
    decisionId: string,
  ): Promise<ProjectOperationalDecision | null> {
    return (
      this.operationalDecisions.find(
        (decision) => decision.id === decisionId,
      ) ?? null
    );
  }
  async addExternalDependency(
    dependency: ProjectExternalDependency,
  ): Promise<void> {
    this.externalDependencies.push(dependency);
  }
  async listExternalDependencies(
    projectId: string,
  ): Promise<readonly ProjectExternalDependency[]> {
    return this.externalDependencies.filter(
      (dependency) => dependency.projectId === projectId,
    );
  }
  async findExternalDependency(
    dependencyId: string,
  ): Promise<ProjectExternalDependency | null> {
    return (
      this.externalDependencies.find(
        (dependency) => dependency.id === dependencyId,
      ) ?? null
    );
  }
  async resolveExternalDependency(
    dependency: ProjectExternalDependency,
  ): Promise<boolean> {
    const index = this.externalDependencies.findIndex(
      (current) => current.id === dependency.id && current.status === "open",
    );
    if (index < 0) return false;
    this.externalDependencies[index] = dependency;
    return true;
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
  async listNextActions(
    projectId: string,
  ): Promise<readonly ProjectNextAction[]> {
    return this.actions
      .filter((action) => action.projectId === projectId)
      .sort(
        (a, b) =>
          ["to_do", "in_progress", "in_review", "done", "cancelled"].indexOf(
            a.workflowStatus,
          ) -
            ["to_do", "in_progress", "in_review", "done", "cancelled"].indexOf(
              b.workflowStatus,
            ) || a.position - b.position,
      );
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
