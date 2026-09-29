import { z } from "zod";

export const UserProfileInputSchema = z.object({
  displayName: z.string().trim().max(120),
  role: z.string().trim().max(120),
  bio: z.string().trim().max(600),
  avatarData: z
    .string()
    .max(700_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
    .nullable(),
});

export const UserProfileResponseSchema = UserProfileInputSchema.extend({
  updatedAt: z.string().datetime().nullable(),
});

export type UserProfileInput = z.infer<typeof UserProfileInputSchema>;
export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;
