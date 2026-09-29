import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  OrganizationResponse,
  OrganizationRoleProfileResponse,
} from "@aether/contracts";

import { OrganizationRoleProfilePreview } from "./OrganizationRoleProfilePreview";

afterEach(cleanup);

type OrganizationKind = NonNullable<OrganizationResponse["organizationType"]>;
type Responsibility =
  OrganizationRoleProfileResponse["initiativeResponsibilities"][number];

function responsibility(
  key: Responsibility["key"],
  label: string,
  scope: Responsibility["scope"],
  implementationStatus: Responsibility["implementationStatus"],
): Responsibility {
  return {
    key,
    label,
    scope,
    description: "Descripción de " + label.toLocaleLowerCase("es-CL") + ".",
    implementationStatus,
  };
}

function profileFor(
  organizationType: OrganizationKind,
): OrganizationRoleProfileResponse {
  const businessRoles = [
    responsibility(
      "initiative_coordinator",
      "Coordinación de iniciativas",
      "initiative",
      "implemented",
    ),
    responsibility(
      "initiative_evaluator",
      "Evaluación de iniciativas",
      "initiative",
      "implemented",
    ),
  ];
  return {
    version: 1,
    organizationType,
    profileKey: organizationType,
    profileLabel:
      organizationType === "institutional"
        ? "Institución"
        : organizationType === "personal"
          ? "Trabajo personal"
          : "Equipo o empresa",
    organizationAccessRoles: [
      {
        key: "owner",
        label: "Propietario",
        scope: "organization",
        description: "Administra la organización.",
      },
      {
        key: "admin",
        label: "Administrador",
        scope: "organization",
        description: "Gestiona la organización.",
      },
      {
        key: "member",
        label: "Miembro",
        scope: "organization",
        description: "Pertenece a la organización.",
      },
    ],
    workspaceAccessRoles: [],
    initiativeResponsibilities:
      organizationType === "institutional"
        ? [
            ...businessRoles,
            responsibility(
              "initiative_approver",
              "Aprobación de iniciativas",
              "initiative",
              "implemented",
            ),
            responsibility(
              "initiative_mentor",
              "Mentoría",
              "initiative",
              "implemented",
            ),
          ]
        : organizationType === "business"
          ? businessRoles
          : [],
    projectResponsibilities: [
      responsibility(
        "project_sponsor",
        "Patrocinador del proyecto",
        "project",
        "implemented",
      ),
    ],
  };
}

it("loads the selected type profile and refreshes it when the type changes", async () => {
  const request = vi.fn(async (url: string) => {
    const kind = url.split("/").at(-1) as OrganizationKind;
    return new Response(JSON.stringify(profileFor(kind)));
  });
  const { rerender } = render(
    <OrganizationRoleProfilePreview
      organizationType="business"
      request={request}
    />,
  );

  expect(await screen.findByText("Coordinación de iniciativas")).toBeTruthy();
  expect(screen.queryByText("Mentoría")).toBeNull();
  expect(request).toHaveBeenCalledWith("organization-role-profiles/business");

  rerender(
    <OrganizationRoleProfilePreview
      organizationType="institutional"
      request={request}
    />,
  );

  expect(await screen.findByText("Mentoría")).toBeTruthy();
  expect(screen.getAllByText("Disponible").length).toBeGreaterThan(0);
  expect(screen.getByText("Responsabilidades disponibles")).toBeTruthy();
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "organization-role-profiles/institutional",
    ),
  );
});
