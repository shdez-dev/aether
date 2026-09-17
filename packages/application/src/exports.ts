import { AccessDeniedError, type TenantStore } from "./tenancy.js";

export type ExportScope = "organization_audit";
export type ExportJob = Readonly<{
  id: string;
  organizationId: string;
  requestedByActorId: string;
  scope: ExportScope;
  status: "requested" | "processing" | "completed" | "failed" | "expired";
  objectKey: string | null;
  expiresAt: Date | null;
  requestedAt: Date;
  completedAt: Date | null;
  errorCode: string | null;
}>;
export interface ExportJobStore {
  create(job: ExportJob): Promise<void>;
  list(input: {
    organizationId: string;
    requestedByActorId: string;
  }): Promise<readonly ExportJob[]>;
}
export class ExportService {
  constructor(
    private readonly d: {
      store: ExportJobStore;
      tenancy: TenantStore;
      ids: { next(): string };
      clock: { now(): Date };
    },
  ) {}
  async request(input: {
    actorId: string;
    organizationId: string;
    scope: ExportScope;
  }): Promise<ExportJob> {
    await this.assertManager(input.actorId, input.organizationId);
    const job: ExportJob = {
      id: this.d.ids.next(),
      organizationId: input.organizationId,
      requestedByActorId: input.actorId,
      scope: input.scope,
      status: "requested",
      objectKey: null,
      expiresAt: null,
      requestedAt: this.d.clock.now(),
      completedAt: null,
      errorCode: null,
    };
    await this.d.store.create(job);
    return job;
  }
  async list(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly ExportJob[]> {
    await this.assertManager(input.actorId, input.organizationId);
    return this.d.store.list({
      organizationId: input.organizationId,
      requestedByActorId: input.actorId,
    });
  }
  private async assertManager(actorId: string, organizationId: string) {
    const role = await this.d.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (role !== "owner" && role !== "admin")
      throw new AccessDeniedError("organization:manage");
  }
}
