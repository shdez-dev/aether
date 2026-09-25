import type { InitiativeResponse, ProjectResponse } from "@aether/contracts";

export type WorkspacePhaseId =
  "initiative" | "diagnosis" | "evaluation" | "decision" | "project" | "tasks";

export type WorkspacePhase = {
  id: WorkspacePhaseId;
  index: number;
  label: string;
  count: number;
  tone: "action" | "neutral" | "evaluation" | "attention" | "progress";
};

export function initiativePhase(
  status: InitiativeResponse["status"],
): WorkspacePhaseId {
  if (status === "draft") return "initiative";
  if (status === "presented") return "diagnosis";
  if (status === "under_review") return "evaluation";
  return "decision";
}

export function buildWorkspacePhases(
  initiatives: InitiativeResponse[],
  projects: ProjectResponse[],
  taskCount: number,
): WorkspacePhase[] {
  const countInitiatives = (...statuses: InitiativeResponse["status"][]) =>
    initiatives.filter((initiative) => statuses.includes(initiative.status))
      .length;

  return [
    {
      id: "initiative",
      index: 1,
      label: "Iniciativa",
      count: countInitiatives("draft"),
      tone: "action",
    },
    {
      id: "diagnosis",
      index: 2,
      label: "Diagnóstico",
      count: countInitiatives("presented"),
      tone: "neutral",
    },
    {
      id: "evaluation",
      index: 3,
      label: "Evaluación",
      count: countInitiatives("under_review"),
      tone: "evaluation",
    },
    {
      id: "decision",
      index: 4,
      label: "Decisión",
      count: countInitiatives("approved", "rejected", "returned", "cancelled"),
      tone: "attention",
    },
    {
      id: "project",
      index: 5,
      label: "Proyecto",
      count: projects.filter(
        (project) => !["cancelled", "archived"].includes(project.status),
      ).length,
      tone: "progress",
    },
    {
      id: "tasks",
      index: 6,
      label: "Tareas",
      count: taskCount,
      tone: "action",
    },
  ];
}
