import { z } from "zod";

import { NonEmptyTextSchema, UuidSchema } from "./common.js";

const IanaTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (timezone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Debe ser una zona horaria IANA válida." },
  );

export const BusinessHoursPolicySchema = z
  .object({
    mode: z.enum(["disabled", "audit", "enforce"]),
    timezone: IanaTimezoneSchema,
    windows: z
      .array(
        z
          .object({
            dayOfWeek: z.number().int().min(1).max(7),
            startMinute: z.number().int().min(0).max(1439),
            endMinute: z.number().int().min(1).max(1440),
          })
          .refine((window) => window.startMinute < window.endMinute, {
            message: "La franja debe terminar después de comenzar.",
          }),
      )
      .max(21),
  })
  .superRefine((policy, context) => {
    for (const [index, window] of policy.windows.entries()) {
      const overlaps = policy.windows.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index &&
          candidate.dayOfWeek === window.dayOfWeek &&
          candidate.startMinute < window.endMinute &&
          window.startMinute < candidate.endMinute,
      );
      if (overlaps)
        context.addIssue({
          code: "custom",
          path: ["windows", index],
          message: "Las franjas del mismo día no pueden solaparse.",
        });
    }
  });

export const TenancyPolicyValuesSchema = z.object({
  dataResidencyRegion: z.string().trim().min(2).max(64),
  retentionDays: z.number().int().min(1).max(3650),
  businessHours: BusinessHoursPolicySchema.optional(),
});

export const CreateOrganizationRequestSchema = z.object({
  name: NonEmptyTextSchema.max(255),
  organizationType: z.enum(["personal", "business", "institutional"]),
  timezone: z.string().trim().min(1).max(64),
  locale: z.string().trim().min(2).max(16),
  policy: TenancyPolicyValuesSchema,
});

export const OrganizationResponseSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  organizationType: z
    .enum(["personal", "business", "institutional"])
    .nullable(),
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
export const InvitationTokenRequestSchema = z.object({
  token: z.string().min(32).max(255),
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
    businessHours: BusinessHoursPolicySchema.optional(),
  })
  .refine(
    (value) =>
      value.dataResidencyRegion !== null ||
      value.retentionDays !== null ||
      value.businessHours !== undefined,
    { message: "Debe configurar al menos una excepción de política." },
  );

const PolicyValueSchema = z.object({
  value: z.union([z.string(), z.number()]),
  origin: z.enum(["organization", "workspace"]),
});
const BusinessHoursPolicyValueSchema = z.object({
  value: BusinessHoursPolicySchema,
  origin: z.enum(["default", "organization", "workspace"]),
});

export const EffectiveTenancyPolicyResponseSchema = z.object({
  organizationId: UuidSchema,
  workspaceId: UuidSchema.nullable(),
  dataResidencyRegion: PolicyValueSchema.extend({ value: z.string() }),
  retentionDays: PolicyValueSchema.extend({ value: z.number().int() }),
  businessHours: BusinessHoursPolicyValueSchema,
  organizationPolicy: z.object({
    organizationId: UuidSchema,
    dataResidencyRegion: z.string(),
    retentionDays: z.number().int(),
    businessHours: BusinessHoursPolicySchema.nullable(),
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
      businessHours: BusinessHoursPolicySchema.nullable(),
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
export type InvitationTokenRequest = z.infer<
  typeof InvitationTokenRequestSchema
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
export type BusinessHoursPolicy = z.infer<typeof BusinessHoursPolicySchema>;
export type WorkspacePolicyOverrideRequest = z.infer<
  typeof WorkspacePolicyOverrideRequestSchema
>;
export type EffectiveTenancyPolicyResponse = z.infer<
  typeof EffectiveTenancyPolicyResponseSchema
>;
