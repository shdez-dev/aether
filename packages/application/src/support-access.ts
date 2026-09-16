import {
  AccessDeniedError,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";

export type SupportAccessGrant = Readonly<{
  id: string;
  organizationId: string;
  supportActorId: string;
  requestedByActorId: string;
  approvedByActorId: string | null;
  reason: string;
  createdAt: Date;
  expiresAt: Date;
  approvedAt: Date | null;
  revokedAt: Date | null;
  revokedByActorId: string | null;
}>;

export type SupportAccessGrantStatus =
  "pending" | "active" | "expired" | "revoked";

export type OrganizationSupportDiagnostic = Readonly<{
  organizationId: string;
  generatedAt: Date;
  workspaces: Readonly<{ active: number; archived: number }>;
  memberships: Readonly<{
    active: number;
    suspended: number;
    revoked: number;
  }>;
  delivery: Readonly<{ pendingOutboxEvents: number; deadLetters: number }>;
  policyConfigured: boolean;
}>;

export interface SupportOperatorDirectory {
  isEligible(actorId: string): Promise<boolean>;
}

export interface SupportAccessGrantStore {
  organizationExists(organizationId: string): Promise<boolean>;
  create(input: {
    grant: SupportAccessGrant;
    auditEventId: string;
    correlationId: string;
  }): Promise<void>;
  findById(grantId: string): Promise<SupportAccessGrant | null>;
  list(input: {
    organizationId: string;
    actorId: string;
    includeAll: boolean;
  }): Promise<readonly SupportAccessGrant[]>;
  approve(input: {
    grantId: string;
    organizationId: string;
    actorId: string;
    approvedAt: Date;
    auditEventId: string;
    correlationId: string;
  }): Promise<
    | { result: "approved"; grant: SupportAccessGrant }
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
    | { result: "revoked"; grant: SupportAccessGrant }
    | { result: "not_found" | "already_revoked" | "expired" }
  >;
  diagnoseAndAudit(input: {
    organizationId: string;
    actorId: string;
    now: Date;
    auditEventId: string;
    correlationId: string;
  }): Promise<OrganizationSupportDiagnostic | null>;
  recordExpired(input: {
    organizationId: string;
    now: Date;
    correlationId: string;
  }): Promise<number>;
}

export class SupportAccessService {
  constructor(
    private readonly dependencies: {
      store: SupportAccessGrantStore;
      operators: SupportOperatorDirectory;
      tenancy: TenantStore;
      ids: { next(): string };
      clock: { now(): Date };
    },
  ) {}

  async request(input: {
    actorId: string;
    organizationId: string;
    reason: string;
    expiresInMinutes: number;
    correlationId: string;
  }): Promise<SupportAccessGrant> {
    if (!(await this.dependencies.operators.isEligible(input.actorId)))
      throw new SupportAccessGrantError("SUPPORT_OPERATOR_NOT_ELIGIBLE");
    if (
      !Number.isInteger(input.expiresInMinutes) ||
      input.expiresInMinutes < 1 ||
      input.expiresInMinutes > 60 ||
      input.reason.trim().length < 1 ||
      input.reason.length > 2000
    )
      throw new SupportAccessGrantError("SUPPORT_ACCESS_INVALID_REQUEST");
    if (
      !(await this.dependencies.store.organizationExists(input.organizationId))
    )
      throw new ResourceNotFoundError("ORGANIZATION_NOT_FOUND");
    const createdAt = this.dependencies.clock.now();
    const grant: SupportAccessGrant = {
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      supportActorId: input.actorId,
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
  }): Promise<SupportAccessGrant> {
    const existing = await this.requireGrant(
      input.grantId,
      input.organizationId,
    );
    if (existing.requestedByActorId === input.actorId)
      throw new SupportAccessGrantError("SUPPORT_ACCESS_SEPARATION_OF_DUTIES");
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
    throw new SupportAccessGrantError(
      result.result === "expired"
        ? "SUPPORT_ACCESS_EXPIRED"
        : "SUPPORT_ACCESS_NOT_PENDING",
    );
  }

  async revoke(input: {
    actorId: string;
    organizationId: string;
    grantId: string;
    reason: string;
    correlationId: string;
  }): Promise<SupportAccessGrant> {
    const existing = await this.requireGrant(
      input.grantId,
      input.organizationId,
    );
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId: input.actorId,
      organizationId: input.organizationId,
    });
    if (role !== "owner" && input.actorId !== existing.supportActorId)
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
    throw new SupportAccessGrantError(
      result.result === "expired"
        ? "SUPPORT_ACCESS_EXPIRED"
        : "SUPPORT_ACCESS_NOT_ACTIVE",
    );
  }

  async list(input: {
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<readonly SupportAccessGrant[]> {
    await this.dependencies.store.recordExpired({
      organizationId: input.organizationId,
      now: this.dependencies.clock.now(),
      correlationId: input.correlationId,
    });
    const [role, eligible] = await Promise.all([
      this.dependencies.tenancy.findOrganizationRole({
        actorId: input.actorId,
        organizationId: input.organizationId,
      }),
      this.dependencies.operators.isEligible(input.actorId),
    ]);
    if (!role && !eligible)
      throw new SupportAccessGrantError("SUPPORT_OPERATOR_NOT_ELIGIBLE");
    return this.dependencies.store.list({
      organizationId: input.organizationId,
      actorId: input.actorId,
      includeAll: role === "owner" || role === "admin",
    });
  }

  async diagnose(input: {
    actorId: string;
    organizationId: string;
    correlationId: string;
  }): Promise<OrganizationSupportDiagnostic> {
    if (!(await this.dependencies.operators.isEligible(input.actorId)))
      throw new SupportAccessGrantError("SUPPORT_OPERATOR_NOT_ELIGIBLE");
    const diagnostic = await this.dependencies.store.diagnoseAndAudit({
      ...input,
      now: this.dependencies.clock.now(),
      auditEventId: this.dependencies.ids.next(),
    });
    if (!diagnostic) throw new SupportAccessGrantError("SUPPORT_ACCESS_DENIED");
    return diagnostic;
  }

  status(grant: SupportAccessGrant): SupportAccessGrantStatus {
    if (grant.revokedAt) return "revoked";
    if (grant.expiresAt <= this.dependencies.clock.now()) return "expired";
    return grant.approvedAt ? "active" : "pending";
  }

  private async requireGrant(
    grantId: string,
    organizationId: string,
  ): Promise<SupportAccessGrant> {
    const grant = await this.dependencies.store.findById(grantId);
    if (!grant || grant.organizationId !== organizationId)
      throw new ResourceNotFoundError("SUPPORT_ACCESS_GRANT_NOT_FOUND");
    return grant;
  }
}

export class SupportAccessGrantError extends Error {
  constructor(
    public readonly code:
      | "SUPPORT_OPERATOR_NOT_ELIGIBLE"
      | "SUPPORT_ACCESS_INVALID_REQUEST"
      | "SUPPORT_ACCESS_SEPARATION_OF_DUTIES"
      | "SUPPORT_ACCESS_NOT_PENDING"
      | "SUPPORT_ACCESS_NOT_ACTIVE"
      | "SUPPORT_ACCESS_EXPIRED"
      | "SUPPORT_ACCESS_DENIED",
  ) {
    super(code);
  }
}
