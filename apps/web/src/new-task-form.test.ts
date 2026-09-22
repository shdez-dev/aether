/// <reference lib="dom" />

import { createElement } from "react";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { NewTaskForm } from "../app/new-task-form";

afterEach(cleanup);

it("creates a team inbox task with paired estimation and period fields", async () => {
  const request = vi.fn(
    async (url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? { id: "task" }
            : [
                {
                  id: "team-id",
                  organizationId: "organization",
                  workspaceId: "workspace",
                  name: "Equipo Uno",
                  version: 1,
                  memberActorIds: [],
                },
              ],
        ),
      ),
  );
  const onCreated = vi.fn();
  render(
    createElement(NewTaskForm, {
      projectId: "project",
      organizationId: "organization",
      workspaceId: "workspace",
      actorId: "actor",
      request,
      onCreated,
      readOnly: false,
    }),
  );

  expect(
    await screen.findByRole("option", { name: "Equipo Uno" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Descripción"), {
    target: { value: "Preparar dossier" },
  });
  fireEvent.change(screen.getByLabelText("Equipo ejecutor"), {
    target: { value: "team-id" },
  });
  fireEvent.change(screen.getByLabelText("Responsable"), {
    target: { value: "team" },
  });
  fireEvent.change(screen.getByLabelText(/Revisor/), {
    target: { value: "reviewer" },
  });
  fireEvent.change(screen.getByLabelText(/Estimación/), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByLabelText("Unidad de estimación"), {
    target: { value: "days" },
  });
  fireEvent.change(screen.getByLabelText(/Inicio del período/), {
    target: { value: "2026-09-24" },
  });
  expect(
    screen
      .getByRole("button", { name: "Añadir tarea" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText(/Fin del período/), {
    target: { value: "2026-09-26" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Añadir tarea" }));

  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  const post = request.mock.calls.find(([, init]) => init?.method === "POST");
  expect(post?.[0]).toBe("projects/project/next-actions");
  expect(JSON.parse(post?.[1]?.body as string)).toMatchObject({
    organizationId: "organization",
    description: "Preparar dossier",
    ownerActorId: null,
    executorTeamId: "team-id",
    reviewerActorId: "reviewer",
    estimatedEffort: 3,
    effortUnit: "days",
    periodStartOn: "2026-09-24",
    periodEndOn: "2026-09-26",
  });
});

it("requires a team before leaving a task unassigned", async () => {
  const request = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response("[]"),
  );
  render(
    createElement(NewTaskForm, {
      projectId: "project",
      organizationId: "organization",
      workspaceId: "workspace",
      actorId: "actor",
      request,
      onCreated: vi.fn(),
      readOnly: false,
    }),
  );
  fireEvent.change(screen.getByLabelText("Descripción"), {
    target: { value: "Trabajo" },
  });
  fireEvent.change(screen.getByLabelText("Responsable"), {
    target: { value: "team" },
  });
  expect(screen.getByText(/Elige un equipo/)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Añadir tarea" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(request.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(
    true,
  );
});
