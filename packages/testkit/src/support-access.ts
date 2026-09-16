import type {
  OrganizationSupportDiagnostic,
  SupportAccessGrant,
  SupportAccessGrantStore,
  SupportOperatorDirectory,
} from "@aether/application";

export class InMemorySupportOperatorDirectory implements SupportOperatorDirectory {
  constructor(private readonly actorIds: ReadonlySet<string>) {}

  async isEligible(actorId: string): Promise<boolean> {
    return this.actorIds.has(actorId);
  }
}

export class InMemorySupportAccessGrantStore implements SupportAccessGrantStore {
  readonly grants = new Map<string, SupportAccessGrant>();
  readonly organizations = new Map<
    string,
    Omit<OrganizationSupportDiagnostic, "organizationId" | "generatedAt">
  >();
  readonly auditEvents: Array<{
    id: string;
    grantId: string;
    eventType: string;
    actorId: string;
    correlationId: string;
    occurredAt: Date;
    payload: Readonly<Record<string, unknown>>;
  }> = [];

  addOrganization(
    organizationId: string,
    diagnostic: Omit<
      OrganizationSupportDiagnostic,
      "organizationId" | "generatedAt"
    > = {
      workspaces: { active: 0, archived: 0 },
      memberships: { active: 0, suspended: 0, revoked: 0 },
      delivery: { pendingOutboxEvents: 0, deadLetters: 0 },
      policyConfigured: false,
    },
  ): void {
    this.organizations.set(organizationId, diagnostic);
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return this.organizations.has(organizationId);
  }

  async create(input: {
    grant: SupportAccessGrant;
    auditEventId: string;
    correlationId: string;
  }): Promise<void> {
    this.grants.set(input.grant.id, input.grant);
    this.auditEvents.push({
      id: input.auditEventId,
      grantId: input.grant.id,
      eventType: "support_access_grant.requested.v1",
      actorId: input.grant.requestedByActorId,
      correlationId: input.correlationId,
      occurredAt: input.grant.createdAt,
      payload: {},
    });
  }

  async findById(grantId: string): Promise<SupportAccessGrant | null> {
    return this.grants.get(grantId) ?? null;
  }

  async list(input: {
    organizationId: string;
    actorId: string;
    includeAll: boolean;
  }): Promise<readonly SupportAccessGrant[]> {
    return [...this.grants.values()].filter(
      (grant) =>
        grant.organizationId === input.organizationId &&
        (input.includeAll || grant.supportActorId === input.actorId),
    );
  }

  async approve(input: {
    grantId: string;
    organizationId: string;
    actorId: string;
    approvedAt: Date;
    auditEventId: string;
    correlationId: string;
  }) {
    const current = this.grants.get(input.grantId);
    if (!current || current.organizationId !== input.organizationId)
      return { result: "not_found" as const };
    if (current.approvedAt || current.revokedAt)
      return { result: "not_pending" as const };
    if (current.expiresAt <= input.approvedAt) {
      this.recordExpiration(current, current.expiresAt, input.correlationId);
      return { result: "expired" as const };
    }
    const grant: SupportAccessGrant = {
      ...current,
      approvedByActorId: input.actorId,
      approvedAt: input.approvedAt,
    };
    this.grants.set(grant.id, grant);
    this.auditEvents.push({
      id: input.auditEventId,
      grantId: grant.id,
      eventType: "support_access_grant.approved.v1",
      actorId: input.actorId,
      correlationId: input.correlationId,
      occurredAt: input.approvedAt,
      payload: {},
    });
    return { result: "approved" as const, grant };
  }

  async revoke(input: {
    grantId: string;
    organizationId: string;
    actorId: string;
    reason: string;
    revokedAt: Date;
    auditEventId: string;
    correlationId: string;
  }) {
    const current = this.grants.get(input.grantId);
    if (!current || current.organizationId !== input.organizationId)
      return { result: "not_found" as const };
    if (current.revokedAt) return { result: "already_revoked" as const };
    if (current.expiresAt <= input.revokedAt) {
      this.recordExpiration(current, current.expiresAt, input.correlationId);
      return { result: "expired" as const };
    }
    const grant: SupportAccessGrant = {
      ...current,
      revokedAt: input.revokedAt,
      revokedByActorId: input.actorId,
    };
    this.grants.set(grant.id, grant);
    this.auditEvents.push({
      id: input.auditEventId,
      grantId: grant.id,
      eventType: "support_access_grant.revoked.v1",
      actorId: input.actorId,
      correlationId: input.correlationId,
      occurredAt: input.revokedAt,
      payload: { reason: input.reason },
    });
    return { result: "revoked" as const, grant };
  }

  async diagnoseAndAudit(input: {
    organizationId: string;
    actorId: string;
    now: Date;
    auditEventId: string;
    correlationId: string;
  }): Promise<OrganizationSupportDiagnostic | null> {
    await this.recordExpired(input);
    const grant = [...this.grants.values()].find(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        candidate.supportActorId === input.actorId &&
        candidate.approvedAt !== null &&
        candidate.revokedAt === null &&
        candidate.expiresAt > input.now,
    );
    const value = this.organizations.get(input.organizationId);
    if (!grant || !value) return null;
    this.auditEvents.push({
      id: input.auditEventId,
      grantId: grant.id,
      eventType: "support_access_grant.used.v1",
      actorId: input.actorId,
      correlationId: input.correlationId,
      occurredAt: input.now,
      payload: { diagnostic: "organization_summary.v1" },
    });
    return {
      organizationId: input.organizationId,
      generatedAt: input.now,
      ...value,
    };
  }

  async recordExpired(input: {
    organizationId: string;
    now: Date;
    correlationId: string;
  }): Promise<number> {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (
        grant.organizationId !== input.organizationId ||
        grant.revokedAt ||
        grant.expiresAt > input.now ||
        this.auditEvents.some(
          (event) =>
            event.grantId === grant.id &&
            event.eventType === "support_access_grant.expired.v1",
        )
      )
        continue;
      this.recordExpiration(grant, grant.expiresAt, input.correlationId);
      count++;
    }
    return count;
  }

  private recordExpiration(
    grant: SupportAccessGrant,
    occurredAt: Date,
    correlationId: string,
  ): void {
    if (
      this.auditEvents.some(
        (event) =>
          event.grantId === grant.id &&
          event.eventType === "support_access_grant.expired.v1",
      )
    )
      return;
    this.auditEvents.push({
      id: `expired:${grant.id}`,
      grantId: grant.id,
      eventType: "support_access_grant.expired.v1",
      actorId: "system:expiration",
      correlationId,
      occurredAt,
      payload: {},
    });
  }
}
