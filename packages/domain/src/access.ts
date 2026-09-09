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
