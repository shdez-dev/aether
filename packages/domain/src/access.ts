export const OrganizationRoles = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof OrganizationRoles)[number];

export const WorkspaceRoles = ["admin", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WorkspaceRoles)[number];

export type AuthorizationAction =
  | "organization:read"
  | "organization:manage"
  | "organization:ownership-transfer"
  | "workspace:create"
  | "workspace:read"
  | "workspace:manage"
  | "workspace:archive"
  | "team:create"
  | "team:read"
  | "team:manage-members"
  | "member:invite"
  | "membership:manage"
  | "organization-policy:read"
  | "organization-policy:manage"
  | "workspace-policy:read"
  | "workspace-policy:manage";

export type CapabilityAuthorizationAction =
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

type PermissionRule = Readonly<{
  capability: keyof AccessCapabilities;
  organizationRoles?: readonly OrganizationRole[];
  workspaceRoles?: readonly WorkspaceRole[];
}>;

export type AuthorizationContext = Readonly<{
  organizationRole: OrganizationRole | null;
  workspaceRole: WorkspaceRole | null;
}>;

/**
 * Matriz ejecutable para acciones de tenencia. La aplicación debe preguntar a
 * esta política y no reconstruir permisos a partir de los roles en cada caso
 * de uso. Las acciones propias de un agregado (iniciativa, proyecto, etc.)
 * agregan además sus invariantes de estado y propiedad.
 */
export const AuthorizationMatrix: Readonly<
  Record<AuthorizationAction, PermissionRule>
> = {
  "organization:read": {
    capability: "canReadOrganization",
    organizationRoles: OrganizationRoles,
  },
  "organization:manage": {
    capability: "canManageOrganization",
    organizationRoles: ["owner", "admin"],
  },
  "organization:ownership-transfer": {
    capability: "canManageOrganization",
    organizationRoles: ["owner"],
  },
  "workspace:create": {
    capability: "canCreateWorkspace",
    organizationRoles: ["owner", "admin"],
  },
  "workspace:read": {
    capability: "canReadWorkspace",
    organizationRoles: ["owner", "admin"],
    workspaceRoles: WorkspaceRoles,
  },
  "workspace:manage": {
    capability: "canManageWorkspace",
    organizationRoles: ["owner", "admin"],
    workspaceRoles: ["admin"],
  },
  "workspace:archive": {
    capability: "canManageWorkspace",
    organizationRoles: ["owner", "admin"],
    workspaceRoles: ["admin"],
  },
  "team:create": {
    capability: "canManageWorkspace",
    organizationRoles: ["owner", "admin"],
    workspaceRoles: ["admin"],
  },
  "team:read": {
    capability: "canReadWorkspace",
    organizationRoles: ["owner", "admin"],
    workspaceRoles: WorkspaceRoles,
  },
  "team:manage-members": {
    capability: "canManageWorkspace",
    organizationRoles: ["owner", "admin"],
    workspaceRoles: ["admin"],
  },
  "member:invite": {
    capability: "canInviteMembers",
    organizationRoles: ["owner", "admin"],
  },
  "membership:manage": {
    capability: "canManageOrganization",
    organizationRoles: ["owner", "admin"],
  },
  "organization-policy:read": {
    capability: "canReadOrganization",
    organizationRoles: OrganizationRoles,
  },
  "organization-policy:manage": {
    capability: "canManageOrganization",
    organizationRoles: ["owner", "admin"],
  },
  "workspace-policy:read": {
    capability: "canReadWorkspace",
    organizationRoles: ["owner", "admin"],
    workspaceRoles: WorkspaceRoles,
  },
  "workspace-policy:manage": {
    capability: "canManageWorkspace",
    organizationRoles: ["owner", "admin"],
    workspaceRoles: ["admin"],
  },
};

function roleIsAllowed<T extends string>(
  role: T | null,
  permitted: readonly T[] | undefined,
): boolean {
  return role !== null && permitted?.includes(role) === true;
}

function allows(
  action: AuthorizationAction,
  input: AuthorizationContext,
): boolean {
  const rule = AuthorizationMatrix[action];
  return (
    roleIsAllowed(input.organizationRole, rule.organizationRoles) ||
    roleIsAllowed(input.workspaceRole, rule.workspaceRoles)
  );
}

export function calculateCapabilities(
  input: AuthorizationContext,
): AccessCapabilities {
  return {
    canReadOrganization: allows("organization:read", input),
    canManageOrganization: allows("organization:manage", input),
    canCreateWorkspace: allows("workspace:create", input),
    canReadWorkspace: allows("workspace:read", input),
    canManageWorkspace: allows("workspace:manage", input),
    canInviteMembers: allows("member:invite", input),
  };
}

export function isActionAllowed(
  action: CapabilityAuthorizationAction,
  capabilities: AccessCapabilities,
): boolean {
  return capabilities[AuthorizationMatrix[action].capability];
}

export function isRoleAllowed(
  action: AuthorizationAction,
  input: AuthorizationContext,
): boolean {
  return allows(action, input);
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
  if (
    (input.status === "draft" || input.status === "returned") &&
    authorOrManager
  )
    actions.push("edit", "present");
  if (input.status === "presented" && organizationManager)
    actions.push("review");
  if (input.status === "under_review" && input.organizationRole === "owner")
    actions.push("decide");
  return actions;
}
