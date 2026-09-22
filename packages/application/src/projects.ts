import {
  ProjectDomainError,
  assignProjectLead,
  createProject,
  compareProjectToBaseline,
  declareNextActionDependency,
  replaceProjectLead,
  transferProjectWorkspace,
  transitionProject,
  type InitiativeDecision,
  type Project,
  type ProjectMilestone,
  type ProjectNextAction,
  type ProjectNextActionDependency,
  type ProjectNextActionEffortUnit,
  type ProjectNextActionPriority,
  type ProjectRisk,
  type ProjectRiskLevel,
  type ProjectRiskTreatment,
  type ProjectRiskStatus,
  type ProjectOperationalDecision,
  type ProjectExternalDependency,
  type ProjectExternalDependencyStatus,
  type ProjectChangeRequest,
  type ProjectBaseline,
  type ProjectBaselineDifference,
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
  addRisk(risk: ProjectRisk): Promise<void>;
  listRisks(projectId: string): Promise<readonly ProjectRisk[]>;
  findRisk(riskId: string): Promise<ProjectRisk | null>;
  resolveRisk(risk: ProjectRisk): Promise<boolean>;
  addOperationalDecision(decision: ProjectOperationalDecision): Promise<void>;
  listOperationalDecisions(
    projectId: string,
  ): Promise<readonly ProjectOperationalDecision[]>;
  findOperationalDecision(
    decisionId: string,
  ): Promise<ProjectOperationalDecision | null>;
  addExternalDependency(dependency: ProjectExternalDependency): Promise<void>;
  listExternalDependencies(
    projectId: string,
  ): Promise<readonly ProjectExternalDependency[]>;
  findExternalDependency(
    dependencyId: string,
  ): Promise<ProjectExternalDependency | null>;
  resolveExternalDependency(
    dependency: ProjectExternalDependency,
  ): Promise<boolean>;
  addChangeRequest(request: ProjectChangeRequest): Promise<void>;
  findChangeRequest(
    changeRequestId: string,
  ): Promise<ProjectChangeRequest | null>;
  reviewChangeRequest(input: {
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
  }> | null>;
  findLatestBaseline(projectId: string): Promise<ProjectBaseline | null>;
  hasMinimumPlan(projectId: string): Promise<boolean>;
  findNextAction(actionId: string): Promise<ProjectNextAction | null>;
  listDependencies(
    projectId: string,
  ): Promise<readonly ProjectNextActionDependency[]>;
  addDependency(dependency: ProjectNextActionDependency): Promise<void>;
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
    if (input.status === "paused")
      throw new ProjectDomainError("PROJECT_PAUSE_CONTEXT_REQUIRED");
    if (input.status === "cancelled")
      throw new ProjectDomainError("PROJECT_CANCELLATION_REASON_REQUIRED");
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    if (input.status === "active" && project.status === "paused")
      throw new ProjectDomainError("PROJECT_REPLAN_REQUIRED");
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
  async resume(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    expectedVersion: number;
    replanNote: string;
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
    if (project.version !== input.expectedVersion || !input.replanNote.trim())
      throw new ProjectDomainError("PROJECT_REPLAN_REQUIRED");
    const updated = transitionProject(
      project,
      "active",
      this.dependencies.clock.now(),
    );
    const saved = await this.dependencies.projects.save({
      project: updated,
      expectedVersion: project.version,
    });
    if (!saved) throw new ProjectVersionConflictError();
    await this.record(
      updated,
      input.actorId,
      input.correlationId,
      "project.resumed.v1",
      { replanNote: input.replanNote.trim() },
    );
    return updated;
  }
  async pause(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    expectedVersion: number;
    reason: string;
    responsibleActorId: string;
    reviewOn: string;
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
    await this.assertMember(input.responsibleActorId, project.organizationId);
    if (project.version !== input.expectedVersion || !input.reason.trim())
      throw new ProjectDomainError("PROJECT_PAUSE_CONTEXT_REQUIRED");
    const updated = transitionProject(
      project,
      "paused",
      this.dependencies.clock.now(),
    );
    const saved = await this.dependencies.projects.save({
      project: updated,
      expectedVersion: project.version,
    });
    if (!saved) throw new ProjectVersionConflictError();
    await this.record(
      updated,
      input.actorId,
      input.correlationId,
      "project.paused.v1",
      {
        reason: input.reason.trim(),
        responsibleActorId: input.responsibleActorId,
        reviewOn: input.reviewOn,
        fromStatus: project.status,
      },
    );
    return updated;
  }
  async cancel(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    expectedVersion: number;
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
    if (!input.reason.trim())
      throw new ProjectDomainError("PROJECT_CANCELLATION_REASON_REQUIRED");
    const updated = transitionProject(
      project,
      "cancelled",
      this.dependencies.clock.now(),
    );
    const saved = await this.dependencies.projects.save({
      project: updated,
      expectedVersion: project.version,
    });
    if (!saved) throw new ProjectVersionConflictError();
    await this.record(
      updated,
      input.actorId,
      input.correlationId,
      "project.cancelled.v1",
      { reason: input.reason.trim(), fromStatus: project.status },
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
    priority: ProjectNextActionPriority;
    estimatedEffort: number | null;
    effortUnit: ProjectNextActionEffortUnit | null;
    periodStartOn: string | null;
    periodEndOn: string | null;
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
      priority: input.priority,
      estimatedEffort: input.estimatedEffort,
      effortUnit: input.effortUnit,
      periodStartOn: input.periodStartOn,
      periodEndOn: input.periodEndOn,
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
      {
        actionId: action.id,
        ownerActorId: action.ownerActorId,
        priority: action.priority,
        estimatedEffort: action.estimatedEffort,
        effortUnit: action.effortUnit,
        periodStartOn: action.periodStartOn,
        periodEndOn: action.periodEndOn,
      },
    );
    return action;
  }
  async addRisk(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    title: string;
    probability: ProjectRiskLevel;
    impact: ProjectRiskLevel;
    treatment: ProjectRiskTreatment;
    ownerActorId: string;
    correlationId: string;
  }): Promise<ProjectRisk> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    await this.assertProjectParticipant(
      input.ownerActorId,
      project.organizationId,
      project.workspaceId,
    );
    const risk: ProjectRisk = {
      id: this.dependencies.ids.next(),
      projectId: project.id,
      title: input.title,
      probability: input.probability,
      impact: input.impact,
      treatment: input.treatment,
      ownerActorId: input.ownerActorId,
      createdByActorId: input.actorId,
      createdAt: this.dependencies.clock.now(),
      status: "open",
      resolutionNote: null,
      resolvedByActorId: null,
      resolvedAt: null,
    };
    await this.dependencies.execution.addRisk(risk);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.risk_registered.v1",
      {
        riskId: risk.id,
        probability: risk.probability,
        impact: risk.impact,
        treatment: risk.treatment,
        ownerActorId: risk.ownerActorId,
      },
    );
    return risk;
  }
  async listRisks(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    correlationId?: string;
  }): Promise<readonly ProjectRisk[]> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertProjectRead(input.actorId, project, input.correlationId);
    return this.dependencies.execution.listRisks(project.id);
  }
  async resolveRisk(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    riskId: string;
    status: Exclude<ProjectRiskStatus, "open">;
    resolutionNote: string;
    correlationId: string;
  }): Promise<ProjectRisk> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    const risk = await this.dependencies.execution.findRisk(input.riskId);
    if (!risk || risk.projectId !== project.id)
      throw new ResourceNotFoundError("PROJECT_NOT_FOUND");
    if (risk.status !== "open")
      throw new ProjectDomainError("PROJECT_RISK_NOT_OPEN");
    await this.assertRiskResolutionAccess(input.actorId, project, risk);
    const resolved: ProjectRisk = {
      ...risk,
      status: input.status,
      resolutionNote: input.resolutionNote,
      resolvedByActorId: input.actorId,
      resolvedAt: this.dependencies.clock.now(),
    };
    if (!(await this.dependencies.execution.resolveRisk(resolved)))
      throw new ProjectDomainError("PROJECT_RISK_NOT_OPEN");
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      `project.risk_${input.status}.v1`,
      { riskId: resolved.id, ownerActorId: resolved.ownerActorId },
    );
    return resolved;
  }
  async recordOperationalDecision(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    subject: string;
    decision: string;
    rationale: string;
    supersedesDecisionId: string | null;
    correlationId: string;
  }): Promise<ProjectOperationalDecision> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    if (input.supersedesDecisionId) {
      const previous =
        await this.dependencies.execution.findOperationalDecision(
          input.supersedesDecisionId,
        );
      if (!previous || previous.projectId !== project.id)
        throw new ProjectDomainError("PROJECT_OPERATIONAL_DECISION_INVALID");
    }
    const decision: ProjectOperationalDecision = {
      id: this.dependencies.ids.next(),
      projectId: project.id,
      subject: input.subject,
      decision: input.decision,
      rationale: input.rationale,
      supersedesDecisionId: input.supersedesDecisionId,
      decidedByActorId: input.actorId,
      decidedAt: this.dependencies.clock.now(),
    };
    await this.dependencies.execution.addOperationalDecision(decision);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.operational_decision_recorded.v1",
      {
        operationalDecisionId: decision.id,
        subject: decision.subject,
        supersedesDecisionId: decision.supersedesDecisionId,
      },
    );
    return decision;
  }
  async listOperationalDecisions(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    correlationId?: string;
  }): Promise<readonly ProjectOperationalDecision[]> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertProjectRead(input.actorId, project, input.correlationId);
    return this.dependencies.execution.listOperationalDecisions(project.id);
  }
  async addExternalDependency(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    description: string;
    externalParty: string;
    ownerActorId: string;
    dueOn: string | null;
    correlationId: string;
  }): Promise<ProjectExternalDependency> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    await this.assertProjectParticipant(
      input.ownerActorId,
      project.organizationId,
      project.workspaceId,
    );
    const dependency: ProjectExternalDependency = {
      id: this.dependencies.ids.next(),
      projectId: project.id,
      description: input.description,
      externalParty: input.externalParty,
      ownerActorId: input.ownerActorId,
      dueOn: input.dueOn,
      status: "open",
      createdByActorId: input.actorId,
      createdAt: this.dependencies.clock.now(),
      resolutionNote: null,
      resolvedByActorId: null,
      resolvedAt: null,
    };
    await this.dependencies.execution.addExternalDependency(dependency);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.external_dependency_registered.v1",
      { dependencyId: dependency.id, ownerActorId: dependency.ownerActorId },
    );
    return dependency;
  }
  async listExternalDependencies(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    correlationId?: string;
  }): Promise<readonly ProjectExternalDependency[]> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertProjectRead(input.actorId, project, input.correlationId);
    return this.dependencies.execution.listExternalDependencies(project.id);
  }
  async resolveExternalDependency(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    dependencyId: string;
    status: Exclude<ProjectExternalDependencyStatus, "open">;
    resolutionNote: string;
    correlationId: string;
  }): Promise<ProjectExternalDependency> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    const dependency = await this.dependencies.execution.findExternalDependency(
      input.dependencyId,
    );
    if (!dependency || dependency.projectId !== project.id)
      throw new ResourceNotFoundError("PROJECT_NOT_FOUND");
    if (dependency.status !== "open")
      throw new ProjectDomainError("PROJECT_EXTERNAL_DEPENDENCY_NOT_OPEN");
    await this.assertRiskResolutionAccess(input.actorId, project, dependency);
    const resolved: ProjectExternalDependency = {
      ...dependency,
      status: input.status,
      resolutionNote: input.resolutionNote,
      resolvedByActorId: input.actorId,
      resolvedAt: this.dependencies.clock.now(),
    };
    if (
      !(await this.dependencies.execution.resolveExternalDependency(resolved))
    )
      throw new ProjectDomainError("PROJECT_EXTERNAL_DEPENDENCY_NOT_OPEN");
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      `project.external_dependency_${input.status}.v1`,
      { dependencyId: resolved.id, ownerActorId: resolved.ownerActorId },
    );
    return resolved;
  }
  async requestChange(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    title: string;
    reason: string;
    impact: string;
    correlationId: string;
  }): Promise<ProjectChangeRequest> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    const request: ProjectChangeRequest = {
      id: this.dependencies.ids.next(),
      projectId: project.id,
      title: input.title,
      reason: input.reason,
      impact: input.impact,
      requestedByActorId: input.actorId,
      requestedAt: this.dependencies.clock.now(),
      status: "pending",
      reviewedByActorId: null,
      reviewedAt: null,
      reviewNote: null,
    };
    await this.dependencies.execution.addChangeRequest(request);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.change_requested.v1",
      { changeRequestId: request.id, impact: request.impact },
    );
    return request;
  }
  async reviewChangeRequest(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    changeRequestId: string;
    outcome: "approved" | "rejected";
    reviewNote: string;
    correlationId: string;
  }): Promise<
    Readonly<{
      changeRequest: ProjectChangeRequest;
      baseline: ProjectBaseline | null;
    }>
  > {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertChangeReviewer(input.actorId, project.organizationId);
    const request = await this.dependencies.execution.findChangeRequest(
      input.changeRequestId,
    );
    if (!request || request.projectId !== project.id)
      throw new ResourceNotFoundError("PROJECT_NOT_FOUND");
    if (request.status !== "pending")
      throw new ProjectDomainError("PROJECT_CHANGE_REQUEST_NOT_PENDING");
    const reviewedAt = this.dependencies.clock.now();
    const result = await this.dependencies.execution.reviewChangeRequest({
      changeRequest: request,
      outcome: input.outcome,
      reviewedByActorId: input.actorId,
      reviewedAt,
      reviewNote: input.reviewNote,
      baselineId:
        input.outcome === "approved" ? this.dependencies.ids.next() : null,
      projectSnapshot: project,
    });
    if (!result)
      throw new ProjectDomainError("PROJECT_CHANGE_REQUEST_NOT_PENDING");
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      `project.change_${input.outcome}.v1`,
      {
        changeRequestId: result.changeRequest.id,
        baselineId: result.baseline?.id ?? null,
        baselineVersion: result.baseline?.version ?? null,
      },
    );
    return result;
  }
  async baselineDifference(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    correlationId?: string;
  }): Promise<
    Readonly<{
      baseline: ProjectBaseline | null;
      differences: readonly ProjectBaselineDifference[];
    }>
  > {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertProjectRead(input.actorId, project, input.correlationId);
    const baseline = await this.dependencies.execution.findLatestBaseline(
      project.id,
    );
    return {
      baseline,
      differences: baseline
        ? compareProjectToBaseline({ baseline, project })
        : [],
    };
  }
  async declareNextActionDependency(input: {
    actorId: string;
    organizationId: string;
    projectId: string;
    actionId: string;
    dependsOnActionId: string;
    correlationId: string;
  }): Promise<ProjectNextActionDependency> {
    const project = await this.requireProject(
      input.projectId,
      input.organizationId,
    );
    await this.assertExecutionAccess(
      input.actorId,
      project,
      input.correlationId,
    );
    const [action, dependencyAction, existing] = await Promise.all([
      this.dependencies.execution.findNextAction(input.actionId),
      this.dependencies.execution.findNextAction(input.dependsOnActionId),
      this.dependencies.execution.listDependencies(project.id),
    ]);
    if (
      action?.projectId !== project.id ||
      dependencyAction?.projectId !== project.id
    )
      throw new ResourceNotFoundError("PROJECT_NOT_FOUND");
    const dependency = declareNextActionDependency({
      dependency: {
        actionId: input.actionId,
        dependsOnActionId: input.dependsOnActionId,
      },
      existing,
    });
    await this.dependencies.execution.addDependency(dependency);
    await this.record(
      project,
      input.actorId,
      input.correlationId,
      "project.next_action_dependency_declared.v1",
      dependency,
    );
    return dependency;
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
  private async assertChangeReviewer(
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
  private async assertRiskResolutionAccess(
    actorId: string,
    project: Project,
    risk: Pick<ProjectRisk, "ownerActorId">,
  ): Promise<void> {
    if (actorId === risk.ownerActorId) {
      await this.assertProjectParticipant(
        actorId,
        project.organizationId,
        project.workspaceId,
      );
      return;
    }
    await this.assertExecutionAccess(actorId, project, "");
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
