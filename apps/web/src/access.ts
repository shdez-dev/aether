import type { AccessCapabilitiesResponse } from "@aether/contracts";

export type WorkspaceUiAction = "view" | "manage" | "invite" | "create";

/**
 * Espejo de experiencia del control de servidor. Nunca concede acceso por sí solo:
 * la capacidad se obtiene desde el endpoint contextual de la API.
 */
export function canRenderWorkspaceAction(
  capabilities: AccessCapabilitiesResponse,
  action: WorkspaceUiAction,
): boolean {
  switch (action) {
    case "view":
      return capabilities.canReadWorkspace;
    case "manage":
      return capabilities.canManageWorkspace;
    case "invite":
      return capabilities.canInviteMembers;
    case "create":
      return capabilities.canCreateWorkspace;
  }
}
