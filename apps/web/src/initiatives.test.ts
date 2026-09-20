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
      title: "Iniciativa",
      problemStatement: "Problema",
      expectedOutcome: "Resultado",
      classification: "internal" as const,
      requestedPriority: "medium" as const,
      operationalPriority: null,
      status: "draft",
      version: 0,
      createdAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
      allowedActions: ["edit", "present"],
      duplicateWarnings: [],
    };
    expect(initiativeStatusLabel(initiative.status)).toBe("Borrador");
    expect(canRenderInitiativeAction(initiative, "present")).toBe(true);
    expect(canRenderInitiativeAction(initiative, "decide")).toBe(false);
  });
});
