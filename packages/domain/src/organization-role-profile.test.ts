import { describe, expect, it } from "vitest";

import { getOrganizationRoleProfile } from "./organization-role-profile.js";

describe("organization role profiles", () => {
  it("keeps access roles consistent and selects process roles by organization type", () => {
    const personal = getOrganizationRoleProfile("personal");
    const business = getOrganizationRoleProfile("business");
    const institutional = getOrganizationRoleProfile("institutional");

    expect(personal.organizationAccessRoles.map(({ key }) => key)).toEqual([
      "owner",
      "admin",
      "member",
    ]);
    expect(personal.workspaceAccessRoles.map(({ key }) => key)).toEqual([
      "admin",
      "member",
      "viewer",
    ]);
    expect(business.organizationAccessRoles).toEqual(
      personal.organizationAccessRoles,
    );
    expect(institutional.workspaceAccessRoles).toEqual(
      personal.workspaceAccessRoles,
    );
    expect(personal.initiativeResponsibilities).toEqual([]);
    expect(business.initiativeResponsibilities.map(({ key }) => key)).toEqual([
      "initiative_coordinator",
      "initiative_evaluator",
    ]);
    expect(
      institutional.initiativeResponsibilities.map(({ key }) => key),
    ).toEqual([
      "initiative_coordinator",
      "initiative_evaluator",
      "initiative_approver",
      "initiative_mentor",
    ]);
    expect(institutional.projectResponsibilities.map(({ key }) => key)).toEqual(
      [
        "project_sponsor",
        "project_lead",
        "project_contributor",
        "project_observer",
      ],
    );
  });

  it("marks initiative responsibilities as assignable and project roles as implemented", () => {
    const profile = getOrganizationRoleProfile("institutional");

    expect(
      profile.initiativeResponsibilities.map(
        ({ key, implementationStatus }) => [key, implementationStatus],
      ),
    ).toEqual([
      ["initiative_coordinator", "implemented"],
      ["initiative_evaluator", "implemented"],
      ["initiative_approver", "implemented"],
      ["initiative_mentor", "implemented"],
    ]);
  });

  it("gives legacy organizations a conservative unclassified profile", () => {
    expect(getOrganizationRoleProfile(null)).toMatchObject({
      organizationType: null,
      profileKey: "unclassified",
      initiativeResponsibilities: [],
    });
  });
});
