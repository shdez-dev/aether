import { describe, expect, it } from "vitest";

import {
  AssignOrganizationResponsibilityRequestSchema,
  OrganizationRoleProfileResponseSchema,
} from "./organizations.js";

describe("OrganizationRoleProfileResponseSchema", () => {
  it("accepts a versioned profile with scoped roles and implementation status", () => {
    expect(
      OrganizationRoleProfileResponseSchema.parse({
        version: 1,
        organizationType: "institutional",
        profileKey: "institutional",
        profileLabel: "Institución",
        organizationAccessRoles: [
          {
            key: "owner",
            label: "Propietario",
            scope: "organization",
            description: "Gobierna la organización.",
          },
        ],
        workspaceAccessRoles: [],
        initiativeResponsibilities: [
          {
            key: "initiative_mentor",
            label: "Mentoría",
            scope: "initiative",
            description: "Acompaña la propuesta.",
            implementationStatus: "implemented",
          },
        ],
        projectResponsibilities: [],
      }),
    ).toMatchObject({
      organizationType: "institutional",
      initiativeResponsibilities: [
        { key: "initiative_mentor", implementationStatus: "implemented" },
      ],
    });
  });

  it("rejects role states outside the declared contract", () => {
    const profile = {
      version: 1,
      organizationType: "personal",
      profileKey: "personal",
      profileLabel: "Trabajo personal",
      organizationAccessRoles: [],
      workspaceAccessRoles: [],
      initiativeResponsibilities: [
        {
          key: "initiative_evaluator",
          label: "Evaluación",
          scope: "initiative",
          description: "Evalúa propuestas.",
          implementationStatus: "custom",
        },
      ],
      projectResponsibilities: [],
    };

    expect(
      OrganizationRoleProfileResponseSchema.safeParse(profile).success,
    ).toBe(false);
  });
});

describe("AssignOrganizationResponsibilityRequestSchema", () => {
  it("requires a valid workspace member and an initiative-only role", () => {
    const valid = {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      actorId: "member-1",
      roleKey: "initiative_evaluator",
    };
    expect(AssignOrganizationResponsibilityRequestSchema.parse(valid)).toEqual(
      valid,
    );
    expect(
      AssignOrganizationResponsibilityRequestSchema.safeParse({
        ...valid,
        roleKey: "project_lead",
      }).success,
    ).toBe(false);
  });
});
