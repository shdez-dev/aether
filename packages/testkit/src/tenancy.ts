import type {
  Invitation,
  Organization,
  Team,
  TenantStore,
  Workspace,
} from "@aether/application";
import type { OrganizationRole, WorkspaceRole } from "@aether/domain";

/** Store determinista para pruebas de autorización y aislamiento multi-tenant. */
export class InMemoryTenantStore implements TenantStore {
  readonly organizations = new Map<string, Organization>();
  readonly workspaces = new Map<string, Workspace>();
  readonly invitations = new Map<string, Invitation & { tokenHash: string }>();
  readonly teams = new Map<string, Team>();
  readonly ownershipTransfers: Array<{
    organizationId: string;
    actorId: string;
    targetActorId: string;
    correlationId: string;
  }> = [];
  private readonly organizationRoles = new Map<string, OrganizationRole>();
  private readonly organizationStatuses = new Map<
    string,
    "active" | "suspended" | "revoked"
  >();
  private readonly workspaceRoles = new Map<string, WorkspaceRole>();

  async bootstrapOrganization(input: {
    organization: Organization;
    ownerActorId: string;
    ownerEmail: string;
  }): Promise<void> {
    this.organizations.set(input.organization.id, input.organization);
    this.organizationRoles.set(
      this.organizationKey(input.ownerActorId, input.organization.id),
      "owner",
    );
    this.organizationStatuses.set(
      this.organizationKey(input.ownerActorId, input.organization.id),
      "active",
    );
  }
  async createWorkspace(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }
  async findWorkspace(workspaceId: string): Promise<Workspace | null> {
    return this.workspaces.get(workspaceId) ?? null;
  }
  async listOrganizations(actorId: string): Promise<readonly Organization[]> {
    const ids = [...this.organizationRoles.keys()]
      .filter(
        (key) =>
          key.startsWith(`${actorId}:`) &&
          this.organizationStatuses.get(key) === "active",
      )
      .map((key) => key.slice(actorId.length + 1));
    return [...this.organizations.values()].filter((organization) =>
      ids.includes(organization.id),
    );
  }
  async listWorkspaces(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly Workspace[]> {
    return [...this.workspaces.values()].filter(
      (workspace) =>
        workspace.organizationId === input.organizationId &&
        this.organizationStatuses.get(
          `${input.actorId}:${input.organizationId}`,
        ) === "active" &&
        (this.organizationRoles.has(
          `${input.actorId}:${input.organizationId}`,
        ) ||
          this.workspaceRoles.has(`${input.actorId}:${workspace.id}`)),
    );
  }
  async findOrganizationRole(input: {
    actorId: string;
    organizationId: string;
  }): Promise<OrganizationRole | null> {
    const key = this.organizationKey(input.actorId, input.organizationId);
    return this.organizationStatuses.get(key) === "active"
      ? (this.organizationRoles.get(key) ?? null)
      : null;
  }
  async findWorkspaceRole(input: {
    actorId: string;
    workspaceId: string;
  }): Promise<WorkspaceRole | null> {
    const workspace = this.workspaces.get(input.workspaceId);
    if (!workspace) return null;
    const organizationKey = this.organizationKey(
      input.actorId,
      workspace.organizationId,
    );
    return this.organizationStatuses.get(organizationKey) === "active"
      ? (this.workspaceRoles.get(
          this.workspaceKey(input.actorId, input.workspaceId),
        ) ?? null)
      : null;
  }
  async createInvitation(
    input: Invitation & { tokenHash: string },
  ): Promise<void> {
    this.invitations.set(input.tokenHash, input);
  }
  async acceptInvitation(input: {
    tokenHash: string;
    actorId: string;
    actorEmail: string;
    now: Date;
    auditEventId: string;
    correlationId: string;
  }): Promise<Invitation | null> {
    const invitation = this.invitations.get(input.tokenHash);
    if (
      !invitation ||
      invitation.expiresAt <= input.now ||
      invitation.email.toLowerCase() !== input.actorEmail.toLowerCase()
    )
      return null;
    this.invitations.delete(input.tokenHash);
    this.organizationRoles.set(
      this.organizationKey(input.actorId, invitation.organizationId),
      invitation.organizationRole,
    );
    this.organizationStatuses.set(
      this.organizationKey(input.actorId, invitation.organizationId),
      "active",
    );
    for (const workspaceId of invitation.workspaceIds)
      this.workspaceRoles.set(
        this.workspaceKey(input.actorId, workspaceId),
        invitation.workspaceRole,
      );
    return invitation;
  }
  async transferOwnership(input: {
    organizationId: string;
    actorId: string;
    targetActorId: string;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<"transferred" | "actor_not_owner" | "target_not_member"> {
    const actorKey = this.organizationKey(input.actorId, input.organizationId);
    const targetKey = this.organizationKey(
      input.targetActorId,
      input.organizationId,
    );
    if (this.organizationRoles.get(actorKey) !== "owner")
      return "actor_not_owner";
    if (
      !this.organizationRoles.has(targetKey) ||
      this.organizationStatuses.get(targetKey) !== "active"
    )
      return "target_not_member";
    this.organizationRoles.set(targetKey, "owner");
    this.organizationRoles.set(actorKey, "admin");
    this.ownershipTransfers.push({
      organizationId: input.organizationId,
      actorId: input.actorId,
      targetActorId: input.targetActorId,
      correlationId: input.correlationId,
    });
    return "transferred";
  }
  async changeMembershipStatus(input: {
    organizationId: string;
    actorId: string;
    targetActorId: string;
    status: "suspended" | "revoked";
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<
    | "changed"
    | "actor_not_manager"
    | "target_not_member"
    | "target_is_owner"
    | "target_has_open_responsibilities"
  > {
    const actorKey = this.organizationKey(input.actorId, input.organizationId);
    const targetKey = this.organizationKey(
      input.targetActorId,
      input.organizationId,
    );
    const actorRole = this.organizationRoles.get(actorKey);
    if (
      this.organizationStatuses.get(actorKey) !== "active" ||
      (actorRole !== "owner" && actorRole !== "admin")
    )
      return "actor_not_manager";
    if (!this.organizationRoles.has(targetKey)) return "target_not_member";
    if (this.organizationRoles.get(targetKey) === "owner")
      return "target_is_owner";
    this.organizationStatuses.set(targetKey, input.status);
    return "changed";
  }
  async reassignMemberResponsibilities(input: {
    organizationId: string;
    actorId: string;
    targetActorId: string;
    replacementActorId: string;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<
    | "reassigned"
    | "actor_not_manager"
    | "target_not_member"
    | "replacement_not_active"
    | "replacement_conflicts_with_project_role"
  > {
    const actor = this.organizationKey(input.actorId, input.organizationId);
    const target = this.organizationKey(
      input.targetActorId,
      input.organizationId,
    );
    const replacement = this.organizationKey(
      input.replacementActorId,
      input.organizationId,
    );
    if (
      this.organizationStatuses.get(actor) !== "active" ||
      !["owner", "admin"].includes(
        this.organizationRoles.get(actor) ?? "member",
      )
    )
      return "actor_not_manager";
    if (!this.organizationRoles.has(target)) return "target_not_member";
    if (this.organizationStatuses.get(replacement) !== "active")
      return "replacement_not_active";
    return "reassigned";
  }
  async archiveWorkspace(input: {
    organizationId: string;
    workspaceId: string;
    actorId: string;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<"archived" | "not_found" | "already_archived"> {
    const workspace = this.workspaces.get(input.workspaceId);
    if (!workspace || workspace.organizationId !== input.organizationId)
      return "not_found";
    if (workspace.status === "archived") return "already_archived";
    this.workspaces.set(input.workspaceId, {
      ...workspace,
      status: "archived",
      archivedAt: input.occurredAt,
      archivedByActorId: input.actorId,
      version: workspace.version + 1,
    });
    return "archived";
  }
  async createTeam(
    input: Team & {
      actorId: string;
      correlationId: string;
      occurredAt: Date;
    },
  ): Promise<"created" | "workspace_not_found" | "member_not_active"> {
    const workspace = this.workspaces.get(input.workspaceId);
    if (
      !workspace ||
      workspace.organizationId !== input.organizationId ||
      workspace.status !== "active"
    )
      return "workspace_not_found";
    if (
      input.memberActorIds.some(
        (actorId) =>
          this.organizationStatuses.get(
            this.organizationKey(actorId, input.organizationId),
          ) !== "active",
      )
    )
      return "member_not_active";
    this.teams.set(input.id, {
      id: input.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      name: input.name,
      version: input.version,
      memberActorIds: [...input.memberActorIds],
    });
    return "created";
  }
  async listTeams(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Team[]> {
    return [...this.teams.values()].filter(
      (team) =>
        team.organizationId === input.organizationId &&
        team.workspaceId === input.workspaceId,
    );
  }

  private organizationKey(actorId: string, organizationId: string): string {
    return `${actorId}:${organizationId}`;
  }
  private workspaceKey(actorId: string, workspaceId: string): string {
    return `${actorId}:${workspaceId}`;
  }
}
