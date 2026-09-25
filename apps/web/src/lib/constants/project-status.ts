import type { ProjectResponse } from "@aether/contracts";

const labels: Record<ProjectResponse["status"], string> = {
  pending_lead: "Sin líder asignado",
  planned: "Planificado",
  active: "En curso",
  paused: "En pausa",
  blocked: "Bloqueado",
  completed: "Completado",
  cancelled: "Cancelado",
  archived: "Archivado",
};

export function projectStatusLabel(status: ProjectResponse["status"]) {
  return labels[status];
}
