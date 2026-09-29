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
  EvaluationStandardResponse,
} from "@aether/contracts";

import { InstitutionalStandards } from "./InstitutionalStandards";

afterEach(cleanup);

const organizationId = "00000000-0000-4000-8000-000000000001";
const standardId = "00000000-0000-4000-8000-000000000002";
const ownerCapabilities: AccessCapabilitiesResponse = {
  accessLevels: ["READ", "CONTRIBUTE", "MANAGE", "ADMIN"],
  canReadOrganization: true,
  canManageOrganization: true,
  canCreateWorkspace: true,
  canReadWorkspace: true,
  canManageWorkspace: true,
  canInviteMembers: true,
};

it("publica una versión sin activarla y confirma su activación después", async () => {
  let published = false;
  let active = false;
  const standard: EvaluationStandardResponse = {
    id: standardId,
    organizationId,
    name: "Evaluación institucional",
    objective: null,
    boundaries: null,
    successCriteria: null,
    nextMilestone: null,
    version: 1,
    criteria: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        code: "C01",
        name: "Viabilidad",
        description: "Recursos suficientes",
        weight: 2,
        dimension: "Factibilidad",
        isExclusionary: true,
      },
    ],
    maturityLevels: [
      { code: "N01", name: "Preparada", minimumQualityPercentage: 75 },
    ],
    isActive: false,
    publishedAt: "2026-09-29T12:00:00.000Z",
    publishedByActorId: "owner",
  };
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("evaluation-standards?"))
      return new Response(
        JSON.stringify(published ? [{ ...standard, isActive: active }] : []),
      );
    if (url === "evaluation-standards" && init?.method === "POST") {
      published = true;
      return new Response(JSON.stringify(standard), { status: 201 });
    }
    if (url.endsWith("/activate") && init?.method === "POST") {
      active = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const onActivated = vi.fn();
  render(
    <InstitutionalStandards
      organizationId={organizationId}
      capabilities={ownerCapabilities}
      request={request}
      onActivated={onActivated}
    />,
  );

  await screen.findByText("Sin estándar activo");
  fireEvent.click(screen.getByRole("button", { name: "Nueva versión" }));
  fireEvent.change(screen.getByLabelText("Nombre del estándar"), {
    target: { value: standard.name },
  });
  fireEvent.change(screen.getByLabelText("Nombre", { exact: true }), {
    target: { value: "Viabilidad" },
  });
  fireEvent.change(screen.getByLabelText("Qué se evaluará"), {
    target: { value: "Recursos suficientes" },
  });
  fireEvent.change(screen.getByLabelText("Peso relativo"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Dimensión"), {
    target: { value: "Factibilidad" },
  });
  fireEvent.click(screen.getByLabelText("Obligatorio para aprobar"));
  fireEvent.click(screen.getByRole("button", { name: "Añadir nivel" }));
  fireEvent.change(screen.getAllByLabelText("Nombre", { exact: true })[1]!, {
    target: { value: "Preparada" },
  });
  fireEvent.change(screen.getByLabelText("Calidad mínima (%)"), {
    target: { value: "75" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Publicar versión" }));

  await waitFor(() => expect(published).toBe(true));
  const publishCall = request.mock.calls.find(
    ([url, init]) => url === "evaluation-standards" && init?.method === "POST",
  );
  expect(JSON.parse(publishCall?.[1]?.body as string)).toMatchObject({
    organizationId,
    name: standard.name,
    version: 1,
    criteria: [
      {
        code: "C01",
        name: "Viabilidad",
        description: "Recursos suficientes",
        weight: 2,
        dimension: "Factibilidad",
        isExclusionary: true,
      },
    ],
    maturityLevels: [
      { code: "N01", name: "Preparada", minimumQualityPercentage: 75 },
    ],
  });
  expect(onActivated).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByText("Ver criterios y niveles"));
  expect(screen.getByText("Viabilidad · Factibilidad")).toBeTruthy();
  expect(screen.getByText("Niveles: Preparada (desde 75 %)")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Activar" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  await waitFor(() => expect(onActivated).toHaveBeenCalledOnce());
  await screen.findByText(/Estándar activado/);
});

it("permite consultar las versiones sin ofrecer su edición a un administrador", async () => {
  const request = vi.fn(async () => new Response("[]"));
  render(
    <InstitutionalStandards
      organizationId={organizationId}
      capabilities={{
        ...ownerCapabilities,
        accessLevels: ["READ", "CONTRIBUTE", "MANAGE"],
      }}
      request={request}
      onActivated={vi.fn()}
    />,
  );
  await screen.findByText("Sin estándar activo");
  expect(screen.queryByRole("button", { name: "Nueva versión" })).toBeNull();
  expect(
    screen.getByText(/Solo la persona propietaria puede publicar/),
  ).toBeTruthy();
});

it("distingue un fallo de carga de la ausencia de un estándar activo", async () => {
  let unavailable = true;
  const request = vi.fn(async () => {
    if (unavailable) throw new Error("Servicio no disponible");
    return new Response("[]");
  });
  render(
    <InstitutionalStandards
      organizationId={organizationId}
      capabilities={ownerCapabilities}
      request={request}
      onActivated={vi.fn()}
    />,
  );

  await screen.findByText("Servicio no disponible");
  expect(screen.queryByText("Sin estándar activo")).toBeNull();
  unavailable = false;
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByText("Sin estándar activo");
});
