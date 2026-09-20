import {
  saveInitiativeDiagnostic,
  type InitiativeDiagnostic,
  type InitiativeDiagnosticInput,
} from "@aether/domain";

import {
  InitiativeVersionConflictError,
  type InitiativeAuditEvent,
  type InitiativeStore,
} from "./initiatives.js";
import {
  AccessDeniedError,
  assertWorkspaceWritable,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";

export interface DiagnosticStore {
  findByInitiativeId(initiativeId: string): Promise<InitiativeDiagnostic | null>;
  saveWithAudit(input: {
    diagnostic: InitiativeDiagnostic;
    expectedVersion: number | null;
    auditEvent: InitiativeAuditEvent;
  }): Promise<boolean>;
}

export class DiagnosticService {
  constructor(
    private readonly dependencies: {
      store: DiagnosticStore;
      initiatives: InitiativeStore;
      tenancy: TenantStore;
      ids: { next(): string };
      clock: { now(): Date };
    },
  ) {}

  async get(input: { actorId: string; organizationId: string; initiativeId: string }) {
    const initiative = await this.requireInitiative(input.initiativeId, input.organizationId);
    await this.assertRead(input.actorId, initiative.workspaceId, initiative.organizationId);
    return this.dependencies.store.findByInitiativeId(initiative.id);
  }

  async save(input: Omit<InitiativeDiagnosticInput, "id" | "organizationId" | "workspaceId" | "initiativeId" | "savedByActorId"> & {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    expectedVersion: number | null;
    correlationId: string;
  }): Promise<InitiativeDiagnostic> {
    const initiative = await this.requireInitiative(input.initiativeId, input.organizationId);
    if (initiative.status !== "draft" && initiative.status !== "returned")
      throw new DiagnosticStateError();
    await assertWorkspaceWritable(this.dependencies.tenancy, initiative.workspaceId);
    await this.assertEdit(input.actorId, initiative);
    const current = await this.dependencies.store.findByInitiativeId(initiative.id);
    if (current?.version !== input.expectedVersion && !(current === null && input.expectedVersion === null))
      throw new InitiativeVersionConflictError();
    const savedAt = this.dependencies.clock.now();
    const diagnostic = saveInitiativeDiagnostic({
      current,
      diagnostic: { ...input, id: current?.id ?? this.dependencies.ids.next(), workspaceId: initiative.workspaceId, savedByActorId: input.actorId },
      savedAt,
    });
    const stored = await this.dependencies.store.saveWithAudit({
      diagnostic,
      expectedVersion: input.expectedVersion,
      auditEvent: { id: this.dependencies.ids.next(), eventType: "initiative.diagnostic_saved.v1", organizationId: initiative.organizationId, workspaceId: initiative.workspaceId, initiativeId: initiative.id, actorId: input.actorId, correlationId: input.correlationId, occurredAt: savedAt, fromStatus: initiative.status, toStatus: initiative.status, payload: { diagnosticId: diagnostic.id, version: diagnostic.version } },
    });
    if (!stored) throw new InitiativeVersionConflictError();
    return diagnostic;
  }

  private async requireInitiative(initiativeId: string, organizationId: string) {
    const initiative = await this.dependencies.initiatives.findById(initiativeId);
    if (!initiative || initiative.organizationId !== organizationId) throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    return initiative;
  }
  private async assertRead(actorId: string, workspaceId: string, organizationId: string) {
    const [organizationRole, workspaceRole] = await Promise.all([this.dependencies.tenancy.findOrganizationRole({ actorId, organizationId }), this.dependencies.tenancy.findWorkspaceRole({ actorId, workspaceId })]);
    if (!organizationRole && !workspaceRole) throw new AccessDeniedError("workspace:read");
  }
  private async assertEdit(actorId: string, initiative: Awaited<ReturnType<InitiativeStore["findById"]>> & {}) {
    await this.assertRead(actorId, initiative.workspaceId, initiative.organizationId);
    const [organizationRole, workspaceRole] = await Promise.all([this.dependencies.tenancy.findOrganizationRole({ actorId, organizationId: initiative.organizationId }), this.dependencies.tenancy.findWorkspaceRole({ actorId, workspaceId: initiative.workspaceId })]);
    if (actorId !== initiative.createdByActorId && organizationRole !== "owner" && organizationRole !== "admin" && workspaceRole !== "admin") throw new AccessDeniedError("workspace:manage");
  }
}
export class DiagnosticStateError extends Error {}
