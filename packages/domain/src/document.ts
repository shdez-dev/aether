/** Metadatos institucionales de archivos. El binario nunca forma parte del dominio. */
export const DocumentResourceTypes = [
  "initiative",
  "evaluation",
  "decision",
  "project",
] as const;
export type DocumentResourceType = (typeof DocumentResourceTypes)[number];

export const DocumentClassifications = [
  "internal",
  "confidential",
  "restricted",
] as const;
export type DocumentClassification = (typeof DocumentClassifications)[number];

export const DocumentVersionStatuses = [
  "quarantined",
  "pending_scan",
  "published",
  "rejected",
  "withdrawn",
  "superseded",
  "purged",
] as const;
export type DocumentVersionStatus = (typeof DocumentVersionStatuses)[number];
export const EvidenceStatuses = [
  "pending",
  "valid",
  "withdrawn",
  "replaced",
] as const;
export type EvidenceStatus = (typeof EvidenceStatuses)[number];

export type InstitutionalDocument = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  resourceType: DocumentResourceType;
  resourceId: string;
  classification: DocumentClassification;
  createdByActorId: string;
  createdAt: Date;
}>;

export type DocumentVersion = Readonly<{
  id: string;
  documentId: string;
  versionNumber: number;
  originalName: string;
  declaredContentType: string;
  detectedContentType: string | null;
  byteLength: number;
  sha256: string;
  status: DocumentVersionStatus;
  quarantineKey: string;
  objectKey: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  rejectedAt: Date | null;
  withdrawnAt: Date | null;
  retentionUntil: Date | null;
  evidenceStatus: EvidenceStatus;
  supersedesVersionId: string | null;
  replacedByVersionId: string | null;
}>;

/** Ubicación privada y mutable del binario; no se expone en DTOs HTTP. */
export type DocumentBinary = Readonly<{
  versionId: string;
  quarantineKey: string;
  objectKey: string | null;
}>;
