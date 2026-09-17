import {
  canCreateInitiative,
  type DocumentClassification,
  type DocumentResourceType,
  type DocumentVersion,
  type InstitutionalDocument,
} from "@aether/domain";
import type { DurableDomainEvent, DurableEventHandler } from "./outbox.js";
import { assertDocumentScanEventScope } from "./worker-authorization.js";

import { assertWorkspaceWritable, type TenantStore } from "./tenancy.js";
import type {
  TemporaryAccessGrantAuthorizer,
  TemporaryGrantResourceType,
} from "./access-grants.js";

export type DocumentResource = Readonly<{
  organizationId: string;
  workspaceId: string;
}>;
export type DocumentVersionAccess = Readonly<{
  document: InstitutionalDocument;
  version: DocumentVersion;
}>;
export type DocumentAuditEvent = Readonly<{
  id: string;
  eventType:
    | "document.upload_started.v1"
    | "document.published.v1"
    | "document.rejected.v1"
    | "document.scan_queued.v1"
    | "document.malware_rejected.v1"
    | "document.withdrawn.v1"
    | "document.replaced.v1"
    | "document.restored.v1"
    | "document.purged.v1"
    | "document.download_url_issued.v1"
    | "document.evidence_linked.v1"
    | "document.relocated.v1";
  documentId: string;
  versionId: string;
  organizationId: string;
  workspaceId: string;
  actorId: string;
  correlationId: string;
  occurredAt: Date;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface DocumentStore {
  resolveResource(input: {
    resourceType: DocumentResourceType;
    resourceId: string;
  }): Promise<DocumentResource | null>;
  createQuarantined(input: {
    document: InstitutionalDocument;
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<void>;
  findVersion(input: {
    documentId: string;
    versionId: string;
  }): Promise<DocumentVersionAccess | null>;
  findLatestVersion(documentId: string): Promise<DocumentVersionAccess | null>;
  listByResource(input: {
    organizationId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
  }): Promise<readonly DocumentVersionAccess[]>;
  publish(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<boolean>;
  queueForScan(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
    event: DurableDomainEvent;
  }): Promise<boolean>;
  createReplacement(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<void>;
  restore(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
    event: DurableDomainEvent;
  }): Promise<void>;
  withdraw(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<boolean>;
  listExpired(now: Date): Promise<readonly DocumentVersionAccess[]>;
  purge(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<boolean>;
  reject(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<boolean>;
  relocate(input: {
    document: InstitutionalDocument;
    audit: DocumentAuditEvent;
  }): Promise<boolean>;
}
export interface DocumentAuditStore {
  record(event: DocumentAuditEvent): Promise<void>;
}
export interface DocumentObjectStore {
  createUploadUrl(input: {
    key: string;
    contentType: string;
    checksumSha256: string;
    expiresAt: Date;
  }): Promise<{ url: string; headers: Readonly<Record<string, string>> }>;
  inspectQuarantine(input: {
    key: string;
    expectedSha256: string;
    expectedByteLength: number;
    declaredContentType: string;
  }): Promise<{
    byteLength: number;
    sha256: string;
    detectedContentType: string;
  }>;
  promote(input: { sourceKey: string; destinationKey: string }): Promise<void>;
  copy(input: { sourceKey: string; destinationKey: string }): Promise<void>;
  readQuarantine(input: { key: string }): Promise<Uint8Array>;
  delete(input: { key: string }): Promise<void>;
  createDownloadUrl(input: { key: string; expiresAt: Date }): Promise<string>;
}
export interface DocumentClock {
  now(): Date;
}
export interface DocumentIdGenerator {
  next(): string;
}
export interface DocumentMalwareScanner {
  scan(input: {
    content: Uint8Array;
    fileName: string;
  }): Promise<{ clean: boolean; signature: string | null }>;
}
/** Consulta de autorización específica de proyecto, aislada del transporte HTTP. */
export interface DocumentProjectAccess {
  isParticipant(input: {
    actorId: string;
    projectId: string;
  }): Promise<boolean>;
}

export class DocumentService {
  constructor(
    private readonly dependencies: {
      store: DocumentStore;
      audit: DocumentAuditStore;
      objects: DocumentObjectStore;
      tenancy: TenantStore;
      accessGrants?: TemporaryAccessGrantAuthorizer;
      ids: DocumentIdGenerator;
      clock: DocumentClock;
      projectAccess?: DocumentProjectAccess;
      maxBytes: number;
      urlTtlSeconds: number;
    },
  ) {}

  async beginUpload(input: {
    actorId: string;
    correlationId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
    classification: DocumentClassification;
    fileName: string;
    contentType: string;
    contentLength: number;
    sha256: string;
  }) {
    if (input.contentLength > this.dependencies.maxBytes)
      throw new DocumentValidationError("DOCUMENT_TOO_LARGE");
    this.assertExtension(input.fileName, input.contentType);
    const resource = await this.requireWritableResource(
      input.actorId,
      input.resourceType,
      input.resourceId,
      input.correlationId,
    );
    const now = this.dependencies.clock.now();
    const document: InstitutionalDocument = {
      id: this.dependencies.ids.next(),
      ...resource,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      classification: input.classification,
      createdByActorId: input.actorId,
      createdAt: now,
    };
    const version: DocumentVersion = {
      id: this.dependencies.ids.next(),
      documentId: document.id,
      versionNumber: 1,
      originalName: input.fileName,
      declaredContentType: input.contentType,
      detectedContentType: null,
      byteLength: input.contentLength,
      sha256: input.sha256.toLowerCase(),
      status: "quarantined",
      quarantineKey: `quarantine/${document.organizationId}/${document.id}/${this.dependencies.ids.next()}`,
      objectKey: null,
      createdAt: now,
      publishedAt: null,
      rejectedAt: null,
      withdrawnAt: null,
      retentionUntil: null,
      evidenceStatus: "pending",
      supersedesVersionId: null,
      replacedByVersionId: null,
    };
    const audit = this.event(
      "document.upload_started.v1",
      document,
      version,
      input.actorId,
      input.correlationId,
      now,
      {
        fileName: version.originalName,
        byteLength: version.byteLength,
        contentType: version.declaredContentType,
      },
    );
    await this.dependencies.store.createQuarantined({
      document,
      version,
      audit,
    });
    const expiresAt = new Date(
      now.getTime() + this.dependencies.urlTtlSeconds * 1_000,
    );
    const upload = await this.dependencies.objects.createUploadUrl({
      key: version.quarantineKey,
      contentType: version.declaredContentType,
      checksumSha256: version.sha256,
      expiresAt,
    });
    return { document, version, upload, expiresAt };
  }

  async completeUpload(input: {
    actorId: string;
    correlationId: string;
    documentId: string;
    versionId: string;
  }): Promise<DocumentVersionAccess> {
    const current = await this.requireVersion(
      input.documentId,
      input.versionId,
    );
    await this.assertWrite(
      input.actorId,
      current.document.organizationId,
      current.document.workspaceId,
      "document",
      current.document.id,
      input.correlationId,
    );
    if (current.version.status !== "quarantined")
      throw new DocumentValidationError("DOCUMENT_NOT_QUARANTINED");
    const now = this.dependencies.clock.now();
    try {
      const inspected = await this.dependencies.objects.inspectQuarantine({
        key: current.version.quarantineKey,
        expectedSha256: current.version.sha256,
        expectedByteLength: current.version.byteLength,
        declaredContentType: current.version.declaredContentType,
      });
      if (
        inspected.byteLength !== current.version.byteLength ||
        inspected.sha256 !== current.version.sha256 ||
        inspected.detectedContentType !== current.version.declaredContentType
      )
        throw new DocumentValidationError("DOCUMENT_CONTENT_MISMATCH");
      const pendingScan: DocumentVersion = {
        ...current.version,
        detectedContentType: inspected.detectedContentType,
        status: "pending_scan",
      };
      const audit = this.event(
        "document.scan_queued.v1",
        current.document,
        pendingScan,
        input.actorId,
        input.correlationId,
        now,
        {
          byteLength: pendingScan.byteLength,
          contentType: pendingScan.detectedContentType,
        },
      );
      const event = this.durableEvent(
        current.document,
        pendingScan,
        input.correlationId,
        now,
      );
      if (
        !(await this.dependencies.store.queueForScan({
          version: pendingScan,
          audit,
          event,
        }))
      )
        throw new DocumentValidationError("DOCUMENT_NOT_QUARANTINED");
      return { document: current.document, version: pendingScan };
    } catch (error) {
      if (!(error instanceof DocumentValidationError)) throw error;
      const rejected: DocumentVersion = {
        ...current.version,
        status: "rejected",
        evidenceStatus: "withdrawn",
        rejectedAt: now,
      };
      await this.dependencies.store.reject({
        version: rejected,
        audit: this.event(
          "document.rejected.v1",
          current.document,
          rejected,
          input.actorId,
          input.correlationId,
          now,
          { reason: error.code },
        ),
      });
      throw error;
    }
  }

  async download(input: {
    actorId: string;
    correlationId: string;
    documentId: string;
    versionId: string;
  }) {
    const current = await this.requireVersion(
      input.documentId,
      input.versionId,
    );
    await this.assertRead(
      input.actorId,
      current.document,
      "document",
      current.document.id,
      input.correlationId,
    );
    if (current.version.status !== "published" || !current.version.objectKey)
      throw new DocumentNotFoundError();
    const now = this.dependencies.clock.now();
    const expiresAt = new Date(
      now.getTime() + this.dependencies.urlTtlSeconds * 1_000,
    );
    const url = await this.dependencies.objects.createDownloadUrl({
      key: current.version.objectKey,
      expiresAt,
    });
    await this.dependencies.audit.record(
      this.event(
        "document.download_url_issued.v1",
        current.document,
        current.version,
        input.actorId,
        input.correlationId,
        now,
        { expiresAt: expiresAt.toISOString() },
      ),
    );
    return { url, expiresAt };
  }

  async list(input: {
    actorId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
    correlationId?: string;
  }): Promise<readonly DocumentVersionAccess[]> {
    const resource = await this.requireReadableResource(
      input.actorId,
      input.resourceType,
      input.resourceId,
      input.correlationId,
    );
    return this.dependencies.store.listByResource({
      organizationId: resource.organizationId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    });
  }

  async withdraw(input: {
    actorId: string;
    correlationId: string;
    documentId: string;
    versionId: string;
    reason: string;
  }): Promise<DocumentVersionAccess> {
    const current = await this.requireVersion(
      input.documentId,
      input.versionId,
    );
    await this.assertWrite(
      input.actorId,
      current.document.organizationId,
      current.document.workspaceId,
      "document",
      current.document.id,
      input.correlationId,
    );
    if (current.version.status !== "published")
      throw new DocumentValidationError("DOCUMENT_NOT_PUBLISHED");
    const withdrawn = {
      ...current.version,
      status: "withdrawn" as const,
      evidenceStatus: "withdrawn" as const,
      withdrawnAt: this.dependencies.clock.now(),
    };
    if (
      !(await this.dependencies.store.withdraw({
        version: withdrawn,
        audit: this.event(
          "document.withdrawn.v1",
          current.document,
          withdrawn,
          input.actorId,
          input.correlationId,
          withdrawn.withdrawnAt!,
          { reason: input.reason },
        ),
      }))
    )
      throw new DocumentValidationError("DOCUMENT_NOT_PUBLISHED");
    return { document: current.document, version: withdrawn };
  }

  async beginReplacement(input: {
    actorId: string;
    correlationId: string;
    documentId: string;
    replacedVersionId: string;
    fileName: string;
    contentType: string;
    contentLength: number;
    sha256: string;
  }) {
    const current = await this.requireVersion(
      input.documentId,
      input.replacedVersionId,
    );
    await this.assertWrite(
      input.actorId,
      current.document.organizationId,
      current.document.workspaceId,
      "document",
      current.document.id,
      input.correlationId,
    );
    if (
      current.version.status !== "published" &&
      current.version.status !== "withdrawn"
    )
      throw new DocumentValidationError("DOCUMENT_NOT_REPLACEABLE");
    this.assertExtension(input.fileName, input.contentType);
    if (input.contentLength > this.dependencies.maxBytes)
      throw new DocumentValidationError("DOCUMENT_TOO_LARGE");
    const now = this.dependencies.clock.now();
    const version: DocumentVersion = {
      ...current.version,
      id: this.dependencies.ids.next(),
      versionNumber: current.version.versionNumber + 1,
      originalName: input.fileName,
      declaredContentType: input.contentType,
      detectedContentType: null,
      byteLength: input.contentLength,
      sha256: input.sha256.toLowerCase(),
      status: "quarantined",
      quarantineKey: `quarantine/${current.document.organizationId}/${current.document.id}/${this.dependencies.ids.next()}`,
      objectKey: null,
      createdAt: now,
      publishedAt: null,
      rejectedAt: null,
      withdrawnAt: null,
      retentionUntil: null,
      evidenceStatus: "pending",
      supersedesVersionId: current.version.id,
      replacedByVersionId: null,
    };
    await this.dependencies.store.createReplacement({
      version,
      audit: this.event(
        "document.replaced.v1",
        current.document,
        version,
        input.actorId,
        input.correlationId,
        now,
        { replacesVersionId: current.version.id },
      ),
    });
    const expiresAt = new Date(
      now.getTime() + this.dependencies.urlTtlSeconds * 1_000,
    );
    const upload = await this.dependencies.objects.createUploadUrl({
      key: version.quarantineKey,
      contentType: version.declaredContentType,
      checksumSha256: version.sha256,
      expiresAt,
    });
    return { document: current.document, version, upload, expiresAt };
  }

  async restoreVersion(input: {
    actorId: string;
    correlationId: string;
    documentId: string;
    versionId: string;
  }): Promise<DocumentVersionAccess> {
    const source = await this.requireVersion(input.documentId, input.versionId);
    await this.assertWrite(
      input.actorId,
      source.document.organizationId,
      source.document.workspaceId,
      "document",
      source.document.id,
      input.correlationId,
    );
    if (!source.version.objectKey || source.version.status === "purged")
      throw new DocumentValidationError("DOCUMENT_NOT_RESTORABLE");
    const latest = await this.dependencies.store.findLatestVersion(
      source.document.id,
    );
    if (!latest || latest.version.id === source.version.id)
      throw new DocumentValidationError("DOCUMENT_NOT_RESTORABLE");
    const now = this.dependencies.clock.now();
    const version: DocumentVersion = {
      ...source.version,
      id: this.dependencies.ids.next(),
      versionNumber: latest.version.versionNumber + 1,
      detectedContentType: source.version.detectedContentType,
      status: "pending_scan",
      quarantineKey: `quarantine/${source.document.organizationId}/${source.document.id}/${this.dependencies.ids.next()}`,
      objectKey: null,
      createdAt: now,
      publishedAt: null,
      rejectedAt: null,
      withdrawnAt: null,
      retentionUntil: null,
      evidenceStatus: "pending",
      supersedesVersionId: latest.version.id,
      replacedByVersionId: null,
    };
    await this.dependencies.objects.copy({
      sourceKey: source.version.objectKey,
      destinationKey: version.quarantineKey,
    });
    const event = this.durableEvent(
      source.document,
      version,
      input.correlationId,
      now,
    );
    await this.dependencies.store.restore({
      version,
      audit: this.event(
        "document.restored.v1",
        source.document,
        version,
        input.actorId,
        input.correlationId,
        now,
        { restoredVersionId: source.version.id },
      ),
      event,
    });
    return { document: source.document, version };
  }

  private async requireVersion(documentId: string, versionId: string) {
    const found = await this.dependencies.store.findVersion({
      documentId,
      versionId,
    });
    if (!found) throw new DocumentNotFoundError();
    return found;
  }
  private assertExtension(fileName: string, contentType: string): void {
    const extension = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
    const expected: Readonly<Record<string, readonly string[]>> = {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "text/plain": [".txt"],
    };
    if (!expected[contentType]?.includes(extension))
      throw new DocumentValidationError("DOCUMENT_EXTENSION_MISMATCH");
  }
  private durableEvent(
    document: InstitutionalDocument,
    version: DocumentVersion,
    correlationId: string,
    occurredAt: Date,
  ): DurableDomainEvent {
    return {
      eventId: this.dependencies.ids.next(),
      eventType: "document.scan_requested.v1",
      occurredAt,
      aggregateId: version.id,
      aggregateType: "document_version",
      aggregateVersion: version.versionNumber,
      organizationId: document.organizationId,
      correlationId,
      causationId: null,
      schemaVersion: 1,
      payload: { documentId: document.id, versionId: version.id },
    };
  }
  async relocate(input: {
    actorId: string;
    correlationId: string;
    documentId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
  }): Promise<InstitutionalDocument> {
    const found = await this.dependencies.store.findLatestVersion(
      input.documentId,
    );
    if (!found) throw new DocumentNotFoundError();
    await this.requireWritableResource(
      input.actorId,
      found.document.resourceType,
      found.document.resourceId,
      input.correlationId,
    );
    const target = await this.requireWritableResource(
      input.actorId,
      input.resourceType,
      input.resourceId,
      input.correlationId,
    );
    if (
      target.organizationId !== found.document.organizationId ||
      target.workspaceId !== found.document.workspaceId
    )
      throw new DocumentAccessDeniedError();
    const document = {
      ...found.document,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    };
    const moved = await this.dependencies.store.relocate({
      document,
      audit: this.event(
        "document.relocated.v1",
        document,
        found.version,
        input.actorId,
        input.correlationId,
        this.dependencies.clock.now(),
        {
          fromResourceType: found.document.resourceType,
          fromResourceId: found.document.resourceId,
        },
      ),
    });
    if (!moved)
      throw new DocumentValidationError("DOCUMENT_RELOCATION_BLOCKED");
    return document;
  }

  private async requireWritableResource(
    actorId: string,
    resourceType: DocumentResourceType,
    resourceId: string,
    correlationId: string,
  ) {
    const resource = await this.requireResource(resourceType, resourceId);
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      resource.workspaceId,
    );
    await this.assertWrite(
      actorId,
      resource.organizationId,
      resource.workspaceId,
      resourceType,
      resourceId,
      correlationId,
    );
    return resource;
  }
  private async requireReadableResource(
    actorId: string,
    resourceType: DocumentResourceType,
    resourceId: string,
    correlationId?: string,
  ) {
    const resource = await this.requireResource(resourceType, resourceId);
    await this.assertRead(
      actorId,
      {
        organizationId: resource.organizationId,
        workspaceId: resource.workspaceId,
        resourceType,
        resourceId,
      },
      resourceType,
      resourceId,
      correlationId,
    );
    return resource;
  }
  private async requireResource(
    resourceType: DocumentResourceType,
    resourceId: string,
  ) {
    const resource = await this.dependencies.store.resolveResource({
      resourceType,
      resourceId,
    });
    if (!resource) throw new DocumentNotFoundError();
    return resource;
  }
  private async roles(
    actorId: string,
    organizationId: string,
    workspaceId: string,
  ) {
    return {
      organizationRole: await this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId,
      }),
      workspaceRole: await this.dependencies.tenancy.findWorkspaceRole({
        actorId,
        workspaceId,
      }),
    };
  }
  private async assertWrite(
    actorId: string,
    organizationId: string,
    workspaceId: string,
    resourceType: TemporaryGrantResourceType,
    resourceId: string,
    correlationId: string,
  ) {
    await assertWorkspaceWritable(this.dependencies.tenancy, workspaceId);
    if (
      canCreateInitiative(
        await this.roles(actorId, organizationId, workspaceId),
      )
    )
      return;
    if (
      await this.dependencies.accessGrants?.authorize({
        actorId,
        organizationId,
        workspaceId,
        resourceType,
        resourceId,
        action: "contribute",
        correlationId,
      })
    )
      return;
    throw new DocumentAccessDeniedError();
  }
  private async assertRead(
    actorId: string,
    resource: Pick<
      InstitutionalDocument,
      "organizationId" | "workspaceId" | "resourceType" | "resourceId"
    >,
    grantResourceType: TemporaryGrantResourceType,
    grantResourceId: string,
    correlationId?: string,
  ) {
    const roles = await this.roles(
      actorId,
      resource.organizationId,
      resource.workspaceId,
    );
    const organizationManager =
      roles.organizationRole === "owner" || roles.organizationRole === "admin";
    const hasWorkspaceAccess =
      organizationManager || Boolean(roles.workspaceRole);
    const hasProjectAccess =
      resource.resourceType !== "project" ||
      organizationManager ||
      (await this.dependencies.projectAccess?.isParticipant({
        actorId,
        projectId: resource.resourceId,
      })) === true;
    if (hasWorkspaceAccess && hasProjectAccess) return;
    if (
      await this.dependencies.accessGrants?.authorize({
        actorId,
        organizationId: resource.organizationId,
        workspaceId: resource.workspaceId,
        resourceType: grantResourceType,
        resourceId: grantResourceId,
        action: "read",
        correlationId: correlationId ?? this.dependencies.ids.next(),
      })
    )
      return;
    throw new DocumentAccessDeniedError();
  }
  private event(
    eventType: DocumentAuditEvent["eventType"],
    document: InstitutionalDocument,
    version: DocumentVersion,
    actorId: string,
    correlationId: string,
    occurredAt: Date,
    payload: Readonly<Record<string, unknown>>,
  ): DocumentAuditEvent {
    return {
      id: this.dependencies.ids.next(),
      eventType,
      documentId: document.id,
      versionId: version.id,
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      actorId,
      correlationId,
      occurredAt,
      payload,
    };
  }
}
export class DocumentScanService implements DurableEventHandler {
  constructor(
    private readonly dependencies: {
      store: DocumentStore;
      audit: DocumentAuditStore;
      objects: DocumentObjectStore;
      scanner: DocumentMalwareScanner;
      ids: DocumentIdGenerator;
      clock: DocumentClock;
      retentionDays: Readonly<Record<DocumentClassification, number>>;
    },
  ) {}
  async handle(event: DurableDomainEvent): Promise<void> {
    if (event.eventType !== "document.scan_requested.v1") return;
    const documentId = event.payload.documentId;
    const versionId = event.payload.versionId;
    if (typeof documentId !== "string" || typeof versionId !== "string")
      throw new Error("Invalid document scan event payload");
    const current = await this.dependencies.store.findVersion({
      documentId,
      versionId,
    });
    if (!current || current.version.status !== "pending_scan") return;
    assertDocumentScanEventScope({ event, current });
    const now = this.dependencies.clock.now();
    const scanned = await this.dependencies.scanner.scan({
      content: await this.dependencies.objects.readQuarantine({
        key: current.version.quarantineKey,
      }),
      fileName: current.version.originalName,
    });
    if (!scanned.clean) {
      const rejected = {
        ...current.version,
        status: "rejected" as const,
        evidenceStatus: "withdrawn" as const,
        rejectedAt: now,
      };
      await this.dependencies.store.reject({
        version: rejected,
        audit: this.event(
          "document.malware_rejected.v1",
          current,
          rejected,
          event,
          now,
          { signature: scanned.signature },
        ),
      });
      await this.dependencies.objects.delete({
        key: current.version.quarantineKey,
      });
      return;
    }
    const published = {
      ...current.version,
      status: "published" as const,
      evidenceStatus: "valid" as const,
      objectKey: `documents/${current.document.organizationId}/${current.document.id}/v${current.version.versionNumber}`,
      publishedAt: now,
      retentionUntil: new Date(
        now.getTime() +
          this.dependencies.retentionDays[current.document.classification] *
            86_400_000,
      ),
    };
    await this.dependencies.objects.promote({
      sourceKey: published.quarantineKey,
      destinationKey: published.objectKey,
    });
    if (
      !(await this.dependencies.store.publish({
        version: published,
        audit: this.event(
          "document.published.v1",
          current,
          published,
          event,
          now,
          { retentionUntil: published.retentionUntil.toISOString() },
        ),
      }))
    )
      throw new Error("Document publication race");
  }
  async purgeExpired(): Promise<number> {
    let purged = 0;
    for (const current of await this.dependencies.store.listExpired(
      this.dependencies.clock.now(),
    )) {
      if (current.version.objectKey)
        await this.dependencies.objects.delete({
          key: current.version.objectKey,
        });
      const version = {
        ...current.version,
        status: "purged" as const,
        objectKey: null,
        evidenceStatus: "withdrawn" as const,
      };
      if (
        await this.dependencies.store.purge({
          version,
          audit: this.event(
            "document.purged.v1",
            current,
            version,
            { correlationId: this.dependencies.ids.next(), eventId: null },
            this.dependencies.clock.now(),
            {},
          ),
        })
      )
        purged++;
    }
    return purged;
  }
  private event(
    eventType: DocumentAuditEvent["eventType"],
    current: DocumentVersionAccess,
    version: DocumentVersion,
    event: { correlationId: string; eventId: string | null },
    occurredAt: Date,
    payload: Readonly<Record<string, unknown>>,
  ): DocumentAuditEvent {
    return {
      id: this.dependencies.ids.next(),
      eventType,
      documentId: current.document.id,
      versionId: version.id,
      organizationId: current.document.organizationId,
      workspaceId: current.document.workspaceId,
      actorId: "system:document-scanner",
      correlationId: event.correlationId,
      occurredAt,
      payload: {
        ...payload,
        ...(event.eventId ? { asyncEventId: event.eventId } : {}),
      },
    };
  }
}
export class DocumentAccessDeniedError extends Error {
  constructor() {
    super("DOCUMENT_ACCESS_DENIED");
  }
}
export class DocumentNotFoundError extends Error {
  constructor() {
    super("DOCUMENT_NOT_FOUND");
  }
}
export class DocumentValidationError extends Error {
  constructor(
    public readonly code:
      | "DOCUMENT_TOO_LARGE"
      | "DOCUMENT_NOT_QUARANTINED"
      | "DOCUMENT_CONTENT_MISMATCH"
      | "DOCUMENT_EXTENSION_MISMATCH"
      | "DOCUMENT_NOT_PUBLISHED"
      | "DOCUMENT_NOT_REPLACEABLE"
      | "DOCUMENT_NOT_RESTORABLE"
      | "DOCUMENT_RELOCATION_BLOCKED",
  ) {
    super(code);
  }
}
