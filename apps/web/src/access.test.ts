import { describe, expect, it } from "vitest";

import { canRenderWorkspaceAction } from "./access.js";

describe("workspace UI access", () => {
  it("only shows actions granted by server-calculated capabilities", () => {
    const viewer = {
      canReadOrganization: true,
      canManageOrganization: false,
      canCreateWorkspace: false,
      canReadWorkspace: true,
      canManageWorkspace: false,
      canInviteMembers: false,
    };
    expect(canRenderWorkspaceAction(viewer, "view")).toBe(true);
    expect(canRenderWorkspaceAction(viewer, "manage")).toBe(false);
    expect(canRenderWorkspaceAction(viewer, "invite")).toBe(false);
  });
});
