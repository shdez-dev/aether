import { describe, expect, it } from "vitest";

import {
  InitiativeDomainError,
  createInitiative,
  editInitiative,
  findPotentialInitiativeDuplicates,
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
  requestedPriority: "medium",
  operationalPriority: null,
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

  it("advierte coincidencias normalizadas dentro del workspace sin fusionarlas", () => {
    const sameContent = {
      ...draft,
      id: "00000000-0000-4000-8000-000000000010",
      title: "  INICIATIVA ",
      problemStatement: "PROBLÉMA",
      createdAt: new Date("2026-09-09T09:00:00.000Z"),
    };
    const otherWorkspace = {
      ...sameContent,
      id: "00000000-0000-4000-8000-000000000011",
      workspaceId: "00000000-0000-4000-8000-000000000099",
    };
    expect(
      findPotentialInitiativeDuplicates({
        reference: draft,
        candidates: [sameContent, otherWorkspace],
      }),
    ).toEqual([
      {
        initiativeId: sameContent.id,
        title: sameContent.title,
        createdAt: sameContent.createdAt,
        matchedFields: ["title", "problem_statement"],
      },
    ]);
  });
});
