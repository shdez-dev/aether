import { z } from "zod";
import { UuidSchema } from "./common.js";

export const EvidenceReferenceSubjectTypeSchema = z.enum([
  "evaluation",
  "decision",
  "project_closure",
]);
export const AttachEvidenceRequestSchema = z.object({
  organizationId: UuidSchema,
  documentId: UuidSchema,
  documentVersionId: UuidSchema,
});
export const EvidenceReferenceResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  subjectType: EvidenceReferenceSubjectTypeSchema,
  subjectId: UuidSchema,
  documentId: UuidSchema,
  documentVersionId: UuidSchema,
  linkedByActorId: z.string(),
  linkedAt: z.string().datetime(),
  compliance: z.enum(["valid", "invalid"]),
});
