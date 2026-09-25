/// <reference lib="dom" />

import { createElement } from "react";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { MyWork } from "./components/workspace/my-work";

afterEach(cleanup);

it("shows one card per contextual task with all its roles and opens its project", async () => {
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify([
          {
            action: {
              id: "task-a",
              projectId: "project-a",
              description: "Preparar entrega",
              workflowStatus: "in_progress",
              dueOn: "2026-09-30",
              blockedReason: "Esperando validación",
              position: 1,
            },
            kinds: ["owned", "unblock"],
          },
          {
            action: {
              id: "task-b",
              projectId: "project-b",
              description: "Revisar alcance",
              workflowStatus: "to_do",
              dueOn: null,
              blockedReason: null,
              position: 2,
            },
            kinds: ["team_inbox"],
          },
        ]),
      ),
  );
  const onOpenProject = vi.fn(async () => {});
  render(
    createElement(MyWork, {
      organizationId: "organization",
      refreshKey: 0,
      request,
      onOpenProject,
    }),
  );

  expect(await screen.findByText("Preparar entrega")).toBeTruthy();
  expect(request).toHaveBeenCalledWith("organizations/organization/my-work");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  const first = screen.getByText("Preparar entrega").closest("li");
  expect(first?.getAttribute("data-task-id")).toBe("task-a");
  expect(within(first!).getByText("Responsable")).toBeTruthy();
  expect(within(first!).getByText("Desbloqueo")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Relación"), {
    target: { value: "unblock" },
  });
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Abrir proyecto" }));
  await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("project-a"));
});

it("drops stale work after project access is rejected", async () => {
  let calls = 0;
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          ++calls === 1
            ? [
                {
                  action: {
                    id: "task-a",
                    projectId: "project-a",
                    description: "Trabajo restringido",
                    workflowStatus: "to_do",
                    dueOn: null,
                    blockedReason: null,
                    position: 1,
                  },
                  kinds: ["owned"],
                },
              ]
            : [],
        ),
      ),
  );
  render(
    createElement(MyWork, {
      organizationId: "organization",
      refreshKey: 0,
      request,
      onOpenProject: async () => {
        throw new Error("Acceso revocado");
      },
    }),
  );
  expect(await screen.findByText("Trabajo restringido")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Abrir proyecto" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Acceso revocado",
  );
  await waitFor(() =>
    expect(screen.queryByText("Trabajo restringido")).toBeNull(),
  );
  expect(request).toHaveBeenCalledTimes(2);
});
