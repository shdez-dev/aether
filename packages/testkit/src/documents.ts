import type {
  DocumentAuditEvent,
  DocumentAuditStore,
  DocumentObjectStore,
  DocumentResource,
  DocumentStore,
  DocumentVersionAccess,
  DocumentProjectAccess,
} from "@aether/application";
import type {
  DocumentResourceType,
  DocumentVersion,
  InstitutionalDocument,
} from "@aether/domain";

export class InMemoryDocumentStore
  implements DocumentStore, DocumentAuditStore
{
  readonly resources = new Map<string, DocumentResource>();
  readonly documents = new Map<string, InstitutionalDocument>();
  readonly versions = new Map<string, DocumentVersion>();
  readonly audits: DocumentAuditEvent[] = [];
  readonly events: import("@aether/application").DurableDomainEvent[] = [];
  addResource(
    type: DocumentResourceType,
    id: string,
    resource: DocumentResource,
  ): void {
    this.resources.set(`${type}:${id}`, resource);
  }
  async resolveResource(input: {
    resourceType: DocumentResourceType;
    resourceId: string;
  }) {
    return (
      this.resources.get(`${input.resourceType}:${input.resourceId}`) ?? null
    );
  }
  async createQuarantined(input: {
    document: InstitutionalDocument;
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }) {
    this.documents.set(input.document.id, input.document);
    this.versions.set(input.version.id, input.version);
    this.audits.push(input.audit);
  }
  async findVersion(input: {
    documentId: string;
    versionId: string;
  }): Promise<DocumentVersionAccess | null> {
    const document = this.documents.get(input.documentId);
    const version = this.versions.get(input.versionId);
    return document && version?.documentId === document.id
      ? { document, version }
      : null;
  }
  async findLatestVersion(
    documentId: string,
  ): Promise<DocumentVersionAccess | null> {
    const version = [...this.versions.values()]
      .filter((candidate) => candidate.documentId === documentId)
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];
    const document = version ? this.documents.get(documentId) : null;
    return document && version ? { document, version } : null;
  }
  async listByResource(input: {
    organizationId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
  }): Promise<readonly DocumentVersionAccess[]> {
    return [...this.versions.values()].flatMap((version) => {
      const document = this.documents.get(version.documentId);
      return document &&
        document.organizationId === input.organizationId &&
        document.resourceType === input.resourceType &&
        document.resourceId === input.resourceId
        ? [{ document, version }]
        : [];
    });
  }
  async publish(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }) {
    const current = this.versions.get(input.version.id);
    if (!current || current.status !== "pending_scan") return false;
    this.versions.set(input.version.id, input.version);
    if (input.version.supersedesVersionId) {
      const previous = this.versions.get(input.version.supersedesVersionId);
      if (previous)
        this.versions.set(previous.id, {
          ...previous,
          status: "superseded",
          evidenceStatus: "replaced",
          replacedByVersionId: input.version.id,
        });
    }
    this.audits.push(input.audit);
    return true;
  }
  async reject(input: { version: DocumentVersion; audit: DocumentAuditEvent }) {
    const current = this.versions.get(input.version.id);
    if (!current || !["quarantined", "pending_scan"].includes(current.status))
      return false;
    this.versions.set(input.version.id, input.version);
    this.audits.push(input.audit);
    return true;
  }
  async queueForScan(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
    event: import("@aether/application").DurableDomainEvent;
  }) {
    const current = this.versions.get(input.version.id);
    if (!current || current.status !== "quarantined") return false;
    this.versions.set(input.version.id, input.version);
    this.audits.push(input.audit);
    this.events.push(input.event);
    return true;
  }
  async createReplacement(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }) {
    this.versions.set(input.version.id, input.version);
    this.audits.push(input.audit);
  }
  async restore(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
    event: import("@aether/application").DurableDomainEvent;
  }) {
    this.versions.set(input.version.id, input.version);
    this.audits.push(input.audit);
    this.events.push(input.event);
  }
  async withdraw(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }) {
    const current = this.versions.get(input.version.id);
    if (!current || current.status !== "published") return false;
    this.versions.set(input.version.id, input.version);
    this.audits.push(input.audit);
    return true;
  }
  async listExpired(now: Date) {
    return [...this.versions.values()].flatMap((version) => {
      const document = this.documents.get(version.documentId);
      return document &&
        version.retentionUntil &&
        version.retentionUntil <= now &&
        ["published", "withdrawn", "superseded"].includes(version.status)
        ? [{ document, version }]
        : [];
    });
  }
  async purge(input: { version: DocumentVersion; audit: DocumentAuditEvent }) {
    const current = this.versions.get(input.version.id);
    if (
      !current ||
      !["published", "withdrawn", "superseded"].includes(current.status)
    )
      return false;
    this.versions.set(input.version.id, input.version);
    this.audits.push(input.audit);
    return true;
  }
  async record(event: DocumentAuditEvent) {
    this.audits.push(event);
  }
  async relocate(input: {
    document: InstitutionalDocument;
    audit: DocumentAuditEvent;
  }): Promise<boolean> {
    if (!this.documents.has(input.document.id)) return false;
    this.documents.set(input.document.id, input.document);
    this.audits.push(input.audit);
    return true;
  }
}
export class InMemoryDocumentProjectAccess implements DocumentProjectAccess {
  readonly participants = new Set<string>();
  grant(projectId: string, actorId: string): void {
    this.participants.add(`${projectId}:${actorId}`);
  }
  async isParticipant(input: {
    actorId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.participants.has(`${input.projectId}:${input.actorId}`);
  }
}
export class InMemoryDocumentObjectStore implements DocumentObjectStore {
  readonly quarantine = new Map<
    string,
    { bytes: number; sha256: string; contentType: string }
  >();
  readonly published = new Map<
    string,
    { bytes: number; sha256: string; contentType: string }
  >();
  async createUploadUrl(input: {
    key: string;
    contentType: string;
    checksumSha256: string;
    expiresAt: Date;
  }) {
    return {
      url: `https://storage.test/upload/${input.key}?expires=${input.expiresAt.getTime()}`,
      headers: {
        "content-type": input.contentType,
        "x-amz-meta-sha256": input.checksumSha256,
      },
    };
  }
  putQuarantined(
    key: string,
    value: { bytes: number; sha256: string; contentType: string },
  ) {
    this.quarantine.set(key, value);
  }
  async inspectQuarantine(input: { key: string }) {
    const object = this.quarantine.get(input.key);
    if (!object) throw new Error("not found");
    return {
      byteLength: object.bytes,
      sha256: object.sha256,
      detectedContentType: object.contentType,
    };
  }
  async promote(input: { sourceKey: string; destinationKey: string }) {
    const object = this.quarantine.get(input.sourceKey);
    if (!object) throw new Error("not found");
    this.quarantine.delete(input.sourceKey);
    this.published.set(input.destinationKey, object);
  }
  async copy(input: { sourceKey: string; destinationKey: string }) {
    const object = this.published.get(input.sourceKey);
    if (!object) throw new Error("not found");
    this.quarantine.set(input.destinationKey, { ...object });
  }
  async readQuarantine(input: { key: string }) {
    const object = this.quarantine.get(input.key);
    if (!object) throw new Error("not found");
    return new Uint8Array(object.bytes);
  }
  async delete(input: { key: string }) {
    this.published.delete(input.key);
    this.quarantine.delete(input.key);
  }
  async createDownloadUrl(input: { key: string; expiresAt: Date }) {
    if (!this.published.has(input.key)) throw new Error("not found");
    return `https://storage.test/download/${input.key}?expires=${input.expiresAt.getTime()}`;
  }
}
