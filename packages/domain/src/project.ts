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
export type ProjectNextAction = Readonly<{
  id: string;
  projectId: string;
  description: string;
  ownerActorId: string;
  dueOn: string | null;
  completedAt: Date | null;
  createdByActorId: string;
  createdAt: Date;
}>;
export type ProjectClosure = Readonly<{
  id: string;
  projectId: string;
  organizationId: string;
  workspaceId: string;
  outcomes: string;
  lessonsLearned: string;
  pendingItems: readonly string[];
  closedByActorId: string;
  closedAt: Date;
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
      | "PROJECT_MINIMUM_PLAN_REQUIRED"
      | "PROJECT_MANDATE_REQUIRED"
      | "INVALID_PROJECT_TRANSITION"
      | "DECISION_CONDITIONS_PENDING",
  ) {
    super(code);
  }
}
