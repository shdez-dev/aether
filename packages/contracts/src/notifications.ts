import { z } from "zod";
import { UuidSchema } from "./common.js";
export const NotificationPreferenceRequestSchema = z.object({
  organizationId: UuidSchema,
  emailEnabled: z.boolean(),
});
export const NotificationInboxQuerySchema = z.object({
  organizationId: UuidSchema,
});
