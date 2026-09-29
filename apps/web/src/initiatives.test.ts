import { describe, expect, it } from "vitest";
import type { InitiativeResponse } from "@aether/contracts";

import {
  canRenderInitiativeAction,
  initiativeStatusLabel,
} from "./initiatives.js";

describe("initiative UI", () => {
  it("visualiza el estado y sólo habilita acciones devueltas por la API", () => {
    const initiative: InitiativeResponse = {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      workspaceId: "00000000-0000-4000-8000-000000000003",
      createdByActorId: "author",
      title: "Iniciativa",
      problemStatement: "Problema",
      expectedOutcome: "Resultado",
      proposalDetails: {
        summary: "Resumen",
        impactedPeople: "Personas usuarias",
        impactedCount: 20,
        problemImpact: "Impacto identificado",
        solution: "Solución",
        differentiation: "Diferenciación",
        projectStage: "idea",
        stageRationale: "La idea está en validación inicial.",
        pilotPlan: "Plan de pilotaje",
        pilotResources: "Recursos necesarios",
      },
      classification: "internal" as const,
      requestedPriority: "medium" as const,
      operationalPriority: null,
      intakeAssignment: null,
      status: "draft",
      version: 0,
      createdAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
      allowedActions: ["edit", "present"],
      duplicateWarnings: [],
    };
    expect(initiativeStatusLabel(initiative.status)).toBe("Borrador");
    expect(initiativeStatusLabel("presented")).toBe("Por revisar");
    expect(initiativeStatusLabel("under_review")).toBe("Por decidir");
    expect(canRenderInitiativeAction(initiative, "present")).toBe(true);
    expect(canRenderInitiativeAction(initiative, "decide")).toBe(false);
  });
});
