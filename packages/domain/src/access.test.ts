import { describe, expect, it } from "vitest";

import {
  AuthorizationMatrix,
  calculateCapabilities,
  isActionAllowed,
  isRoleAllowed,
  resolveContextualAccessLevels,
  type AccessCapabilities,
  type OrganizationRole,
  type WorkspaceRole,
} from "./access.js";

describe("AuthorizationMatrix", () => {
  it.each<{
    organizationRole: OrganizationRole | null;
    workspaceRole: WorkspaceRole | null;
    expected: Omit<AccessCapabilities, "accessLevels">;
  }>([
    {
      organizationRole: "owner",
      workspaceRole: "viewer",
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
      organizationRole: "admin",
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
      workspaceRole: "admin",
      expected: {
        canReadOrganization: true,
        canManageOrganization: false,
        canCreateWorkspace: false,
        canReadWorkspace: true,
        canManageWorkspace: true,
        canInviteMembers: false,
      },
    },
    {
      organizationRole: "member",
      workspaceRole: "member",
      expected: {
        canReadOrganization: true,
        canManageOrganization: false,
        canCreateWorkspace: false,
        canReadWorkspace: true,
        canManageWorkspace: false,
        canInviteMembers: false,
      },
    },
    {
      organizationRole: "member",
      workspaceRole: "viewer",
      expected: {
        canReadOrganization: true,
        canManageOrganization: false,
        canCreateWorkspace: false,
        canReadWorkspace: true,
        canManageWorkspace: false,
        canInviteMembers: false,
      },
    },
  ])(
    "combines organization and workspace roles without escalating grants",
    ({ organizationRole, workspaceRole, expected }) => {
      expect(
        calculateCapabilities({ organizationRole, workspaceRole }),
      ).toMatchObject(expected);
    },
  );

  it.each<{
    organizationRole: OrganizationRole | null;
    workspaceRole: WorkspaceRole | null;
    expected: Omit<AccessCapabilities, "accessLevels">;
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
  ])(
    "resolves roles without implicit grants",
    ({ organizationRole, workspaceRole, expected }) => {
      const capabilities = calculateCapabilities({
        organizationRole,
        workspaceRole,
      });

      expect(capabilities).toMatchObject(expected);
      for (const action of [
        "organization:read",
        "organization:manage",
        "workspace:create",
        "workspace:read",
        "workspace:manage",
        "member:invite",
      ] as const) {
        expect(isActionAllowed(action, capabilities)).toBe(
          expected[AuthorizationMatrix[action].capability],
        );
      }
    },
  );

  it.each([
    {
      action: "organization:ownership-transfer" as const,
      organizationRole: "owner" as const,
      workspaceRole: null,
      allowed: true,
    },
    {
      action: "organization:ownership-transfer" as const,
      organizationRole: "admin" as const,
      workspaceRole: null,
      allowed: false,
    },
    {
      action: "membership:manage" as const,
      organizationRole: "admin" as const,
      workspaceRole: null,
      allowed: true,
    },
    {
      action: "workspace:archive" as const,
      organizationRole: "member" as const,
      workspaceRole: "admin" as const,
      allowed: true,
    },
    {
      action: "team:manage-members" as const,
      organizationRole: "member" as const,
      workspaceRole: "member" as const,
      allowed: false,
    },
    {
      action: "workspace-policy:manage" as const,
      organizationRole: null,
      workspaceRole: "admin" as const,
      allowed: true,
    },
  ])(
    "applies the resource-specific policy for $action",
    ({ action, organizationRole, workspaceRole, allowed }) => {
      expect(isRoleAllowed(action, { organizationRole, workspaceRole })).toBe(
        allowed,
      );
    },
  );

  it.each([
    {
      organizationRole: "owner" as const,
      workspaceRole: null,
      expected: ["READ", "CONTRIBUTE", "MANAGE", "ADMIN"],
    },
    {
      organizationRole: "admin" as const,
      workspaceRole: null,
      expected: ["READ", "CONTRIBUTE", "MANAGE"],
    },
    {
      organizationRole: "member" as const,
      workspaceRole: "viewer" as const,
      expected: ["READ"],
    },
    {
      organizationRole: "member" as const,
      workspaceRole: "member" as const,
      expected: ["READ", "CONTRIBUTE"],
    },
  ])(
    "derives ordered contextual access levels",
    ({ organizationRole, workspaceRole, expected }) => {
      expect(
        resolveContextualAccessLevels({ organizationRole, workspaceRole }),
      ).toEqual(expected);
    },
  );
});
