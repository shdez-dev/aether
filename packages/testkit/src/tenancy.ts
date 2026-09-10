import type {
  Invitation,
  Organization,
  TenantStore,
  Workspace,
} from "@aether/application";
import type { OrganizationRole, WorkspaceRole } from "@aether/domain";

/** Store determinista para pruebas de autorización y aislamiento multi-tenant. */
export class InMemoryTenantStore implements TenantStore {
  readonly organizations = new Map<string, Organization>();
  readonly workspaces = new Map<string, Workspace>();
  readonly invitations = new Map<string, Invitation & { tokenHash: string }>();
  private readonly organizationRoles = new Map<string, OrganizationRole>();
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
  }
  async createWorkspace(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }
  async findWorkspace(workspaceId: string): Promise<Workspace | null> {
    return this.workspaces.get(workspaceId) ?? null;
  }
  async listOrganizations(actorId: string): Promise<readonly Organization[]> {
    const ids = [...this.organizationRoles.keys()]
      .filter((key) => key.startsWith(`${actorId}:`))
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
    return (
      this.organizationRoles.get(
        this.organizationKey(input.actorId, input.organizationId),
      ) ?? null
    );
  }
  async findWorkspaceRole(input: {
    actorId: string;
    workspaceId: string;
  }): Promise<WorkspaceRole | null> {
    return (
      this.workspaceRoles.get(
        this.workspaceKey(input.actorId, input.workspaceId),
      ) ?? null
    );
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
    for (const workspaceId of invitation.workspaceIds)
      this.workspaceRoles.set(
        this.workspaceKey(input.actorId, workspaceId),
        invitation.workspaceRole,
      );
    return invitation;
  }

  private organizationKey(actorId: string, organizationId: string): string {
    return `${actorId}:${organizationId}`;
  }
  private workspaceKey(actorId: string, workspaceId: string): string {
    return `${actorId}:${workspaceId}`;
  }
}
