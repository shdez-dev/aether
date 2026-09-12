export const ProjectStatuses = [
  "planned",
  "active",
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
  sponsorActorId: string;
  leadActorId: string;
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
  planned: ["active", "cancelled"],
  active: ["blocked", "completed", "cancelled"],
  blocked: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};
export function createProject(
  input: Omit<Project, "status" | "version">,
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
    roles.get(input.leadActorId) !== "lead"
  )
    throw new ProjectDomainError("PROJECT_ROLES_INVALID");
  if (input.sponsorActorId === input.leadActorId)
    throw new ProjectDomainError("PROJECT_ROLES_INVALID");
  return {
    ...input,
    participants: [...input.participants],
    status: "planned",
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
export class ProjectDomainError extends Error {
  constructor(
    public readonly code:
      "PROJECT_ROLES_INVALID" | "INVALID_PROJECT_TRANSITION",
  ) {
    super(code);
  }
}
