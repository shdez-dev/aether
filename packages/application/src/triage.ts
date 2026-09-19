import {
  assessInitiativeForTriage,
  TriageDomainError,
  publishTriageStandard,
  type InitiativeTriage,
  type TriageCriterion,
  type TriageResultInput,
  type TriageStandard,
} from "@aether/domain";

import {
  InitiativeVersionConflictError,
  type InitiativeAuditStore,
  type InitiativeStore,
} from "./initiatives.js";
import {
  AccessDeniedError,
  assertWorkspaceWritable,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";

export interface TriageStandardStore {
  create(standard: TriageStandard): Promise<void>;
  findById(standardId: string): Promise<TriageStandard | null>;
  list(input: { organizationId: string }): Promise<readonly TriageStandard[]>;
  activate(input: {
    organizationId: string;
    standardId: string;
    adoptionId: string;
    adoptedByActorId: string;
    adoptedAt: Date;
  }): Promise<void>;
}

export interface TriageStore {
  create(triage: InitiativeTriage): Promise<void>;
  findById(triageId: string): Promise<InitiativeTriage | null>;
}

export interface TriageIdGenerator {
  next(): string;
}
export interface TriageClock {
  now(): Date;
}

export class TriageService {
  constructor(
    private readonly dependencies: {
      standards: TriageStandardStore;
      triages: TriageStore;
      initiatives: InitiativeStore;
      audit: InitiativeAuditStore;
      tenancy: TenantStore;
      ids: TriageIdGenerator;
      clock: TriageClock;
    },
  ) {}

  async publishStandard(input: {
    actorId: string;
    organizationId: string;
    name: string;
    version: number;
    criteria: readonly TriageCriterion[];
  }): Promise<TriageStandard> {
    await this.assertOwner(input.actorId, input.organizationId);
    const standard = publishTriageStandard({
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      name: input.name,
      version: input.version,
      criteria: input.criteria,
      publishedAt: this.dependencies.clock.now(),
      publishedByActorId: input.actorId,
    });
    await this.dependencies.standards.create(standard);
    return standard;
  }

  async listStandards(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly TriageStandard[]> {
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    return this.dependencies.standards.list(input);
  }

  async activateStandard(input: {
    actorId: string;
    organizationId: string;
    standardId: string;
  }): Promise<void> {
    await this.assertOwner(input.actorId, input.organizationId);
    const standard = await this.dependencies.standards.findById(
      input.standardId,
    );
    if (!standard || standard.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    await this.dependencies.standards.activate({
      organizationId: input.organizationId,
      standardId: input.standardId,
      adoptionId: this.dependencies.ids.next(),
      adoptedByActorId: input.actorId,
      adoptedAt: this.dependencies.clock.now(),
    });
  }

  async triage(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    expectedVersion: number;
    standardId: string;
    results: readonly TriageResultInput[];
    correlationId: string;
  }): Promise<InitiativeTriage> {
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    const initiative = await this.dependencies.initiatives.findById(
      input.initiativeId,
    );
    if (!initiative || initiative.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    if (initiative.version !== input.expectedVersion)
      throw new InitiativeVersionConflictError();
    if (initiative.status !== "presented")
      throw new TriageDomainError("TRIAGE_NOT_ALLOWED_FOR_INITIATIVE_STATE");
    const standard = await this.dependencies.standards.findById(
      input.standardId,
    );
    if (!standard || standard.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    if (!standard.isActive)
      throw new TriageDomainError("TRIAGE_STANDARD_NOT_ACTIVE");
    const assessedAt = this.dependencies.clock.now();
    const triage = assessInitiativeForTriage({
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      initiativeVersion: initiative.version,
      standard,
      results: input.results,
      assessedByActorId: input.actorId,
      assessedAt,
    });
    await this.dependencies.triages.create(triage);
    await this.dependencies.audit.record({
      id: this.dependencies.ids.next(),
      eventType: "initiative.triaged.v1",
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      actorId: input.actorId,
      correlationId: input.correlationId,
      occurredAt: assessedAt,
      fromStatus: initiative.status,
      toStatus: initiative.status,
      payload: {
        triageId: triage.id,
        standardId: triage.standardId,
        standardVersion: triage.standardVersion,
        initiativeVersion: triage.initiativeVersion,
      },
    });
    return triage;
  }

  async getTriage(input: {
    actorId: string;
    organizationId: string;
    triageId: string;
  }): Promise<InitiativeTriage> {
    const triage = await this.dependencies.triages.findById(input.triageId);
    if (!triage || triage.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    return triage;
  }

  private async assertOwner(actorId: string, organizationId: string) {
    if (
      (await this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId,
      })) !== "owner"
    )
      throw new AccessDeniedError("organization:manage");
  }

  private async assertOrganizationManager(
    actorId: string,
    organizationId: string,
  ) {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (role !== "owner" && role !== "admin")
      throw new AccessDeniedError("organization:manage");
  }
}
