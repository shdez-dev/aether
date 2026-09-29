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
export const OrganizationTypeSchema = z.enum([
  "personal",
  "business",
  "institutional",
]);

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
  organizationType: OrganizationTypeSchema,
  timezone: z.string().trim().min(1).max(64),
  locale: z.string().trim().min(2).max(16),
  policy: TenancyPolicyValuesSchema,
});

export const OrganizationResponseSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  organizationType: OrganizationTypeSchema.nullable(),
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
export const OrganizationResponsibilityRoleSchema = z.enum([
  "initiative_coordinator",
  "initiative_evaluator",
  "initiative_approver",
  "initiative_mentor",
  "project_sponsor",
  "project_lead",
  "project_contributor",
  "project_observer",
]);
export const RoleImplementationStatusSchema = z.enum([
  "implemented",
  "restricted",
  "planned",
]);
const OrganizationAccessRoleDefinitionSchema = z.object({
  key: OrganizationRoleSchema,
  label: z.string(),
  scope: z.literal("organization"),
  description: z.string(),
});
const WorkspaceAccessRoleDefinitionSchema = z.object({
  key: WorkspaceRoleSchema,
  label: z.string(),
  scope: z.literal("workspace"),
  description: z.string(),
});
const ResponsibilityRoleDefinitionSchema = z.object({
  key: OrganizationResponsibilityRoleSchema,
  label: z.string(),
  scope: z.enum(["initiative", "project"]),
  description: z.string(),
  implementationStatus: RoleImplementationStatusSchema,
});
export const OrganizationRoleProfileResponseSchema = z.object({
  version: z.literal(1),
  organizationType: OrganizationTypeSchema.nullable(),
  profileKey: z.enum(["personal", "business", "institutional", "unclassified"]),
  profileLabel: z.string(),
  organizationAccessRoles: z.array(OrganizationAccessRoleDefinitionSchema),
  workspaceAccessRoles: z.array(WorkspaceAccessRoleDefinitionSchema),
  initiativeResponsibilities: z.array(ResponsibilityRoleDefinitionSchema),
  projectResponsibilities: z.array(ResponsibilityRoleDefinitionSchema),
});

export const InitiativeResponsibilityRoleSchema = z.enum([
  "initiative_coordinator",
  "initiative_evaluator",
  "initiative_approver",
  "initiative_mentor",
]);
export const AssignOrganizationResponsibilityRequestSchema = z.object({
  workspaceId: UuidSchema,
  actorId: z.string().trim().min(1).max(255),
  roleKey: InitiativeResponsibilityRoleSchema,
  initiativeId: UuidSchema.optional(),
  validUntil: z.string().date().optional(),
});
export const OrganizationResponsibilityInitiativeSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  status: z.string(),
});
export const OrganizationResponsibilityAssignmentSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  workspaceName: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  actorEmail: z.string().email().nullable(),
  roleKey: InitiativeResponsibilityRoleSchema,
  initiativeId: UuidSchema.nullable(),
  initiativeTitle: z.string().nullable(),
  validUntil: z.string().datetime().nullable(),
  assignedByActorId: z.string(),
  assignedAt: z.string().datetime(),
});
export const OrganizationResponsibilityMemberSchema = z.object({
  actorId: z.string(),
  actorName: z.string(),
  actorEmail: z.string().email().nullable(),
  organizationRole: OrganizationRoleSchema,
  workspaceRole: WorkspaceRoleSchema.nullable(),
});
export const OrganizationResponsibilitiesResponseSchema = z.object({
  members: z.array(OrganizationResponsibilityMemberSchema),
  initiatives: z.array(OrganizationResponsibilityInitiativeSchema),
  assignments: z.array(OrganizationResponsibilityAssignmentSchema),
});

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
  accessLevels: z.array(z.enum(["READ", "CONTRIBUTE", "MANAGE", "ADMIN"])),
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
export type OrganizationResponsibilityRole = z.infer<
  typeof OrganizationResponsibilityRoleSchema
>;
export type RoleImplementationStatus = z.infer<
  typeof RoleImplementationStatusSchema
>;
export type OrganizationRoleProfileResponse = z.infer<
  typeof OrganizationRoleProfileResponseSchema
>;
export type InitiativeResponsibilityRole = z.infer<
  typeof InitiativeResponsibilityRoleSchema
>;
export type AssignOrganizationResponsibilityRequest = z.infer<
  typeof AssignOrganizationResponsibilityRequestSchema
>;
export type OrganizationResponsibilityAssignment = z.infer<
  typeof OrganizationResponsibilityAssignmentSchema
>;
export type OrganizationResponsibilityMember = z.infer<
  typeof OrganizationResponsibilityMemberSchema
>;
export type OrganizationResponsibilityInitiative = z.infer<
  typeof OrganizationResponsibilityInitiativeSchema
>;
export type OrganizationResponsibilitiesResponse = z.infer<
  typeof OrganizationResponsibilitiesResponseSchema
>;
