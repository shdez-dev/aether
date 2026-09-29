import {
  getOrganizationRoleProfile,
  type ResponsibilityRoleKey,
  type OrganizationType,
} from "@aether/domain";

export type InitiativeResponsibilityRole = Extract<
  ResponsibilityRoleKey,
  | "initiative_coordinator"
  | "initiative_evaluator"
  | "initiative_approver"
  | "initiative_mentor"
>;

import {
  AccessDeniedError,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";

export type OrganizationResponsibilityAssignment = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  actorId: string;
  actorName: string;
  actorEmail: string | null;
  roleKey: InitiativeResponsibilityRole;
  initiativeId: string | null;
  initiativeTitle: string | null;
  validUntil: Date | null;
  assignedByActorId: string;
  assignedAt: Date;
}>;

export type OrganizationResponsibilityMember = Readonly<{
  actorId: string;
  actorName: string;
  actorEmail: string | null;
  organizationRole: "owner" | "admin" | "member";
  workspaceRole: "admin" | "member" | "viewer" | null;
}>;

export type OrganizationResponsibilityInitiative = Readonly<{
  id: string;
  title: string;
  status: string;
}>;

export interface OrganizationResponsibilityStore {
  listMembers(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly OrganizationResponsibilityMember[]>;
  listAssignments(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly OrganizationResponsibilityAssignment[]>;
  listInitiatives(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly OrganizationResponsibilityInitiative[]>;
  findInitiative(input: {
    organizationId: string;
    workspaceId: string;
    initiativeId: string;
  }): Promise<OrganizationResponsibilityInitiative | null>;
  findAssignment(input: {
    organizationId: string;
    assignmentId: string;
  }): Promise<OrganizationResponsibilityAssignment | null>;
  createAssignment(input: {
    assignment: OrganizationResponsibilityAssignment;
    auditEvent: OrganizationResponsibilityAuditEvent;
  }): Promise<"created" | "already_assigned" | "member_not_active">;
  revokeAssignment(input: {
    organizationId: string;
    assignmentId: string;
    actorId: string;
    auditEvent: OrganizationResponsibilityAuditEvent;
  }): Promise<"revoked" | "not_found">;
  hasActiveAssignment(input: {
    organizationId: string;
    workspaceId: string;
    actorId: string;
    roleKey: InitiativeResponsibilityRole;
    initiativeId?: string;
  }): Promise<boolean>;
}

export type OrganizationResponsibilityAuditEvent = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  actorId: string;
  targetActorId: string;
  roleKey: InitiativeResponsibilityRole;
  initiativeId: string | null;
  validUntil: Date | null;
  eventType:
    | "organization.responsibility_assigned.v1"
    | "organization.responsibility_revoked.v1";
  correlationId: string;
  occurredAt: Date;
}>;

export class OrganizationResponsibilityError extends Error {
  constructor(
    readonly code:
      | "ROLE_NOT_AVAILABLE"
      | "MEMBER_NOT_IN_WORKSPACE"
      | "ALREADY_ASSIGNED"
      | "ASSIGNMENT_NOT_FOUND"
      | "MENTOR_SCOPE_REQUIRED"
      | "MENTOR_VALIDITY_INVALID"
      | "ROLE_SCOPE_INVALID",
  ) {
    super(code);
    this.name = "OrganizationResponsibilityError";
  }
}

export class OrganizationResponsibilityService {
  constructor(
    private readonly dependencies: {
      store: OrganizationResponsibilityStore;
      tenancy: TenantStore;
      ids: { next(): string };
      clock: { now(): Date };
    },
  ) {}

  async list(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
  }): Promise<{
    members: readonly OrganizationResponsibilityMember[];
    initiatives: readonly OrganizationResponsibilityInitiative[];
    assignments: readonly OrganizationResponsibilityAssignment[];
  }> {
    await this.assertManager(input.actorId, input.organizationId);
    const workspace = await this.requireWorkspace(
      input.organizationId,
      input.workspaceId,
    );
    if (workspace.status !== "active")
      throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
    const [members, initiatives, assignments] = await Promise.all([
      this.dependencies.store.listMembers(input),
      this.dependencies.store.listInitiatives(input),
      this.dependencies.store.listAssignments(input),
    ]);
    return { members, initiatives, assignments };
  }

  async assign(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    targetActorId: string;
    roleKey: InitiativeResponsibilityRole;
    initiativeId?: string;
    validUntil?: string;
    correlationId: string;
  }): Promise<OrganizationResponsibilityAssignment> {
    await this.assertManager(input.actorId, input.organizationId);
    const workspace = await this.requireWorkspace(
      input.organizationId,
      input.workspaceId,
    );
    if (workspace.status !== "active")
      throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
    const organization = (
      await this.dependencies.tenancy.listOrganizations(input.actorId)
    ).find((item) => item.id === input.organizationId);
    if (!organization)
      throw new ResourceNotFoundError("ORGANIZATION_NOT_FOUND");
    this.assertRoleAvailable(organization.organizationType, input.roleKey);

    let initiativeTitle: string | null = null;
    let validUntil: Date | null = null;
    if (input.roleKey === "initiative_mentor") {
      if (!input.initiativeId || !input.validUntil)
        throw new OrganizationResponsibilityError("MENTOR_SCOPE_REQUIRED");
      const initiative = await this.dependencies.store.findInitiative({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        initiativeId: input.initiativeId,
      });
      if (!initiative)
        throw new OrganizationResponsibilityError("MENTOR_SCOPE_REQUIRED");
      initiativeTitle = initiative.title;
      validUntil = new Date(`${input.validUntil}T23:59:59.999Z`);
      const maxExpiry = new Date(
        this.dependencies.clock.now().getTime() + 365 * 86_400_000,
      );
      if (
        !Number.isFinite(validUntil.getTime()) ||
        validUntil <= this.dependencies.clock.now() ||
        validUntil > maxExpiry
      )
        throw new OrganizationResponsibilityError("MENTOR_VALIDITY_INVALID");
    } else if (input.initiativeId || input.validUntil) {
      throw new OrganizationResponsibilityError("ROLE_SCOPE_INVALID");
    }

    const [targetOrganizationRole, targetWorkspaceRole] = await Promise.all([
      this.dependencies.tenancy.findOrganizationRole({
        actorId: input.targetActorId,
        organizationId: input.organizationId,
      }),
      this.dependencies.tenancy.findWorkspaceRole({
        actorId: input.targetActorId,
        workspaceId: input.workspaceId,
      }),
    ]);
    if (
      !targetOrganizationRole ||
      (targetOrganizationRole !== "owner" &&
        targetOrganizationRole !== "admin" &&
        targetWorkspaceRole === null)
    )
      throw new OrganizationResponsibilityError("MEMBER_NOT_IN_WORKSPACE");

    const now = this.dependencies.clock.now();
    const assignment: OrganizationResponsibilityAssignment = {
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      workspaceName: workspace.name,
      actorId: input.targetActorId,
      actorName: input.targetActorId,
      actorEmail: null,
      roleKey: input.roleKey,
      initiativeId: input.initiativeId ?? null,
      initiativeTitle,
      validUntil,
      assignedByActorId: input.actorId,
      assignedAt: now,
    };
    const result = await this.dependencies.store.createAssignment({
      assignment,
      auditEvent: {
        id: this.dependencies.ids.next(),
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        targetActorId: input.targetActorId,
        roleKey: input.roleKey,
        initiativeId: input.initiativeId ?? null,
        validUntil,
        eventType: "organization.responsibility_assigned.v1",
        correlationId: input.correlationId,
        occurredAt: now,
      },
    });
    if (result === "already_assigned")
      throw new OrganizationResponsibilityError("ALREADY_ASSIGNED");
    if (result === "member_not_active")
      throw new OrganizationResponsibilityError("MEMBER_NOT_IN_WORKSPACE");
    return (
      (
        await this.dependencies.store.listAssignments({
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
        })
      ).find((item) => item.id === assignment.id) ?? assignment
    );
  }

  async revoke(input: {
    actorId: string;
    organizationId: string;
    assignmentId: string;
    correlationId: string;
  }): Promise<void> {
    await this.assertManager(input.actorId, input.organizationId);
    const target = await this.dependencies.store.findAssignment({
      organizationId: input.organizationId,
      assignmentId: input.assignmentId,
    });
    if (!target)
      throw new OrganizationResponsibilityError("ASSIGNMENT_NOT_FOUND");
    const now = this.dependencies.clock.now();
    const result = await this.dependencies.store.revokeAssignment({
      organizationId: input.organizationId,
      assignmentId: input.assignmentId,
      actorId: input.actorId,
      auditEvent: {
        id: this.dependencies.ids.next(),
        organizationId: input.organizationId,
        workspaceId: target.workspaceId,
        actorId: input.actorId,
        targetActorId: target.actorId,
        roleKey: target.roleKey,
        initiativeId: target.initiativeId,
        validUntil: target.validUntil,
        eventType: "organization.responsibility_revoked.v1",
        correlationId: input.correlationId,
        occurredAt: now,
      },
    });
    if (result === "not_found")
      throw new OrganizationResponsibilityError("ASSIGNMENT_NOT_FOUND");
  }

  hasActiveAssignment(input: {
    organizationId: string;
    workspaceId: string;
    actorId: string;
    roleKey: InitiativeResponsibilityRole;
    initiativeId?: string;
  }): Promise<boolean> {
    return this.dependencies.store.hasActiveAssignment(input);
  }

  private async requireWorkspace(organizationId: string, workspaceId: string) {
    const workspace =
      await this.dependencies.tenancy.findWorkspace(workspaceId);
    if (!workspace || workspace.organizationId !== organizationId)
      throw new ResourceNotFoundError("WORKSPACE_NOT_FOUND");
    return workspace;
  }

  private async assertManager(actorId: string, organizationId: string) {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (role !== "owner" && role !== "admin")
      throw new AccessDeniedError("organization:manage");
  }

  private assertRoleAvailable(
    organizationType: OrganizationType | null,
    roleKey: InitiativeResponsibilityRole,
  ) {
    const role = getOrganizationRoleProfile(
      organizationType,
    ).initiativeResponsibilities.find((candidate) => candidate.key === roleKey);
    if (!role || role.implementationStatus !== "implemented")
      throw new OrganizationResponsibilityError("ROLE_NOT_AVAILABLE");
  }
}
