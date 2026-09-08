import { z } from "zod";

import { NonEmptyTextSchema, UuidSchema } from "./common.js";

export const CreateOrganizationRequestSchema = z.object({
  name: NonEmptyTextSchema.max(255),
  timezone: z.string().trim().min(1).max(64),
  locale: z.string().trim().min(2).max(16),
});

export const OrganizationResponseSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  timezone: z.string(),
  locale: z.string(),
  version: z.number().int().nonnegative(),
});

export const CreateWorkspaceRequestSchema = z.object({
  organizationId: UuidSchema,
  name: NonEmptyTextSchema.max(255),
  mode: z.enum(["personal", "team", "institutional"]),
});

export const WorkspaceResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  name: z.string(),
  mode: z.enum(["personal", "team", "institutional"]),
  version: z.number().int().nonnegative(),
});

export type CreateOrganizationRequest = z.infer<
  typeof CreateOrganizationRequestSchema
>;
export type OrganizationResponse = z.infer<typeof OrganizationResponseSchema>;
export type CreateWorkspaceRequest = z.infer<
  typeof CreateWorkspaceRequestSchema
>;
export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;
