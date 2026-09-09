import { describe, expect, it } from "vitest";

import {
  InitiativeDomainError,
  createInitiative,
  editInitiative,
  transitionInitiative,
} from "./initiative.js";

const createdAt = new Date("2026-09-09T10:00:00.000Z");
const draft = createInitiative({
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  createdByActorId: "actor-a",
  title: "Iniciativa",
  problemStatement: "Problema",
  expectedOutcome: "Resultado",
  classification: "internal",
  createdAt,
  updatedAt: createdAt,
});

describe("Initiative aggregate", () => {
  it("permite sólo el ciclo explícito y bloquea edición fuera de draft", () => {
    const presented = transitionInitiative(
      draft,
      "presented",
      new Date("2026-09-09T10:01:00.000Z"),
    );
    const reviewing = transitionInitiative(
      presented,
      "under_review",
      new Date("2026-09-09T10:02:00.000Z"),
    );
    expect(
      transitionInitiative(
        reviewing,
        "approved",
        new Date("2026-09-09T10:03:00.000Z"),
      ).status,
    ).toBe("approved");
    expect(() => transitionInitiative(draft, "approved", createdAt)).toThrow(
      InitiativeDomainError,
    );
    expect(() =>
      editInitiative(
        presented,
        {
          title: "x",
          problemStatement: "y",
          expectedOutcome: "z",
          classification: "internal",
        },
        createdAt,
      ),
    ).toThrow(InitiativeDomainError);
  });
});
