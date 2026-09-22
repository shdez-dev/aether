/// <reference lib="dom" />

import { createElement } from "react";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ProjectTasks } from "../app/project-tasks";

it("shows the same task in list, board and calendar and applies the status filter", async () => {
  const today = new Date();
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const dated = {
    id: "dated-task",
    description: "Preparar informe",
    workflowStatus: "in_progress",
    position: 0,
    ownerActorId: "owner",
    executorTeamId: null,
    reviewerActorId: null,
    blockedReason: "Esperando aprobación",
    unblockResponsibleActorId: "lead",
    dueOn: `${month}-15`,
    priority: "high",
  };
  const undated = {
    ...dated,
    id: "undated-task",
    description: "Revisar alcance",
    position: 1,
    dueOn: null,
    blockedReason: null,
    unblockResponsibleActorId: null,
  };
  const request = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("/calendar?")
            ? { dated: [dated], undated: [undated] }
            : [dated, undated],
        ),
        { status: 200 },
      ),
  );

  render(
    createElement(ProjectTasks, {
      projectId: "project",
      organizationId: "organization",
      refreshKey: 0,
      request,
    }),
  );
  expect(await screen.findByText("Preparar informe")).toBeTruthy();
  expect(screen.getByText(/Bloqueada: Esperando aprobación/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tablero" }));
  expect(
    within(screen.getByRole("region", { name: "En curso" })).getByText(
      "Preparar informe",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Calendario" }));
  expect(
    within(screen.getByRole("region", { name: `${month}-15` })).getByText(
      "Preparar informe",
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: /Sin fecha/ })).getByText(
      "Revisar alcance",
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Estado" }), {
    target: { value: "in_progress" },
  });
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("workflowStatus=in_progress"),
    ),
  );
});
