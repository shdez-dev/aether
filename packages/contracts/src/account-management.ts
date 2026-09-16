import { z } from "zod";

export const AccountManagementStatusResponseSchema = z.object({
  available: z.boolean(),
  authority: z.literal("oidc-provider"),
});

export type AccountManagementStatusResponse = z.infer<
  typeof AccountManagementStatusResponseSchema
>;
