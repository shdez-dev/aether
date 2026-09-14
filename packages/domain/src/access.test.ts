import { describe, expect, it } from "vitest";

import {
  AuthorizationMatrix,
  calculateCapabilities,
  isActionAllowed,
  type AccessCapabilities,
  type OrganizationRole,
  type WorkspaceRole,
} from "./access.js";

describe("AuthorizationMatrix", () => {
  it.each<{
    organizationRole: OrganizationRole | null;
    workspaceRole: WorkspaceRole | null;
    expected: AccessCapabilities;
  }>([
    {
      organizationRole: "owner",
      workspaceRole: null,
      expected: {
        canReadOrganization: true,
        canManageOrganization: true,
        canCreateWorkspace: true,
        canReadWorkspace: true,
        canManageWorkspace: true,
        canInviteMembers: true,
      },
    },
    {
      organizationRole: "member",
      workspaceRole: null,
      expected: {
        canReadOrganization: true,
        canManageOrganization: false,
        canCreateWorkspace: false,
        canReadWorkspace: false,
        canManageWorkspace: false,
        canInviteMembers: false,
      },
    },
    {
      organizationRole: null,
      workspaceRole: "admin",
      expected: {
        canReadOrganization: false,
        canManageOrganization: false,
        canCreateWorkspace: false,
        canReadWorkspace: true,
        canManageWorkspace: true,
        canInviteMembers: false,
      },
    },
    {
      organizationRole: null,
      workspaceRole: "viewer",
      expected: {
        canReadOrganization: false,
        canManageOrganization: false,
        canCreateWorkspace: false,
        canReadWorkspace: true,
        canManageWorkspace: false,
        canInviteMembers: false,
      },
    },
    {
      organizationRole: null,
      workspaceRole: null,
      expected: {
        canReadOrganization: false,
        canManageOrganization: false,
        canCreateWorkspace: false,
        canReadWorkspace: false,
        canManageWorkspace: false,
        canInviteMembers: false,
      },
    },
  ])("resolves roles without implicit grants", ({ organizationRole, workspaceRole, expected }) => {
    const capabilities = calculateCapabilities({ organizationRole, workspaceRole });

    expect(capabilities).toEqual(expected);
    for (const action of Object.keys(AuthorizationMatrix) as Array<
      keyof typeof AuthorizationMatrix
    >) {
      expect(isActionAllowed(action, capabilities)).toBe(
        expected[AuthorizationMatrix[action].capability],
      );
    }
  });
});
