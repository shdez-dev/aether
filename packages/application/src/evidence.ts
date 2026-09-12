import type {
  DocumentVersion,
  EvidenceCompliance,
  EvidenceReference,
  EvidenceReferenceSubjectType,
} from "@aether/domain";

import {
  DocumentAccessDeniedError,
  DocumentNotFoundError,
  type DocumentAuditEvent,
  type DocumentAuditStore,
  type DocumentStore,
} from "./documents.js";
import {
  AccessDeniedError,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";

export type EvidenceSubject = Readonly<{
  organizationId: string;
  workspaceId: string;
}>;
export type EvidenceReferenceWithCompliance = EvidenceReference &
  Readonly<{ compliance: EvidenceCompliance }>;

export interface EvidenceReferenceStore {
  create(reference: EvidenceReference): Promise<void>;
  list(input: {
    subjectType: EvidenceReferenceSubjectType;
    subjectId: string;
  }): Promise<readonly EvidenceReference[]>;
}
export interface EvidenceSubjectLookup {
  resolve(input: {
    subjectType: EvidenceReferenceSubjectType;
    subjectId: string;
  }): Promise<EvidenceSubject | null>;
}
export interface EvidenceIdGenerator {
  next(): string;
}
export interface EvidenceClock {
  now(): Date;
}

export class EvidenceService {
  constructor(
    private readonly dependencies: {
      references: EvidenceReferenceStore;
      subjects: EvidenceSubjectLookup;
      documents: DocumentStore;
      documentAudit: DocumentAuditStore;
      tenancy: TenantStore;
      ids: EvidenceIdGenerator;
      clock: EvidenceClock;
    },
  ) {}

  async attach(input: {
    actorId: string;
    organizationId: string;
    subjectType: EvidenceReferenceSubjectType;
    subjectId: string;
    documentId: string;
    documentVersionId: string;
    correlationId: string;
  }): Promise<EvidenceReference> {
    await this.assertManager(input.actorId, input.organizationId);
    const subject = await this.dependencies.subjects.resolve(input);
    if (!subject || subject.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("EVIDENCE_SUBJECT_NOT_FOUND");
    const found = await this.dependencies.documents.findVersion({
      documentId: input.documentId,
      versionId: input.documentVersionId,
    });
    if (
      !found ||
      found.document.organizationId !== subject.organizationId ||
      found.document.workspaceId !== subject.workspaceId ||
      found.version.status !== "published"
    )
      throw new DocumentNotFoundError();
    const now = this.dependencies.clock.now();
    const reference: EvidenceReference = {
      id: this.dependencies.ids.next(),
      organizationId: subject.organizationId,
      workspaceId: subject.workspaceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      linkedByActorId: input.actorId,
      linkedAt: now,
    };
    await this.dependencies.references.create(reference);
    await this.dependencies.documentAudit.record(
      this.auditEvent(
        found.document,
        found.version,
        reference,
        input.correlationId,
      ),
    );
    return reference;
  }

  async list(input: {
    actorId: string;
    organizationId: string;
    subjectType: EvidenceReferenceSubjectType;
    subjectId: string;
  }): Promise<readonly EvidenceReferenceWithCompliance[]> {
    const subject = await this.dependencies.subjects.resolve(input);
    if (!subject || subject.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("EVIDENCE_SUBJECT_NOT_FOUND");
    await this.assertRead(
      input.actorId,
      subject.organizationId,
      subject.workspaceId,
    );
    const references = await this.dependencies.references.list(input);
    return Promise.all(
      references.map(async (reference) => ({
        ...reference,
        compliance: await this.currentCompliance(reference),
      })),
    );
  }

  private async currentCompliance(
    reference: EvidenceReference,
  ): Promise<EvidenceCompliance> {
    const found = await this.dependencies.documents.findVersion({
      documentId: reference.documentId,
      versionId: reference.documentVersionId,
    });
    return found?.version.status === "published" ? "valid" : "invalid";
  }
  private async assertManager(actorId: string, organizationId: string) {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (role !== "owner" && role !== "admin")
      throw new AccessDeniedError("organization:manage");
  }
  private async assertRead(
    actorId: string,
    organizationId: string,
    workspaceId: string,
  ) {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    const workspaceRole = await this.dependencies.tenancy.findWorkspaceRole({
      actorId,
      workspaceId,
    });
    if (!role || (!workspaceRole && role !== "owner" && role !== "admin"))
      throw new DocumentAccessDeniedError();
  }
  private auditEvent(
    document: import("@aether/domain").InstitutionalDocument,
    version: DocumentVersion,
    reference: EvidenceReference,
    correlationId: string,
  ): DocumentAuditEvent {
    return {
      id: this.dependencies.ids.next(),
      eventType: "document.evidence_linked.v1",
      documentId: document.id,
      versionId: version.id,
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      actorId: reference.linkedByActorId,
      correlationId,
      occurredAt: reference.linkedAt,
      payload: {
        subjectType: reference.subjectType,
        subjectId: reference.subjectId,
        evidenceReferenceId: reference.id,
      },
    };
  }
}
