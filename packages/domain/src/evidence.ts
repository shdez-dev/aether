/** Referencia inmutable a una versión concreta de evidencia documental. */
export const EvidenceReferenceSubjectTypes = [
  "evaluation",
  "decision",
  "project_closure",
] as const;
export type EvidenceReferenceSubjectType =
  (typeof EvidenceReferenceSubjectTypes)[number];

export type EvidenceReference = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  subjectType: EvidenceReferenceSubjectType;
  subjectId: string;
  documentId: string;
  documentVersionId: string;
  linkedByActorId: string;
  linkedAt: Date;
}>;

/** El vínculo histórico no cambia; este valor describe su validez operativa hoy. */
export type EvidenceCompliance = "valid" | "invalid";
