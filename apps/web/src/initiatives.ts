import type { InitiativeResponse } from "@aether/contracts";

const statusLabels: Record<InitiativeResponse["status"], string> = {
  draft: "Borrador",
  presented: "Por revisar",
  under_review: "Por decidir",
  approved: "Aprobada",
  rejected: "Rechazada",
  returned: "Devuelta",
  cancelled: "Cancelada",
};

export function initiativeStatusLabel(
  status: InitiativeResponse["status"],
): string {
  return statusLabels[status];
}

export function canRenderInitiativeAction(
  initiative: InitiativeResponse,
  action: InitiativeResponse["allowedActions"][number],
): boolean {
  return initiative.allowedActions.includes(action);
}
