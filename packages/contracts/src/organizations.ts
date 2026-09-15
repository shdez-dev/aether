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
  status: z.enum(["active", "archived"]),
  archivedAt: z.string().datetime().nullable(),
  archivedByActorId: z.string().nullable(),
});

export const CreateTeamRequestSchema = z.object({
  name: NonEmptyTextSchema.max(255),
  memberActorIds: z
    .array(z.string().trim().min(1).max(255))
    .max(500)
    .default([]),
});
export const TeamResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  name: z.string(),
  version: z.number().int().nonnegative(),
  memberActorIds: z.array(z.string()),
});
export const ReplaceTeamMembersRequestSchema = z.object({
  memberActorIds: z.array(z.string().trim().min(1).max(255)).max(500),
});

export const OrganizationRoleSchema = z.enum(["owner", "admin", "member"]);
export const WorkspaceRoleSchema = z.enum(["admin", "member", "viewer"]);

export const CreateInvitationRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  organizationRole: z.enum(["admin", "member"]),
  workspaceIds: z.array(UuidSchema).max(100).default([]),
  workspaceRole: WorkspaceRoleSchema.default("member"),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const TransferOrganizationOwnershipRequestSchema = z.object({
  targetActorId: z.string().trim().min(1).max(255),
});

export const ChangeMembershipStatusRequestSchema = z.object({
  status: z.enum(["suspended", "revoked"]),
});
export const ReassignMemberResponsibilitiesRequestSchema = z.object({
  replacementActorId: z.string().trim().min(1).max(255),
});

export const InvitationResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  email: z.string().email(),
  organizationRole: OrganizationRoleSchema,
  workspaceIds: z.array(UuidSchema),
  workspaceRole: WorkspaceRoleSchema,
  expiresAt: z.string().datetime(),
});

export const AccessCapabilitiesResponseSchema = z.object({
  canReadOrganization: z.boolean(),
  canManageOrganization: z.boolean(),
  canCreateWorkspace: z.boolean(),
  canReadWorkspace: z.boolean(),
  canManageWorkspace: z.boolean(),
  canInviteMembers: z.boolean(),
});

export type CreateOrganizationRequest = z.infer<
  typeof CreateOrganizationRequestSchema
>;
export type OrganizationResponse = z.infer<typeof OrganizationResponseSchema>;
export type CreateWorkspaceRequest = z.infer<
  typeof CreateWorkspaceRequestSchema
>;
export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;
export type TeamResponse = z.infer<typeof TeamResponseSchema>;
export type ReplaceTeamMembersRequest = z.infer<
  typeof ReplaceTeamMembersRequestSchema
>;
export type CreateInvitationRequest = z.infer<
  typeof CreateInvitationRequestSchema
>;
export type InvitationResponse = z.infer<typeof InvitationResponseSchema>;
export type TransferOrganizationOwnershipRequest = z.infer<
  typeof TransferOrganizationOwnershipRequestSchema
>;
export type ChangeMembershipStatusRequest = z.infer<
  typeof ChangeMembershipStatusRequestSchema
>;
export type ReassignMemberResponsibilitiesRequest = z.infer<
  typeof ReassignMemberResponsibilitiesRequestSchema
>;
export type AccessCapabilitiesResponse = z.infer<
  typeof AccessCapabilitiesResponseSchema
>;
