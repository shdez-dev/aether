import { z } from "zod";
import { UuidSchema } from "./common.js";
import { DocumentResourceTypeSchema } from "./documents.js";
export const CreateCommentRequestSchema = z.object({
  resourceType: DocumentResourceTypeSchema,
  resourceId: UuidSchema,
  body: z.string().trim().min(1).max(10000),
  mentionedActorIds: z.array(z.string().min(1).max(255)).max(50),
});
