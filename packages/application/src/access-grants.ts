import {
  AccessDeniedError,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";

export const temporaryGrantResourceTypes = [
  "workspace",
  "initiative",
  "evaluation",
  "decision",
  "project",
  "document",
] as const;
export type TemporaryGrantResourceType =
  (typeof temporaryGrantResourceTypes)[number];
export const temporaryGrantActions = ["read", "contribute"] as const;
export type TemporaryGrantAction = (typeof temporaryGrantActions)[number];
export type TemporaryAccessGrant = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  resourceType: TemporaryGrantResourceType;
  resourceId: string;
  action: TemporaryGrantAction;
  granteeActorId: string;
  requestedByActorId: string;
  approvedByActorId: string | null;
  reason: string;
  createdAt: Date;
  expiresAt: Date;
  approvedAt: Date | null;
  revokedAt: Date | null;
  revokedByActorId: string | null;
}>;
export type TemporaryAccessGrantStatus =
  "pending" | "active" | "expired" | "revoked";

export type GrantResourceScope = Readonly<{
  organizationId: string;
  workspaceId: string;
}>;

export interface TemporaryAccessGrantResourceResolver {
  resolve(input: {
    resourceType: TemporaryGrantResourceType;
    resourceId: string;
  }): Promise<GrantResourceScope | null>;
}

export interface TemporaryAccessGrantStore {
  create(input: {
    grant: TemporaryAccessGrant;
    auditEventId: string;
    correlationId: string;
  }): Promise<void>;
  findById(grantId: string): Promise<TemporaryAccessGrant | null>;
  list(input: {
    organizationId: string;
    actorId: string;
    includeAll: boolean;
  }): Promise<readonly TemporaryAccessGrant[]>;
  approve(input: {
    grantId: string;
    organizationId: string;
    actorId: string;
    approvedAt: Date;
    auditEventId: string;
    correlationId: string;
  }): Promise<
    | { result: "approved"; grant: TemporaryAccessGrant }
    | {
        result: "not_found" | "not_pending" | "expired" | "actor_not_owner";
      }
  >;
  revoke(input: {
    grantId: string;
    organizationId: string;
    actorId: string;
    reason: string;
    revokedAt: Date;
    auditEventId: string;
    correlationId: string;
  }): Promise<
    | { result: "revoked"; grant: TemporaryAccessGrant }
    | { result: "not_found" | "already_revoked" | "expired" }
  >;
  authorizeAndAudit(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    resourceType: TemporaryGrantResourceType;
    resourceId: string;
    action: TemporaryGrantAction;
    now: Date;
    auditEventId: string;
    expirationCorrelationId: string;
    correlationId: string;
  }): Promise<boolean>;
  recordExpired(input: {
    organizationId: string;
    now: Date;
    correlationId: string;
  }): Promise<number>;
}

export interface TemporaryAccessGrantAuthorizer {
  authorize(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    resourceType: TemporaryGrantResourceType;
    resourceId: string;
    action: TemporaryGrantAction;
    correlationId: string;
  }): Promise<boolean>;
}

export class TemporaryAccessGrantService implements TemporaryAccessGrantAuthorizer {
  constructor(
    private readonly dependencies: {
      store: TemporaryAccessGrantStore;
      resources: TemporaryAccessGrantResourceResolver;
      tenancy: TenantStore;
      ids: { next(): string };
      clock: { now(): Date };
    },
  ) {}

  async request(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    resourceType: TemporaryGrantResourceType;
    resourceId: string;
    action: TemporaryGrantAction;
    granteeActorId: string;
    reason: string;
    expiresInMinutes: number;
    correlationId: string;
  }): Promise<TemporaryAccessGrant> {
    if (
      !Number.isInteger(input.expiresInMinutes) ||
      input.expiresInMinutes < 1 ||
      input.expiresInMinutes > 480 ||
      input.reason.trim().length < 1 ||
      input.reason.length > 2000
    )
      throw new TemporaryAccessGrantError("GRANT_INVALID_REQUEST");
    const scope = await this.dependencies.resources.resolve({
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    });
    if (
      !scope ||
      scope.organizationId !== input.organizationId ||
      scope.workspaceId !== input.workspaceId
    )
      throw new TemporaryAccessGrantError("GRANT_RESOURCE_NOT_FOUND");
    const [organizationRole, workspaceRole] = await Promise.all([
      this.dependencies.tenancy.findOrganizationRole({
        actorId: input.actorId,
        organizationId: input.organizationId,
      }),
      this.dependencies.tenancy.findWorkspaceRole({
        actorId: input.actorId,
        workspaceId: input.workspaceId,
      }),
    ]);
    if (!organizationRole && !workspaceRole)
      throw new AccessDeniedError("workspace:read");
    const createdAt = this.dependencies.clock.now();
    const grant: TemporaryAccessGrant = {
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      granteeActorId: input.granteeActorId,
      requestedByActorId: input.actorId,
      approvedByActorId: null,
      reason: input.reason,
      createdAt,
      expiresAt: new Date(
        createdAt.getTime() + input.expiresInMinutes * 60_000,
      ),
      approvedAt: null,
      revokedAt: null,
      revokedByActorId: null,
    };
    await this.dependencies.store.create({
      grant,
      auditEventId: this.dependencies.ids.next(),
      correlationId: input.correlationId,
    });
    return grant;
  }

  async approve(input: {
    actorId: string;
    organizationId: string;
    grantId: string;
    correlationId: string;
  }): Promise<TemporaryAccessGrant> {
    const existing = await this.requireGrant(
      input.grantId,
      input.organizationId,
    );
    if (existing.requestedByActorId === input.actorId)
      throw new TemporaryAccessGrantError("GRANT_SEPARATION_OF_DUTIES");
    if (
      (await this.dependencies.tenancy.findOrganizationRole({
        actorId: input.actorId,
        organizationId: input.organizationId,
      })) !== "owner"
    )
      throw new AccessDeniedError("organization:manage");
    const result = await this.dependencies.store.approve({
      grantId: input.grantId,
      organizationId: input.organizationId,
      actorId: input.actorId,
      approvedAt: this.dependencies.clock.now(),
      auditEventId: this.dependencies.ids.next(),
      correlationId: input.correlationId,
    });
    if (result.result === "approved") return result.grant;
    if (result.result === "actor_not_owner")
      throw new AccessDeniedError("organization:manage");
    throw new TemporaryAccessGrantError(
      result.result === "expired" ? "GRANT_EXPIRED" : "GRANT_NOT_PENDING",
    );
  }

  async revoke(input: {
    actorId: string;
    organizationId: string;
    grantId: string;
    reason: string;
    correlationId: string;
  }): Promise<TemporaryAccessGrant> {
    const existing = await this.requireGrant(
      input.grantId,
      input.organizationId,
    );
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId: input.actorId,
      organizationId: input.organizationId,
    });
    if (
      role !== "owner" &&
      input.actorId !== existing.requestedByActorId &&
      input.actorId !== existing.granteeActorId
    )
      throw new AccessDeniedError("organization:manage");
    const result = await this.dependencies.store.revoke({
      grantId: input.grantId,
      organizationId: input.organizationId,
      actorId: input.actorId,
      reason: input.reason,
      revokedAt: this.dependencies.clock.now(),
      auditEventId: this.dependencies.ids.next(),
      correlationId: input.correlationId,
    });
    if (result.result === "revoked") return result.grant;
    throw new TemporaryAccessGrantError(
      result.result === "expired" ? "GRANT_EXPIRED" : "GRANT_NOT_ACTIVE",
    );
  }

  async list(input: {
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<readonly TemporaryAccessGrant[]> {
    await this.dependencies.store.recordExpired({
      organizationId: input.organizationId,
      now: this.dependencies.clock.now(),
      correlationId: input.correlationId,
    });
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId: input.actorId,
      organizationId: input.organizationId,
    });
    return this.dependencies.store.list({
      ...input,
      includeAll: role === "owner" || role === "admin",
    });
  }

  async authorize(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    resourceType: TemporaryGrantResourceType;
    resourceId: string;
  action: TemporaryGrantAction;
    correlationId: string;
  }): Promise<boolean> {
    const now = this.dependencies.clock.now();
    await this.dependencies.store.recordExpired({
      organizationId: input.organizationId,
      now,
      correlationId: input.correlationId,
    });
    const membershipStatus =
      await this.dependencies.tenancy.findOrganizationMembershipStatus({
        actorId: input.actorId,
        organizationId: input.organizationId,
      });
    if (
      membershipStatus === "suspended" ||
      membershipStatus === "revoked"
    )
      return false;
    return this.dependencies.store.authorizeAndAudit({
      ...input,
      now,
      auditEventId: this.dependencies.ids.next(),
      expirationCorrelationId: input.correlationId,
    });
  }

  status(grant: TemporaryAccessGrant): TemporaryAccessGrantStatus {
    if (grant.revokedAt) return "revoked";
    if (grant.expiresAt <= this.dependencies.clock.now()) return "expired";
    return grant.approvedAt ? "active" : "pending";
  }

  private async requireGrant(
    grantId: string,
    organizationId: string,
  ): Promise<TemporaryAccessGrant> {
    const grant = await this.dependencies.store.findById(grantId);
    if (!grant || grant.organizationId !== organizationId)
      throw new ResourceNotFoundError("TEMPORARY_ACCESS_GRANT_NOT_FOUND");
    return grant;
  }
}

export class TemporaryAccessGrantError extends Error {
  constructor(
    public readonly code:
      | "GRANT_RESOURCE_NOT_FOUND"
      | "GRANT_SEPARATION_OF_DUTIES"
      | "GRANT_NOT_PENDING"
      | "GRANT_NOT_ACTIVE"
      | "GRANT_EXPIRED"
      | "GRANT_INVALID_REQUEST",
  ) {
    super(code);
  }
}
