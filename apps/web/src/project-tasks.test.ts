/// <reference lib="dom" />

import { createElement } from "react";

import {
  fireEvent,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ProjectTasks } from "../app/project-tasks";

afterEach(cleanup);

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
    version: 3,
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

it("reviews date impact before sending the versioned confirmation", async () => {
  const task = {
    id: "task-id",
    description: "Cerrar informe",
    workflowStatus: "in_progress",
    position: 0,
    ownerActorId: "owner",
    executorTeamId: null,
    reviewerActorId: null,
    blockedReason: null,
    unblockResponsibleActorId: null,
    dueOn: "2026-09-15",
    priority: "medium",
    version: 7,
  };
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/date-impact?"))
      return new Response(
        JSON.stringify({
          actionId: task.id,
          expectedVersion: task.version,
          currentDueOn: task.dueOn,
          proposedDueOn: "2026-09-25",
          predecessors: [{ actionId: "predecessor", dueOn: "2026-09-20" }],
          successors: [],
          pendingMilestones: [
            { id: "milestone", title: "Entrega", dueOn: "2026-09-30" },
          ],
          impactToken: "a".repeat(64),
        }),
      );
    if (init?.method === "POST")
      return new Response(
        JSON.stringify({ ...task, dueOn: "2026-09-25", version: 8 }),
      );
    return new Response(
      JSON.stringify(
        url.includes("/calendar?") ? { dated: [task], undated: [] } : [task],
      ),
    );
  });
  render(
    createElement(ProjectTasks, {
      projectId: "project",
      organizationId: "organization",
      refreshKey: 0,
      request,
    }),
  );

  fireEvent.click(await screen.findByRole("button", { name: "Cambiar fecha" }));
  expect(
    screen.queryByRole("button", { name: "Confirmar cambio de fecha" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText(/Nueva fecha/), {
    target: { value: "2026-09-25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar impacto" }));
  expect(await screen.findByText(/predecessor/)).toBeTruthy();
  expect(request).toHaveBeenCalledWith(
    expect.stringContaining("expectedVersion=7&proposedDueOn=2026-09-25"),
  );
  expect(screen.getByText(/Entrega/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar cambio de fecha" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "projects/project/next-actions/task-id/date",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          organizationId: "organization",
          expectedVersion: 7,
          proposedDueOn: "2026-09-25",
          impactToken: "a".repeat(64),
        }),
      }),
    ),
  );
});

it("claims an unassigned team task before starting it with an explicit block", async () => {
  let task = {
    id: "team-task",
    description: "Preparar entrega",
    workflowStatus: "to_do",
    position: 1,
    ownerActorId: null as string | null,
    executorTeamId: "team-id",
    reviewerActorId: null,
    blockedReason: null as string | null,
    unblockResponsibleActorId: null as string | null,
    dueOn: null,
    priority: "high",
    version: 2,
  };
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/claim") && init?.method === "POST") {
      task = { ...task, ownerActorId: "actor", version: 3 };
      return new Response(JSON.stringify(task));
    }
    if (url.endsWith("/workflow") && init?.method === "POST") {
      task = {
        ...task,
        workflowStatus: "in_progress",
        blockedReason: "Esperar insumo",
        unblockResponsibleActorId: "lead",
        version: 4,
      };
      return new Response(JSON.stringify(task));
    }
    return new Response(
      JSON.stringify(
        url.includes("/calendar?") ? { dated: [], undated: [task] } : [task],
      ),
    );
  });
  render(
    createElement(ProjectTasks, {
      projectId: "project",
      organizationId: "organization",
      refreshKey: 0,
      request,
    }),
  );

  fireEvent.click(
    await screen.findByRole("button", { name: "Gestionar tarea" }),
  );
  const editor = screen.getByRole("region", { name: "Gestionar tarea" });
  expect(
    within(editor)
      .getByRole("option", { name: "En curso" })
      .getAttribute("disabled"),
  ).not.toBeNull();
  fireEvent.click(
    within(editor).getByRole("button", { name: "Tomar tarea del equipo" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "projects/project/next-actions/team-task/claim",
      expect.objectContaining({
        body: JSON.stringify({
          organizationId: "organization",
          expectedVersion: 2,
        }),
      }),
    ),
  );
  await waitFor(() => expect(screen.getByText(/actor/)).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "Gestionar tarea" }));
  const nextEditor = screen.getByRole("region", { name: "Gestionar tarea" });
  fireEvent.change(within(nextEditor).getByLabelText("Estado"), {
    target: { value: "in_progress" },
  });
  fireEvent.change(within(nextEditor).getByLabelText(/Motivo de bloqueo/), {
    target: { value: "Esperar insumo" },
  });
  fireEvent.change(
    within(nextEditor).getByLabelText(/Responsable de desbloqueo/),
    { target: { value: "lead" } },
  );
  fireEvent.click(
    within(nextEditor).getByRole("button", { name: "Guardar flujo" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "projects/project/next-actions/team-task/workflow",
      expect.objectContaining({
        body: JSON.stringify({
          organizationId: "organization",
          expectedVersion: 3,
          status: "in_progress",
          blockedReason: "Esperar insumo",
          unblockResponsibleActorId: "lead",
        }),
      }),
    ),
  );
});
