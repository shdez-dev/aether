import { z } from "zod";

import { NonEmptyTextSchema, UuidSchema } from "./common.js";

export const TenancyPolicyValuesSchema = z.object({
  dataResidencyRegion: z.string().trim().min(2).max(64),
  retentionDays: z.number().int().min(1).max(3650),
});

export const CreateOrganizationRequestSchema = z.object({
  name: NonEmptyTextSchema.max(255),
  timezone: z.string().trim().min(1).max(64),
  locale: z.string().trim().min(2).max(16),
  policy: TenancyPolicyValuesSchema,
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

export const WorkspacePolicyOverrideRequestSchema = z
  .object({
    dataResidencyRegion: z.string().trim().min(2).max(64).nullable(),
    retentionDays: z.number().int().min(1).max(3650).nullable(),
  })
  .refine(
    (value) =>
      value.dataResidencyRegion !== null || value.retentionDays !== null,
    { message: "Debe configurar al menos una excepción de política." },
  );

const PolicyValueSchema = z.object({
  value: z.union([z.string(), z.number()]),
  origin: z.enum(["organization", "workspace"]),
});

export const EffectiveTenancyPolicyResponseSchema = z.object({
  organizationId: UuidSchema,
  workspaceId: UuidSchema.nullable(),
  dataResidencyRegion: PolicyValueSchema.extend({ value: z.string() }),
  retentionDays: PolicyValueSchema.extend({ value: z.number().int() }),
  organizationPolicy: z.object({
    organizationId: UuidSchema,
    dataResidencyRegion: z.string(),
    retentionDays: z.number().int(),
    version: z.number().int().nonnegative(),
    updatedByActorId: z.string(),
    updatedAt: z.string().datetime(),
  }),
  workspaceOverride: z
    .object({
      organizationId: UuidSchema,
      workspaceId: UuidSchema,
      dataResidencyRegion: z.string().nullable(),
      retentionDays: z.number().int().nullable(),
      version: z.number().int().nonnegative(),
      updatedByActorId: z.string(),
      updatedAt: z.string().datetime(),
    })
    .nullable(),
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
export type TenancyPolicyValues = z.infer<typeof TenancyPolicyValuesSchema>;
export type WorkspacePolicyOverrideRequest = z.infer<
  typeof WorkspacePolicyOverrideRequestSchema
>;
export type EffectiveTenancyPolicyResponse = z.infer<
  typeof EffectiveTenancyPolicyResponseSchema
>;
