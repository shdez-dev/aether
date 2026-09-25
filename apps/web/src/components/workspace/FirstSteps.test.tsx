import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { FirstSteps } from "./FirstSteps";

afterEach(cleanup);

it("permite crear una organización con la política requerida", async () => {
  const request = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response("{}", { status: 201 }),
  );
  const onOrganizationReady = vi.fn(async () => {});
  render(
    <FirstSteps
      organization={null}
      request={request}
      onOrganizationReady={onOrganizationReady}
      onWorkspaceReady={vi.fn()}
      onLogout={vi.fn(async () => {})}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /^Crear organización/ }));
  fireEvent.change(await screen.findByLabelText("Nombre de la organización"), {
    target: { value: "Equipo Aurora" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Crear organización$/ }));

  await waitFor(() => expect(onOrganizationReady).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledWith(
    "organizations",
    expect.objectContaining({
      method: "POST",
      body: expect.any(String),
    }),
  );
  const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
  expect(body).toMatchObject({
    name: "Equipo Aurora",
    organizationType: "business",
    policy: { dataResidencyRegion: "local", retentionDays: 365 },
  });
});

it("acepta una invitación sin conceder acceso sólo por tener cuenta", async () => {
  const request = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ organizationId: "new-organization" }), {
        status: 200,
      }),
  );
  const onOrganizationReady = vi.fn(async () => {});
  render(
    <FirstSteps
      organization={null}
      request={request}
      onOrganizationReady={onOrganizationReady}
      onWorkspaceReady={vi.fn()}
      onLogout={vi.fn(async () => {})}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: /^Unirme con invitación/ }),
  );
  fireEvent.change(await screen.findByLabelText("Código de invitación"), {
    target: { value: "valid-invitation-token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Aceptar invitación" }));

  await waitFor(() => expect(onOrganizationReady).toHaveBeenCalledOnce());
  expect(onOrganizationReady).toHaveBeenCalledWith("new-organization");
  expect(request).toHaveBeenCalledWith("invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token: "valid-invitation-token" }),
  });
});

it("reemplaza las opciones por el flujo elegido y permite volver", async () => {
  render(
    <FirstSteps
      organization={null}
      request={vi.fn()}
      onOrganizationReady={vi.fn(async () => {})}
      onWorkspaceReady={vi.fn()}
      onLogout={vi.fn(async () => {})}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: /^Unirme con invitación/ }),
  );

  expect(await screen.findByLabelText("Código de invitación")).toBeTruthy();
  await waitFor(() => {
    expect(
      screen.queryByRole("button", { name: /^Crear organización/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Unirme con invitación/ }),
    ).toBeNull();
  });

  fireEvent.click(
    screen.getByRole("button", { name: "Volver a las opciones" }),
  );

  expect(
    await screen.findByRole("button", { name: /^Crear organización/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /^Unirme con invitación/ }),
  ).toBeTruthy();
  await waitFor(() => {
    expect(screen.queryByLabelText("Código de invitación")).toBeNull();
  });
});
