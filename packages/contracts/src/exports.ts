import { z } from "zod";
export const ExportRequestSchema = z.object({
  scope: z.literal("organization_audit"),
});
