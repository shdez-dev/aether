import {
  calculateCapabilities,
  isActionAllowed,
  type AccessCapabilities,
  type AuthorizationAction,
  type OrganizationRole,
  type WorkspaceRole,
} from "@aether/domain";

export type Organization = Readonly<{
  id: string;
  name: string;
  timezone: string;
  locale: string;
  version: number;
}>;
export type Workspace = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  mode: "personal" | "team" | "institutional";
  version: number;
}>;
export type Invitation = Readonly<{
  id: string;
  organizationId: string;
  email: string;
  organizationRole: OrganizationRole;
  workspaceIds: readonly string[];
  workspaceRole: WorkspaceRole;
  expiresAt: Date;
}>;

export interface TenantStore {
  bootstrapOrganization(input: {
    organization: Organization;
    ownerActorId: string;
    ownerEmail: string;
  }): Promise<void>;
  createWorkspace(workspace: Workspace): Promise<void>;
  findWorkspace(workspaceId: string): Promise<Workspace | null>;
  findOrganizationRole(input: {
    actorId: string;
    organizationId: string;
  }): Promise<OrganizationRole | null>;
  findWorkspaceRole(input: {
    actorId: string;
    workspaceId: string;
  }): Promise<WorkspaceRole | null>;
  createInvitation(input: Invitation & { tokenHash: string }): Promise<void>;
  acceptInvitation(input: {
    tokenHash: string;
    actorId: string;
    actorEmail: string;
    now: Date;
  }): Promise<Invitation | null>;
}

export interface TenantIdGenerator {
  next(): string;
}
export interface InvitationTokenService {
  generate(): string;
  hash(value: string): string;
}
export interface TenantClock {
  now(): Date;
}

export class TenantService {
  constructor(
    private readonly dependencies: {
      store: TenantStore;
      ids: TenantIdGenerator;
      tokens: InvitationTokenService;
      clock: TenantClock;
    },
  ) {}

  async createOrganization(input: {
    actorId: string;
    actorEmail: string;
    name: string;
    timezone: string;
    locale: string;
  }): Promise<Organization> {
    const organization: Organization = {
      id: this.dependencies.ids.next(),
      name: input.name,
      timezone: input.timezone,
      locale: input.locale,
      version: 0,
    };
    await this.dependencies.store.bootstrapOrganization({
      organization,
      ownerActorId: input.actorId,
      ownerEmail: input.actorEmail,
    });
    return organization;
  }

  async createWorkspace(input: {
    actorId: string;
    organizationId: string;
    name: string;
    mode: Workspace["mode"];
  }): Promise<Workspace> {
    await this.assertAllowed(
      input.actorId,
      input.organizationId,
      null,
      "workspace:create",
    );
    const workspace: Workspace = {
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      name: input.name,
      mode: input.mode,
      version: 0,
    };
    await this.dependencies.store.createWorkspace(workspace);
    return workspace;
  }

  async getWorkspace(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
  }): Promise<Workspace> {
    const workspace = await this.dependencies.store.findWorkspace(
      input.workspaceId,
    );
    if (!workspace || workspace.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
    await this.assertAllowed(
      input.actorId,
      input.organizationId,
      workspace.id,
      "workspace:read",
    );
    return workspace;
  }

  async invite(input: {
    actorId: string;
    organizationId: string;
    email: string;
    organizationRole: OrganizationRole;
    workspaceIds: readonly string[];
    workspaceRole: WorkspaceRole;
    expiresInDays: number;
  }): Promise<{ invitation: Invitation; deliveryToken: string }> {
    await this.assertAllowed(
      input.actorId,
      input.organizationId,
      null,
      "member:invite",
    );
    if (input.organizationRole === "owner")
      throw new InvitationError("INVITATION_INVALID_OR_EXPIRED");
    for (const workspaceId of input.workspaceIds) {
      const workspace =
        await this.dependencies.store.findWorkspace(workspaceId);
      if (!workspace || workspace.organizationId !== input.organizationId)
        throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
    }
    const now = this.dependencies.clock.now();
    const token = this.dependencies.tokens.generate();
    const invitation: Invitation = {
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      email: input.email.toLowerCase(),
      organizationRole: input.organizationRole,
      workspaceIds: [...input.workspaceIds],
      workspaceRole: input.workspaceRole,
      expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000),
    };
    await this.dependencies.store.createInvitation({
      ...invitation,
      tokenHash: this.dependencies.tokens.hash(token),
    });
    return { invitation, deliveryToken: token };
  }

  async acceptInvitation(input: {
    token: string;
    actorId: string;
    actorEmail: string;
  }): Promise<Invitation> {
    const invitation = await this.dependencies.store.acceptInvitation({
      tokenHash: this.dependencies.tokens.hash(input.token),
      actorId: input.actorId,
      actorEmail: input.actorEmail.toLowerCase(),
      now: this.dependencies.clock.now(),
    });
    if (!invitation) throw new InvitationError("INVITATION_INVALID_OR_EXPIRED");
    return invitation;
  }

  async capabilities(input: {
    actorId: string;
    organizationId: string;
    workspaceId?: string;
  }): Promise<AccessCapabilities> {
    if (input.workspaceId) {
      const workspace = await this.dependencies.store.findWorkspace(
        input.workspaceId,
      );
      if (!workspace || workspace.organizationId !== input.organizationId)
        throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
    }
    const organizationRole = await this.dependencies.store.findOrganizationRole(
      { actorId: input.actorId, organizationId: input.organizationId },
    );
    const workspaceRole = input.workspaceId
      ? await this.dependencies.store.findWorkspaceRole({
          actorId: input.actorId,
          workspaceId: input.workspaceId,
        })
      : null;
    return calculateCapabilities({ organizationRole, workspaceRole });
  }

  private async assertAllowed(
    actorId: string,
    organizationId: string,
    workspaceId: string | null,
    action: AuthorizationAction,
  ): Promise<void> {
    const capabilities = await this.capabilities({
      actorId,
      organizationId,
      ...(workspaceId ? { workspaceId } : {}),
    });
    if (!isActionAllowed(action, capabilities))
      throw new AccessDeniedError(action);
  }
}

export class AccessDeniedError extends Error {
  constructor(public readonly action: AuthorizationAction) {
    super(`Access denied: ${action}`);
  }
}
export class ResourceNotFoundError extends Error {
  constructor(
    public readonly code:
      "WORKSPACE_NOT_FOUND" | "INITIATIVE_NOT_FOUND" | "PROJECT_NOT_FOUND",
  ) {
    super(code);
  }
}
export class InvitationError extends Error {
  constructor(public readonly code: "INVITATION_INVALID_OR_EXPIRED") {
    super(code);
  }
}
