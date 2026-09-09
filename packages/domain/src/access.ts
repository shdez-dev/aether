export const OrganizationRoles = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof OrganizationRoles)[number];

export const WorkspaceRoles = ["admin", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WorkspaceRoles)[number];

export type AuthorizationAction =
  | "organization:read"
  | "organization:manage"
  | "workspace:create"
  | "workspace:read"
  | "workspace:manage"
  | "member:invite";

export type InitiativeAction = "edit" | "present" | "review" | "decide";

export type AccessCapabilities = Readonly<{
  canReadOrganization: boolean;
  canManageOrganization: boolean;
  canCreateWorkspace: boolean;
  canReadWorkspace: boolean;
  canManageWorkspace: boolean;
  canInviteMembers: boolean;
}>;

export function calculateCapabilities(input: {
  organizationRole: OrganizationRole | null;
  workspaceRole: WorkspaceRole | null;
}): AccessCapabilities {
  const isOrganizationManager =
    input.organizationRole === "owner" || input.organizationRole === "admin";
  const canReadOrganization = input.organizationRole !== null;
  const canReadWorkspace =
    isOrganizationManager || input.workspaceRole !== null;
  return {
    canReadOrganization,
    canManageOrganization: isOrganizationManager,
    canCreateWorkspace: isOrganizationManager,
    canReadWorkspace,
    canManageWorkspace:
      isOrganizationManager || input.workspaceRole === "admin",
    canInviteMembers: isOrganizationManager,
  };
}

export function isActionAllowed(
  action: AuthorizationAction,
  capabilities: AccessCapabilities,
): boolean {
  switch (action) {
    case "organization:read":
      return capabilities.canReadOrganization;
    case "organization:manage":
      return capabilities.canManageOrganization;
    case "workspace:create":
      return capabilities.canCreateWorkspace;
    case "workspace:read":
      return capabilities.canReadWorkspace;
    case "workspace:manage":
      return capabilities.canManageWorkspace;
    case "member:invite":
      return capabilities.canInviteMembers;
  }
}

export function canCreateInitiative(input: {
  organizationRole: OrganizationRole | null;
  workspaceRole: WorkspaceRole | null;
}): boolean {
  return (
    input.organizationRole === "owner" ||
    input.organizationRole === "admin" ||
    input.workspaceRole === "admin" ||
    input.workspaceRole === "member"
  );
}

export function allowedInitiativeActions(input: {
  organizationRole: OrganizationRole | null;
  workspaceRole: WorkspaceRole | null;
  actorId: string;
  createdByActorId: string;
  status: import("./initiative.js").InitiativeStatus;
}): readonly InitiativeAction[] {
  const organizationManager =
    input.organizationRole === "owner" || input.organizationRole === "admin";
  const workspaceManager = input.workspaceRole === "admin";
  const authorOrManager =
    input.actorId === input.createdByActorId ||
    organizationManager ||
    workspaceManager;
  const actions: InitiativeAction[] = [];
  if (input.status === "draft" && authorOrManager)
    actions.push("edit", "present");
  if (input.status === "presented" && organizationManager)
    actions.push("review");
  if (input.status === "under_review" && input.organizationRole === "owner")
    actions.push("decide");
  return actions;
}
