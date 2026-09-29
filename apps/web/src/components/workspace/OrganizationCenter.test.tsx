import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  AccessCapabilitiesResponse,
  OrganizationResponse,
  OrganizationResponsibilitiesResponse,
  WorkspaceResponse,
} from "@aether/contracts";

import { OrganizationCenter } from "./OrganizationCenter";

afterEach(cleanup);

const organization: OrganizationResponse = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Equipo",
  organizationType: "business",
  timezone: "America/Santiago",
  locale: "es-CL",
  version: 0,
};
const workspaces: WorkspaceResponse[] = [
  {
    id: "00000000-0000-4000-8000-000000000002",
    organizationId: organization.id,
    name: "Producto",
    mode: "team",
    version: 0,
    status: "active",
    archivedAt: null,
    archivedByActorId: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    organizationId: organization.id,
    name: "Estrategia",
    mode: "team",
    version: 0,
    status: "active",
    archivedAt: null,
    archivedByActorId: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    organizationId: organization.id,
    name: "Archivo",
    mode: "team",
    version: 1,
    status: "archived",
    archivedAt: "2026-09-28T12:00:00.000Z",
    archivedByActorId: "owner",
  },
];
const capabilities: AccessCapabilitiesResponse = {
  accessLevels: ["READ", "CONTRIBUTE", "MANAGE", "ADMIN"],
  canReadOrganization: true,
  canManageOrganization: true,
  canCreateWorkspace: true,
  canReadWorkspace: true,
  canManageWorkspace: true,
  canInviteMembers: true,
};

it("invita con rol organizacional y acceso explícito a los espacios elegidos", async () => {
  const assignments: OrganizationResponsibilitiesResponse["assignments"][number][] =
    [];
  const members: OrganizationResponsibilitiesResponse["members"] = [
    {
      actorId: "member-1",
      actorName: "Ada Lovelace",
      actorEmail: "ada@example.test",
      organizationRole: "member",
      workspaceRole: "member",
    },
  ];
  const request = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.startsWith("evaluation-standards?")) return new Response("[]");
    if (url.endsWith("/role-profile"))
      return new Response(
        JSON.stringify({
          version: 1,
          organizationType: "business",
          profileKey: "business",
          profileLabel: "Equipo o empresa",
          organizationAccessRoles: [],
          workspaceAccessRoles: [],
          initiativeResponsibilities: [
            {
              key: "initiative_coordinator",
              label: "Coordinación de iniciativas",
              scope: "initiative",
              description: "Organiza el ingreso de propuestas.",
              implementationStatus: "implemented",
            },
            {
              key: "initiative_evaluator",
              label: "Evaluación de iniciativas",
              scope: "initiative",
              description: "Evalúa propuestas asignadas.",
              implementationStatus: "implemented",
            },
          ],
          projectResponsibilities: [],
        }),
      );
    if (url.includes("/responsibilities?") && _init?.method !== "POST")
      return new Response(
        JSON.stringify({ members, initiatives: [], assignments }),
      );
    if (url.endsWith("/responsibilities") && _init?.method === "POST") {
      const body = JSON.parse(_init.body as string) as {
        actorId: string;
        roleKey: "initiative_coordinator" | "initiative_evaluator";
        workspaceId: string;
      };
      const member = members.find((item) => item.actorId === body.actorId)!;
      const workspace = workspaces.find(
        (item) => item.id === body.workspaceId,
      )!;
      assignments.push({
        id: "00000000-0000-4000-8000-000000000009",
        organizationId: organization.id,
        workspaceId: body.workspaceId,
        workspaceName: workspace.name,
        actorId: body.actorId,
        actorName: member.actorName,
        actorEmail: member.actorEmail,
        roleKey: body.roleKey,
        initiativeId: null,
        initiativeTitle: null,
        validUntil: null,
        assignedByActorId: "owner",
        assignedAt: "2026-09-29T12:00:00.000Z",
      });
      return new Response(JSON.stringify(assignments[0]), { status: 201 });
    }
    if (url.endsWith("/policy"))
      return new Response(
        JSON.stringify({
          organizationPolicy: {
            dataResidencyRegion: "local",
            retentionDays: 365,
          },
        }),
      );
    if (url.endsWith("/invitations"))
      return new Response("{}", { status: 201 });
    throw new Error(`Unexpected request: ${url}`);
  });
  render(
    <OrganizationCenter
      organization={organization}
      workspaces={workspaces}
      workspaceId={workspaces[0]!.id}
      capabilities={capabilities}
      request={request}
      onSelectWorkspace={vi.fn()}
      onWorkspaceCreated={vi.fn()}
      onStandardsActivated={vi.fn()}
      section="overview"
      onSectionChange={vi.fn()}
    />,
  );

  await screen.findByText("Responsabilidades de iniciativas");
  expect(screen.queryByLabelText("Región de datos")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Política/ }));
  await screen.findByText("Región de datos");
  expect(screen.queryByText("Responsabilidades de iniciativas")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Espacios/ }));
  await screen.findByRole("heading", { name: "Espacios de trabajo" });
  expect(screen.queryByText("Región de datos")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Usuarios/ }));
  await screen.findByText("Responsabilidades de iniciativas");

  fireEvent.click(screen.getByRole("combobox", { name: "Persona" }));
  fireEvent.click(screen.getByRole("option", { name: /Ada Lovelace/ }));
  fireEvent.click(screen.getByRole("button", { name: "Asignar rol" }));
  await screen.findByText("Ada Lovelace");
  const responsibilityCall = request.mock.calls.find(
    ([url, init]) =>
      url.endsWith("/responsibilities") && init?.method === "POST",
  );
  expect(JSON.parse(responsibilityCall?.[1]?.body as string)).toEqual({
    workspaceId: workspaces[0]!.id,
    actorId: "member-1",
    roleKey: "initiative_coordinator",
  });

  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "persona@example.test" },
  });
  expect(screen.queryByRole("checkbox", { name: "Archivo" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Estrategia" }));
  fireEvent.click(
    screen.getByRole("combobox", { name: "Rol en los espacios elegidos" }),
  );
  fireEvent.click(screen.getByRole("option", { name: /Lector/ }));
  expect(screen.getByText(/actuará como lector/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Crear invitación" }));

  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      `organizations/${organization.id}/invitations`,
      expect.anything(),
    ),
  );
  const inviteCall = request.mock.calls.find(([url]) =>
    url.endsWith("/invitations"),
  );
  expect(JSON.parse(inviteCall?.[1]?.body as string)).toMatchObject({
    email: "persona@example.test",
    organizationRole: "member",
    workspaceIds: [workspaces[0]!.id, workspaces[1]!.id],
    workspaceRole: "viewer",
  });

  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "admin@example.test" },
  });
  fireEvent.click(
    screen.getByRole("combobox", { name: "Rol en la organización" }),
  );
  fireEvent.click(screen.getByRole("option", { name: /Administrador/ }));
  fireEvent.click(screen.getByRole("button", { name: "Crear invitación" }));
  await waitFor(() =>
    expect(
      request.mock.calls.filter(([url]) => url.endsWith("/invitations")),
    ).toHaveLength(2),
  );
  const adminInvite = request.mock.calls.filter(([url]) =>
    url.endsWith("/invitations"),
  )[1];
  expect(JSON.parse(adminInvite?.[1]?.body as string)).toMatchObject({
    email: "admin@example.test",
    organizationRole: "admin",
  });
}, 15_000);
