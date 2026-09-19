import type {
  CreateInitiativeDraftRequest,
  CreateOrganizationRequest,
  CreateWorkspaceRequest,
} from "@aether/contracts";

import { nextTestId } from "./ids.js";

export function organizationBuilder(
  overrides: Partial<CreateOrganizationRequest> = {},
): CreateOrganizationRequest {
  return {
    name: "Organización de prueba",
    organizationType: "institutional",
    timezone: "America/Santiago",
    locale: "es-CL",
    policy: {
      dataResidencyRegion: "cl",
      retentionDays: 365,
    },
    ...overrides,
  };
}

export function workspaceBuilder(
  overrides: Partial<CreateWorkspaceRequest> = {},
): CreateWorkspaceRequest {
  return {
    organizationId: nextTestId(),
    name: "Workspace de prueba",
    mode: "institutional",
    ...overrides,
  };
}

export function initiativeDraftBuilder(
  overrides: Partial<CreateInitiativeDraftRequest> = {},
): CreateInitiativeDraftRequest {
  return {
    organizationId: nextTestId(),
    workspaceId: nextTestId(),
    title: "Reducir tiempo de espera",
    problemStatement: "Las personas esperan demasiado para recibir atención.",
    expectedOutcome:
      "Reducir el tiempo mediano de espera en un piloto verificable.",
    classification: "internal",
    requestedPriority: "medium",
    ...overrides,
  };
}
