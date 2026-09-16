import type {
  TemporaryAccessGrant,
  TemporaryAccessGrantResourceResolver,
  TemporaryAccessGrantStore,
  TemporaryGrantResourceType,
} from "@aether/application";

export class InMemoryTemporaryAccessGrantStore
  implements TemporaryAccessGrantStore, TemporaryAccessGrantResourceResolver
{
  readonly grants = new Map<string, TemporaryAccessGrant>();
  readonly resources = new Map<
    string,
    { organizationId: string; workspaceId: string }
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

  addResource(input: {
    resourceType: TemporaryGrantResourceType;
    resourceId: string;
    organizationId: string;
    workspaceId: string;
  }): void {
    this.resources.set(this.resourceKey(input.resourceType, input.resourceId), {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
    });
  }

  async resolve(input: {
    resourceType: TemporaryGrantResourceType;
    resourceId: string;
  }) {
    return (
      this.resources.get(
        this.resourceKey(input.resourceType, input.resourceId),
      ) ?? null
    );
  }

  async create(input: {
    grant: TemporaryAccessGrant;
    auditEventId: string;
    correlationId: string;
  }): Promise<void> {
    this.grants.set(input.grant.id, input.grant);
    this.auditEvents.push({
      id: input.auditEventId,
      grantId: input.grant.id,
      eventType: "temporary_access_grant.requested.v1",
      actorId: input.grant.requestedByActorId,
      correlationId: input.correlationId,
      occurredAt: input.grant.createdAt,
      payload: {},
    });
  }

  async findById(grantId: string): Promise<TemporaryAccessGrant | null> {
    return this.grants.get(grantId) ?? null;
  }

  async list(input: {
    organizationId: string;
    actorId: string;
    includeAll: boolean;
  }): Promise<readonly TemporaryAccessGrant[]> {
    return [...this.grants.values()].filter(
      (grant) =>
        grant.organizationId === input.organizationId &&
        (input.includeAll ||
          grant.requestedByActorId === input.actorId ||
          grant.granteeActorId === input.actorId),
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
    const grant: TemporaryAccessGrant = {
      ...current,
      approvedByActorId: input.actorId,
      approvedAt: input.approvedAt,
    };
    this.grants.set(grant.id, grant);
    this.auditEvents.push({
      id: input.auditEventId,
      grantId: grant.id,
      eventType: "temporary_access_grant.approved.v1",
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
    const grant: TemporaryAccessGrant = {
      ...current,
      revokedAt: input.revokedAt,
      revokedByActorId: input.actorId,
    };
    this.grants.set(grant.id, grant);
    this.auditEvents.push({
      id: input.auditEventId,
      grantId: grant.id,
      eventType: "temporary_access_grant.revoked.v1",
      actorId: input.actorId,
      correlationId: input.correlationId,
      occurredAt: input.revokedAt,
      payload: { reason: input.reason },
    });
    return { result: "revoked" as const, grant };
  }

  async authorizeAndAudit(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    resourceType: TemporaryGrantResourceType;
    resourceId: string;
    action: "read" | "contribute";
    now: Date;
    auditEventId: string;
    expirationCorrelationId: string;
    correlationId: string;
  }): Promise<boolean> {
    await this.recordExpired({
      organizationId: input.organizationId,
      now: input.now,
      correlationId: input.expirationCorrelationId,
    });
    const grant = [...this.grants.values()].find(
      (candidate) =>
        candidate.granteeActorId === input.actorId &&
        candidate.organizationId === input.organizationId &&
        candidate.workspaceId === input.workspaceId &&
        candidate.resourceType === input.resourceType &&
        candidate.resourceId === input.resourceId &&
        candidate.action === input.action &&
        candidate.approvedAt !== null &&
        candidate.revokedAt === null &&
        candidate.expiresAt > input.now,
    );
    if (!grant) return false;
    this.auditEvents.push({
      id: input.auditEventId,
      grantId: grant.id,
      eventType: "temporary_access_grant.used.v1",
      actorId: input.actorId,
      correlationId: input.correlationId,
      occurredAt: input.now,
      payload: {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        action: input.action,
      },
    });
    return true;
  }

  async recordExpired(input: {
    organizationId: string;
    now: Date;
    correlationId: string;
  }): Promise<number> {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (grant.revokedAt) continue;
      if (grant.organizationId !== input.organizationId) continue;
      if (grant.expiresAt > input.now) continue;
      if (
        this.auditEvents.some(
          (event) =>
            event.grantId === grant.id &&
            event.eventType === "temporary_access_grant.expired.v1",
        )
      )
        continue;
      this.recordExpiration(grant, grant.expiresAt, input.correlationId);
      count++;
    }
    return count;
  }

  private recordExpiration(
    grant: TemporaryAccessGrant,
    occurredAt: Date,
    correlationId: string,
  ): void {
    if (
      this.auditEvents.some(
        (event) =>
          event.grantId === grant.id &&
          event.eventType === "temporary_access_grant.expired.v1",
      )
    )
      return;
    this.auditEvents.push({
      id: `expired:${grant.id}`,
      grantId: grant.id,
      eventType: "temporary_access_grant.expired.v1",
      actorId: "system:expiration",
      correlationId,
      occurredAt,
      payload: {},
    });
  }

  private resourceKey(
    resourceType: TemporaryGrantResourceType,
    resourceId: string,
  ): string {
    return `${resourceType}:${resourceId}`;
  }
}
