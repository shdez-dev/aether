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
  status: "active" | "archived";
  archivedAt: Date | null;
  archivedByActorId: string | null;
}>;
export type Team = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  version: number;
  memberActorIds: readonly string[];
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
  listOrganizations(actorId: string): Promise<readonly Organization[]>;
  listWorkspaces(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly Workspace[]>;
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
    auditEventId: string;
    correlationId: string;
  }): Promise<Invitation | null>;
  transferOwnership(input: {
    organizationId: string;
    actorId: string;
    targetActorId: string;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<"transferred" | "actor_not_owner" | "target_not_member">;
  changeMembershipStatus(input: {
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
  >;
  reassignMemberResponsibilities(input: {
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
  >;
  archiveWorkspace(input: {
    organizationId: string;
    workspaceId: string;
    actorId: string;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<"archived" | "not_found" | "already_archived">;
  createTeam(
    input: Team & { actorId: string; correlationId: string; occurredAt: Date },
  ): Promise<"created" | "workspace_not_found" | "member_not_active">;
  listTeams(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Team[]>;
  replaceTeamMembers(input: {
    organizationId: string;
    workspaceId: string;
    teamId: string;
    actorId: string;
    memberActorIds: readonly string[];
    correlationId: string;
    occurredAt: Date;
  }): Promise<"updated" | "team_not_found" | "member_not_active">;
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
      status: "active",
      archivedAt: null,
      archivedByActorId: null,
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
  async archiveWorkspace(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    correlationId: string;
  }): Promise<void> {
    const workspace = await this.dependencies.store.findWorkspace(
      input.workspaceId,
    );
    if (!workspace || workspace.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
    await this.assertAllowed(
      input.actorId,
      input.organizationId,
      input.workspaceId,
      "workspace:manage",
    );
    const result = await this.dependencies.store.archiveWorkspace({
      ...input,
      auditEventId: this.dependencies.ids.next(),
      occurredAt: this.dependencies.clock.now(),
    });
    if (result === "not_found")
      throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
  }
  async createTeam(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    name: string;
    memberActorIds: readonly string[];
    correlationId: string;
  }): Promise<Team> {
    await this.assertAllowed(
      input.actorId,
      input.organizationId,
      input.workspaceId,
      "workspace:manage",
    );
    await assertWorkspaceWritable(this.dependencies.store, input.workspaceId);
    const memberActorIds = [...new Set(input.memberActorIds)];
    const team: Team = {
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      name: input.name,
      version: 0,
      memberActorIds,
    };
    const result = await this.dependencies.store.createTeam({
      ...team,
      actorId: input.actorId,
      correlationId: input.correlationId,
      occurredAt: this.dependencies.clock.now(),
    });
    if (result === "workspace_not_found")
      throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
    if (result === "member_not_active")
      throw new TeamError("TEAM_MEMBER_NOT_ACTIVE");
    return team;
  }
  async listTeams(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Team[]> {
    await this.assertAllowed(
      input.actorId,
      input.organizationId,
      input.workspaceId,
      "workspace:read",
    );
    return this.dependencies.store.listTeams(input);
  }
  async replaceTeamMembers(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    teamId: string;
    memberActorIds: readonly string[];
    correlationId: string;
  }): Promise<void> {
    await this.assertAllowed(
      input.actorId,
      input.organizationId,
      input.workspaceId,
      "workspace:manage",
    );
    await assertWorkspaceWritable(this.dependencies.store, input.workspaceId);
    const result = await this.dependencies.store.replaceTeamMembers({
      ...input,
      memberActorIds: [...new Set(input.memberActorIds)],
      occurredAt: this.dependencies.clock.now(),
    });
    if (result === "team_not_found") throw new TeamError("TEAM_NOT_FOUND");
    if (result === "member_not_active")
      throw new TeamError("TEAM_MEMBER_NOT_ACTIVE");
  }
  async listOrganizations(actorId: string): Promise<readonly Organization[]> {
    return this.dependencies.store.listOrganizations(actorId);
  }
  async listWorkspaces(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly Workspace[]> {
    if (!(await this.dependencies.store.findOrganizationRole(input)))
      throw new AccessDeniedError("organization:read");
    return this.dependencies.store.listWorkspaces(input);
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
    correlationId?: string;
  }): Promise<Invitation> {
    const invitation = await this.dependencies.store.acceptInvitation({
      tokenHash: this.dependencies.tokens.hash(input.token),
      actorId: input.actorId,
      actorEmail: input.actorEmail.toLowerCase(),
      now: this.dependencies.clock.now(),
      auditEventId: this.dependencies.ids.next(),
      correlationId: input.correlationId ?? this.dependencies.ids.next(),
    });
    if (!invitation) throw new InvitationError("INVITATION_INVALID_OR_EXPIRED");
    return invitation;
  }

  async transferOwnership(input: {
    actorId: string;
    organizationId: string;
    targetActorId: string;
    correlationId: string;
  }): Promise<void> {
    if (input.actorId === input.targetActorId)
      throw new OwnershipTransferError("TARGET_MUST_BE_DIFFERENT");
    const result = await this.dependencies.store.transferOwnership({
      ...input,
      auditEventId: this.dependencies.ids.next(),
      occurredAt: this.dependencies.clock.now(),
    });
    if (result !== "transferred")
      throw new OwnershipTransferError(
        result === "actor_not_owner"
          ? "ACTOR_MUST_BE_OWNER"
          : "TARGET_MUST_BE_MEMBER",
      );
  }

  async changeMembershipStatus(input: {
    actorId: string;
    organizationId: string;
    targetActorId: string;
    status: "suspended" | "revoked";
    correlationId: string;
  }): Promise<void> {
    const result = await this.dependencies.store.changeMembershipStatus({
      ...input,
      auditEventId: this.dependencies.ids.next(),
      occurredAt: this.dependencies.clock.now(),
    });
    if (result !== "changed") throw new MembershipStatusError(result);
  }

  async reassignMemberResponsibilities(input: {
    actorId: string;
    organizationId: string;
    targetActorId: string;
    replacementActorId: string;
    correlationId: string;
  }): Promise<void> {
    if (input.targetActorId === input.replacementActorId)
      throw new MembershipStatusError("replacement_not_active");
    const result = await this.dependencies.store.reassignMemberResponsibilities(
      {
        ...input,
        auditEventId: this.dependencies.ids.next(),
        occurredAt: this.dependencies.clock.now(),
      },
    );
    if (result !== "reassigned") throw new MembershipStatusError(result);
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
      | "WORKSPACE_NOT_FOUND"
      | "INITIATIVE_NOT_FOUND"
      | "PROJECT_NOT_FOUND"
      | "EVIDENCE_SUBJECT_NOT_FOUND",
  ) {
    super(code);
  }
}
export class WorkspaceArchivedError extends Error {
  constructor() {
    super("WORKSPACE_ARCHIVED");
  }
}
export async function assertWorkspaceWritable(
  tenancy: Pick<TenantStore, "findWorkspace">,
  workspaceId: string,
): Promise<void> {
  const workspace = await tenancy.findWorkspace(workspaceId);
  if (!workspace) throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
  if (workspace.status === "archived") throw new WorkspaceArchivedError();
}
export class InvitationError extends Error {
  constructor(public readonly code: "INVITATION_INVALID_OR_EXPIRED") {
    super(code);
  }
}
export class TeamError extends Error {
  constructor(
    public readonly code: "TEAM_MEMBER_NOT_ACTIVE" | "TEAM_NOT_FOUND",
  ) {
    super(code);
  }
}
export class OwnershipTransferError extends Error {
  constructor(
    public readonly code:
      | "ACTOR_MUST_BE_OWNER"
      | "TARGET_MUST_BE_MEMBER"
      | "TARGET_MUST_BE_DIFFERENT",
  ) {
    super(code);
  }
}
export class MembershipStatusError extends Error {
  constructor(
    public readonly code:
      | "actor_not_manager"
      | "target_not_member"
      | "target_is_owner"
      | "target_has_open_responsibilities"
      | "replacement_not_active"
      | "replacement_conflicts_with_project_role",
  ) {
    super(code);
  }
}
