export const ProjectStatuses = [
  "pending_lead",
  "planned",
  "active",
  "paused",
  "blocked",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof ProjectStatuses)[number];
export type ProjectParticipantRole =
  "sponsor" | "lead" | "contributor" | "observer";
export type ProjectParticipant = Readonly<{
  actorId: string;
  role: ProjectParticipantRole;
}>;
export type Project = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  sourceInitiativeId: string;
  sourceDecisionId: string;
  name: string;
  objective: string | null;
  boundaries: string | null;
  successCriteria: string | null;
  nextMilestone: string | null;
  sponsorActorId: string;
  leadActorId: string | null;
  participants: readonly ProjectParticipant[];
  status: ProjectStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;
export type ProjectMilestone = Readonly<{
  id: string;
  projectId: string;
  title: string;
  dueOn: string | null;
  completedAt: Date | null;
  createdByActorId: string;
  createdAt: Date;
}>;
export const ProjectNextActionPriorities = ["low", "medium", "high"] as const;
export type ProjectNextActionPriority =
  (typeof ProjectNextActionPriorities)[number];
export const ProjectNextActionEffortUnits = [
  "hours",
  "days",
  "points",
] as const;
export type ProjectNextActionEffortUnit =
  (typeof ProjectNextActionEffortUnits)[number];
export type ProjectNextAction = Readonly<{
  id: string;
  projectId: string;
  description: string;
  ownerActorId: string;
  dueOn: string | null;
  priority: ProjectNextActionPriority;
  estimatedEffort: number | null;
  effortUnit: ProjectNextActionEffortUnit | null;
  periodStartOn: string | null;
  periodEndOn: string | null;
  completedAt: Date | null;
  createdByActorId: string;
  createdAt: Date;
}>;
export type ProjectNextActionDependency = Readonly<{
  actionId: string;
  dependsOnActionId: string;
}>;
export const ProjectRiskLevels = ["low", "medium", "high"] as const;
export type ProjectRiskLevel = (typeof ProjectRiskLevels)[number];
export const ProjectRiskTreatments = [
  "avoid",
  "mitigate",
  "transfer",
  "accept",
] as const;
export type ProjectRiskTreatment = (typeof ProjectRiskTreatments)[number];
export const ProjectRiskStatuses = ["open", "resolved", "accepted"] as const;
export type ProjectRiskStatus = (typeof ProjectRiskStatuses)[number];
export type ProjectRisk = Readonly<{
  id: string;
  projectId: string;
  title: string;
  probability: ProjectRiskLevel;
  impact: ProjectRiskLevel;
  treatment: ProjectRiskTreatment;
  ownerActorId: string;
  createdByActorId: string;
  createdAt: Date;
  status: ProjectRiskStatus;
  resolutionNote: string | null;
  resolvedByActorId: string | null;
  resolvedAt: Date | null;
}>;
export type ProjectOperationalDecision = Readonly<{
  id: string;
  projectId: string;
  subject: string;
  decision: string;
  rationale: string;
  supersedesDecisionId: string | null;
  decidedByActorId: string;
  decidedAt: Date;
}>;
export const ProjectExternalDependencyStatuses = [
  "open",
  "resolved",
  "accepted",
] as const;
export type ProjectExternalDependencyStatus =
  (typeof ProjectExternalDependencyStatuses)[number];
export type ProjectExternalDependency = Readonly<{
  id: string;
  projectId: string;
  description: string;
  externalParty: string;
  ownerActorId: string;
  dueOn: string | null;
  status: ProjectExternalDependencyStatus;
  createdByActorId: string;
  createdAt: Date;
  resolutionNote: string | null;
  resolvedByActorId: string | null;
  resolvedAt: Date | null;
}>;
export type ProjectChangeRequest = Readonly<{
  id: string;
  projectId: string;
  title: string;
  reason: string;
  impact: string;
  requestedByActorId: string;
  requestedAt: Date;
  status: "pending" | "approved" | "rejected";
  reviewedByActorId: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
}>;
export type ProjectBaseline = Readonly<{
  id: string;
  projectId: string;
  changeRequestId: string;
  version: number;
  snapshot: Project;
  approvedByActorId: string;
  approvedAt: Date;
}>;
export const ProjectBaselineDifferenceFields = [
  "name",
  "objective",
  "boundaries",
  "successCriteria",
  "nextMilestone",
  "sponsorActorId",
  "leadActorId",
  "participants",
  "status",
] as const;
export type ProjectBaselineDifferenceField =
  (typeof ProjectBaselineDifferenceFields)[number];
export type ProjectBaselineDifference = Readonly<{
  field: ProjectBaselineDifferenceField;
  baselineValue: string | null;
  currentValue: string | null;
}>;

export function compareProjectToBaseline(input: {
  baseline: ProjectBaseline;
  project: Project;
}): readonly ProjectBaselineDifference[] {
  const valueFor = (
    project: Project,
    field: ProjectBaselineDifferenceField,
  ): string | null => {
    if (field === "participants")
      return project.participants
        .map((participant) => `${participant.actorId} (${participant.role})`)
        .join(", ");
    return project[field];
  };
  return ProjectBaselineDifferenceFields.flatMap((field) => {
    const baselineValue = valueFor(input.baseline.snapshot, field);
    const currentValue = valueFor(input.project, field);
    return baselineValue === currentValue
      ? []
      : [{ field, baselineValue, currentValue }];
  });
}

export function declareNextActionDependency(input: {
  dependency: ProjectNextActionDependency;
  existing: readonly ProjectNextActionDependency[];
}): ProjectNextActionDependency {
  if (input.dependency.actionId === input.dependency.dependsOnActionId)
    throw new ProjectDomainError("PROJECT_DEPENDENCY_INVALID");
  if (
    input.existing.some(
      (dependency) =>
        dependency.actionId === input.dependency.actionId &&
        dependency.dependsOnActionId === input.dependency.dependsOnActionId,
    )
  )
    throw new ProjectDomainError("PROJECT_DEPENDENCY_INVALID");
  const graph = new Map<string, string[]>();
  for (const dependency of [...input.existing, input.dependency]) {
    const dependencies = graph.get(dependency.actionId) ?? [];
    dependencies.push(dependency.dependsOnActionId);
    graph.set(dependency.actionId, dependencies);
  }
  const reaches = (
    actionId: string,
    targetId: string,
    visited = new Set<string>(),
  ): boolean => {
    if (actionId === targetId) return true;
    if (visited.has(actionId)) return false;
    visited.add(actionId);
    return (graph.get(actionId) ?? []).some((dependencyId) =>
      reaches(dependencyId, targetId, visited),
    );
  };
  if (reaches(input.dependency.dependsOnActionId, input.dependency.actionId))
    throw new ProjectDomainError("PROJECT_DEPENDENCY_CYCLE");
  return input.dependency;
}
export type ProjectClosure = Readonly<{
  id: string;
  projectId: string;
  organizationId: string;
  workspaceId: string;
  outcomes: string;
  lessonsLearned: string;
  objectiveAssessment: ProjectObjectiveAssessment;
  assessmentRationale: string;
  exceptions: readonly ProjectClosureException[];
  /**
   * Compatibility projection of `exceptions`. New consumers should use the
   * structured exception records instead of this list.
   */
  pendingItems: readonly string[];
  closedByActorId: string;
  closedAt: Date;
}>;
export const ProjectObjectiveAssessments = [
  "achieved",
  "partially_achieved",
  "not_achieved",
  "not_assessed",
] as const;
export type ProjectObjectiveAssessment =
  (typeof ProjectObjectiveAssessments)[number];
export const ProjectClosureExceptionDispositions = [
  "resolved",
  "transferred",
  "accepted",
] as const;
export type ProjectClosureExceptionDisposition =
  (typeof ProjectClosureExceptionDispositions)[number];
export type ProjectClosureException = Readonly<{
  id: string;
  description: string;
  disposition: ProjectClosureExceptionDisposition;
  responsibleActorId: string;
  rationale: string;
}>;
export type ProjectDeliverableAcceptance = Readonly<{
  id: string;
  projectId: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  documentId: string;
  documentVersionId: string;
  acceptedByActorId: string;
  acceptedAt: Date;
}>;

const transitions: Record<ProjectStatus, readonly ProjectStatus[]> = {
  pending_lead: ["planned", "cancelled"],
  planned: ["active", "cancelled"],
  active: ["paused", "blocked", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  blocked: ["active", "paused", "cancelled"],
  completed: [],
  cancelled: [],
};
export function createProject(
  input: Omit<
    Project,
    | "status"
    | "version"
    | "objective"
    | "boundaries"
    | "successCriteria"
    | "nextMilestone"
  > & {
    objective: string;
    boundaries: string;
    successCriteria: string;
    nextMilestone: string;
  },
): Project {
  const roles = new Map(
    input.participants.map((participant) => [
      participant.actorId,
      participant.role,
    ]),
  );
  if (
    roles.size !== input.participants.length ||
    roles.get(input.sponsorActorId) !== "sponsor" ||
    (input.leadActorId !== null && roles.get(input.leadActorId) !== "lead") ||
    (input.leadActorId === null &&
      input.participants.some((participant) => participant.role === "lead"))
  )
    throw new ProjectDomainError("PROJECT_ROLES_INVALID");
  if (input.sponsorActorId === input.leadActorId)
    throw new ProjectDomainError("PROJECT_ROLES_INVALID");
  if (
    ![
      input.objective,
      input.boundaries,
      input.successCriteria,
      input.nextMilestone,
    ].every((value) => value.trim())
  )
    throw new ProjectDomainError("PROJECT_MANDATE_REQUIRED");
  return {
    ...input,
    participants: [...input.participants],
    status: input.leadActorId === null ? "pending_lead" : "planned",
    version: 0,
  };
}
export function transitionProject(
  project: Project,
  target: ProjectStatus,
  updatedAt: Date,
): Project {
  if (!transitions[project.status].includes(target))
    throw new ProjectDomainError("INVALID_PROJECT_TRANSITION");
  return {
    ...project,
    status: target,
    version: project.version + 1,
    updatedAt,
  };
}
export function assignProjectLead(input: {
  project: Project;
  leadActorId: string;
  updatedAt: Date;
}): Project {
  if (input.project.status !== "pending_lead" || input.project.leadActorId)
    throw new ProjectDomainError("PROJECT_LEAD_ASSIGNMENT_INVALID");
  if (input.project.sponsorActorId === input.leadActorId)
    throw new ProjectDomainError("PROJECT_ROLES_INVALID");
  return {
    ...input.project,
    leadActorId: input.leadActorId,
    participants: [
      ...input.project.participants,
      { actorId: input.leadActorId, role: "lead" },
    ],
    status: "planned",
    version: input.project.version + 1,
    updatedAt: input.updatedAt,
  };
}
export function replaceProjectLead(input: {
  project: Project;
  leadActorId: string;
  reason: string;
  updatedAt: Date;
}): Project {
  const previousLeadActorId = input.project.leadActorId;
  if (
    !previousLeadActorId ||
    !["planned", "active", "paused", "blocked"].includes(
      input.project.status,
    ) ||
    input.leadActorId === previousLeadActorId ||
    input.leadActorId === input.project.sponsorActorId ||
    !input.reason.trim()
  )
    throw new ProjectDomainError("PROJECT_LEAD_REPLACEMENT_INVALID");

  const hasPreviousLead = input.project.participants.some(
    (participant) =>
      participant.actorId === previousLeadActorId &&
      participant.role === "lead",
  );
  if (!hasPreviousLead) throw new ProjectDomainError("PROJECT_ROLES_INVALID");

  const hasReplacement = input.project.participants.some(
    (participant) => participant.actorId === input.leadActorId,
  );
  const participants = input.project.participants.map((participant) => {
    if (participant.actorId === previousLeadActorId)
      return { ...participant, role: "contributor" as const };
    if (participant.actorId === input.leadActorId)
      return { ...participant, role: "lead" as const };
    return participant;
  });
  if (!hasReplacement)
    participants.push({ actorId: input.leadActorId, role: "lead" });

  return {
    ...input.project,
    leadActorId: input.leadActorId,
    participants,
    version: input.project.version + 1,
    updatedAt: input.updatedAt,
  };
}
export function transferProjectWorkspace(input: {
  project: Project;
  workspaceId: string;
  reason: string;
  updatedAt: Date;
}): Project {
  if (
    input.project.status !== "planned" ||
    input.workspaceId === input.project.workspaceId ||
    !input.reason.trim()
  )
    throw new ProjectDomainError("PROJECT_WORKSPACE_TRANSFER_INVALID");
  return {
    ...input.project,
    workspaceId: input.workspaceId,
    version: input.project.version + 1,
    updatedAt: input.updatedAt,
  };
}
export class ProjectDomainError extends Error {
  constructor(
    public readonly code:
      | "PROJECT_ROLES_INVALID"
      | "PROJECT_LEAD_ASSIGNMENT_INVALID"
      | "PROJECT_LEAD_REPLACEMENT_INVALID"
      | "PROJECT_WORKSPACE_TRANSFER_INVALID"
      | "PROJECT_CANCELLATION_REASON_REQUIRED"
      | "PROJECT_PAUSE_CONTEXT_REQUIRED"
      | "PROJECT_REPLAN_REQUIRED"
      | "PROJECT_DEPENDENCY_INVALID"
      | "PROJECT_DEPENDENCY_CYCLE"
      | "PROJECT_MINIMUM_PLAN_REQUIRED"
      | "PROJECT_MANDATE_REQUIRED"
      | "PROJECT_CHANGE_REQUEST_NOT_PENDING"
      | "PROJECT_RISK_NOT_OPEN"
      | "PROJECT_OPERATIONAL_DECISION_INVALID"
      | "PROJECT_EXTERNAL_DEPENDENCY_NOT_OPEN"
      | "PROJECT_CLOSURE_EXCEPTION_INVALID"
      | "INVALID_PROJECT_TRANSITION"
      | "DECISION_CONDITIONS_PENDING",
  ) {
    super(code);
  }
}
