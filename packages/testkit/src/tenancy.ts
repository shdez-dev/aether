import type {
  Invitation,
  Organization,
  OrganizationPolicy,
  EffectiveTenancyPolicy,
  WorkspacePolicyOverride,
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
  readonly organizationPolicies = new Map<string, OrganizationPolicy>();
  readonly workspacePolicyOverrides = new Map<
    string,
    WorkspacePolicyOverride
  >();
  readonly policyAuditEvents: Array<{
    id: string;
    organizationId: string;
    workspaceId: string | null;
    actorId: string;
    eventType: string;
    correlationId: string;
    occurredAt: Date;
    payload: Readonly<Record<string, unknown>>;
  }> = [];
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
    policy?: Pick<
      OrganizationPolicy,
      "dataResidencyRegion" | "retentionDays"
    > & {
      auditEventId?: string;
      correlationId?: string;
      occurredAt?: Date;
    };
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
    if (input.policy) {
      const occurredAt = input.policy.occurredAt ?? new Date();
      this.organizationPolicies.set(input.organization.id, {
        organizationId: input.organization.id,
        dataResidencyRegion: input.policy.dataResidencyRegion,
        retentionDays: input.policy.retentionDays,
        version: 0,
        updatedByActorId: input.ownerActorId,
        updatedAt: occurredAt,
      });
      this.policyAuditEvents.push({
        id: input.policy.auditEventId ?? `audit:${input.organization.id}`,
        organizationId: input.organization.id,
        workspaceId: null,
        actorId: input.ownerActorId,
        eventType: "organization.policy_configured.v1",
        correlationId:
          input.policy.correlationId ?? `correlation:${input.organization.id}`,
        occurredAt,
        payload: {
          dataResidencyRegion: input.policy.dataResidencyRegion,
          retentionDays: input.policy.retentionDays,
        },
      });
    }
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
  async replaceTeamMembers(input: {
    organizationId: string;
    workspaceId: string;
    teamId: string;
    actorId: string;
    memberActorIds: readonly string[];
    correlationId: string;
    occurredAt: Date;
  }): Promise<"updated" | "team_not_found" | "member_not_active"> {
    const team = this.teams.get(input.teamId);
    if (
      !team ||
      team.organizationId !== input.organizationId ||
      team.workspaceId !== input.workspaceId
    )
      return "team_not_found";
    if (
      input.memberActorIds.some(
        (actorId) =>
          this.organizationStatuses.get(
            this.organizationKey(actorId, input.organizationId),
          ) !== "active",
      )
    )
      return "member_not_active";
    this.teams.set(input.teamId, {
      ...team,
      memberActorIds: [...input.memberActorIds],
      version: team.version + 1,
    });
    return "updated";
  }

  async findEffectivePolicy(input: {
    organizationId: string;
    workspaceId?: string;
  }): Promise<EffectiveTenancyPolicy | null> {
    const organizationPolicy = this.organizationPolicies.get(
      input.organizationId,
    );
    if (!organizationPolicy) return null;
    const workspaceOverride = input.workspaceId
      ? (this.workspacePolicyOverrides.get(input.workspaceId) ?? null)
      : null;
    if (
      workspaceOverride &&
      workspaceOverride.organizationId !== input.organizationId
    )
      return null;
    return {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId ?? null,
      dataResidencyRegion: {
        value:
          workspaceOverride?.dataResidencyRegion ??
          organizationPolicy.dataResidencyRegion,
        origin:
          workspaceOverride?.dataResidencyRegion === null ||
          workspaceOverride?.dataResidencyRegion === undefined
            ? "organization"
            : "workspace",
      },
      retentionDays: {
        value:
          workspaceOverride?.retentionDays ?? organizationPolicy.retentionDays,
        origin:
          workspaceOverride?.retentionDays === null ||
          workspaceOverride?.retentionDays === undefined
            ? "organization"
            : "workspace",
      },
      organizationPolicy,
      workspaceOverride,
    };
  }

  async updateOrganizationPolicy(input: {
    organizationId: string;
    actorId: string;
    dataResidencyRegion: string;
    retentionDays: number;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<OrganizationPolicy> {
    const previous = this.organizationPolicies.get(input.organizationId);
    const policy: OrganizationPolicy = {
      organizationId: input.organizationId,
      dataResidencyRegion: input.dataResidencyRegion,
      retentionDays: input.retentionDays,
      version: (previous?.version ?? -1) + 1,
      updatedByActorId: input.actorId,
      updatedAt: input.occurredAt,
    };
    this.organizationPolicies.set(input.organizationId, policy);
    this.policyAuditEvents.push({
      id: input.auditEventId,
      organizationId: input.organizationId,
      workspaceId: null,
      actorId: input.actorId,
      eventType: previous
        ? "organization.policy_updated.v1"
        : "organization.policy_configured.v1",
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
      payload: {
        dataResidencyRegion: input.dataResidencyRegion,
        retentionDays: input.retentionDays,
      },
    });
    return policy;
  }

  async setWorkspacePolicyOverride(input: {
    organizationId: string;
    workspaceId: string;
    actorId: string;
    dataResidencyRegion: string | null;
    retentionDays: number | null;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<WorkspacePolicyOverride | null> {
    const workspace = this.workspaces.get(input.workspaceId);
    if (!workspace || workspace.organizationId !== input.organizationId)
      return null;
    const previous = this.workspacePolicyOverrides.get(input.workspaceId);
    const override: WorkspacePolicyOverride = {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      dataResidencyRegion: input.dataResidencyRegion,
      retentionDays: input.retentionDays,
      version: (previous?.version ?? -1) + 1,
      updatedByActorId: input.actorId,
      updatedAt: input.occurredAt,
    };
    this.workspacePolicyOverrides.set(input.workspaceId, override);
    this.policyAuditEvents.push({
      id: input.auditEventId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      eventType: "workspace.policy_override_set.v1",
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
      payload: {
        dataResidencyRegion: input.dataResidencyRegion,
        retentionDays: input.retentionDays,
      },
    });
    return override;
  }

  async clearWorkspacePolicyOverride(input: {
    organizationId: string;
    workspaceId: string;
    actorId: string;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<"cleared" | "not_found"> {
    const workspace = this.workspaces.get(input.workspaceId);
    if (
      !workspace ||
      workspace.organizationId !== input.organizationId ||
      !this.workspacePolicyOverrides.has(input.workspaceId)
    )
      return "not_found";
    this.workspacePolicyOverrides.delete(input.workspaceId);
    this.policyAuditEvents.push({
      id: input.auditEventId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      eventType: "workspace.policy_override_cleared.v1",
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
      payload: {},
    });
    return "cleared";
  }

  private organizationKey(actorId: string, organizationId: string): string {
    return `${actorId}:${organizationId}`;
  }
  private workspaceKey(actorId: string, workspaceId: string): string {
    return `${actorId}:${workspaceId}`;
  }
}
