import { AccessDeniedError, type TenantStore } from "./tenancy.js";

export const auditResourceTypes = [
  "initiative",
  "evaluation",
  "decision",
  "project",
  "document",
] as const;
export type AuditResourceType = (typeof auditResourceTypes)[number];
export type AuditEvent = Readonly<{
  id: string;
  action: string;
  resourceType: AuditResourceType;
  resourceId: string;
  actorId: string;
  organizationId: string;
  workspaceId: string;
  occurredAt: Date;
  result: "succeeded" | "failed";
  correlationId: string;
  causationId: string | null;
  asyncEventId: string | null;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface AuditHistoryStore {
  list(input: {
    organizationId: string;
    resourceType: AuditResourceType;
    resourceId: string;
  }): Promise<readonly AuditEvent[]>;
}

export class AuditHistoryService {
  constructor(
    private readonly dependencies: {
      store: AuditHistoryStore;
      tenancy: TenantStore;
    },
  ) {}

  async history(input: {
    actorId: string;
    organizationId: string;
    resourceType: AuditResourceType;
    resourceId: string;
  }): Promise<readonly AuditEvent[]> {
    const organizationRole =
      await this.dependencies.tenancy.findOrganizationRole({
        actorId: input.actorId,
        organizationId: input.organizationId,
      });
    if (!organizationRole) throw new AccessDeniedError("organization:read");
    const events = await this.dependencies.store.list(input);
    if (organizationRole === "owner" || organizationRole === "admin")
      return events;
    for (const workspaceId of new Set(
      events.map((event) => event.workspaceId),
    )) {
      if (
        !(await this.dependencies.tenancy.findWorkspaceRole({
          actorId: input.actorId,
          workspaceId,
        }))
      )
        throw new AccessDeniedError("workspace:read");
    }
    return events;
  }
}
