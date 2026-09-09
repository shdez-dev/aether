import { describe, expect, it } from "vitest";

import {
  EvaluationDomainError,
  decideInitiative,
  evaluateInitiative,
  publishEvaluationStandard,
} from "./evaluation.js";
import { createInitiative, transitionInitiative } from "./initiative.js";

const now = new Date("2026-09-10T10:00:00.000Z");
const standard = publishEvaluationStandard({
  id: "00000000-0000-4000-8000-000000000010",
  organizationId: "00000000-0000-4000-8000-000000000011",
  name: "Estándar de impacto",
  version: 2,
  criteria: [
    {
      id: "00000000-0000-4000-8000-000000000012",
      code: "IMPACT",
      name: "Impacto",
      description: "Demuestra impacto.",
      weight: 1,
    },
  ],
  publishedAt: now,
  publishedByActorId: "owner",
});

describe("Evaluation and decision", () => {
  it("fija estándar y cobertura en la evaluación y bloquea decisiones incompletas", () => {
    const incomplete = evaluateInitiative({
      id: "00000000-0000-4000-8000-000000000013",
      organizationId: standard.organizationId,
      workspaceId: "00000000-0000-4000-8000-000000000014",
      initiativeId: "00000000-0000-4000-8000-000000000015",
      initiativeVersion: 4,
      standard,
      results: [],
      evaluatedByActorId: "reviewer",
      evaluatedAt: now,
    });
    expect(incomplete.coverage).toEqual({
      totalCriteria: 1,
      assessedCriteria: 0,
      percentage: 0,
    });
    expect(() =>
      decideInitiative({
        id: "00000000-0000-4000-8000-000000000016",
        organizationId: standard.organizationId,
        workspaceId: incomplete.workspaceId,
        initiativeId: incomplete.initiativeId,
        evaluationId: incomplete.id,
        outcome: "approved",
        rationale: "No aplica",
        evidence: [],
        decidedByActorId: "owner",
        decidedAt: now,
        evaluation: incomplete,
      }),
    ).toThrow(EvaluationDomainError);
  });

  it("permite devolución y cancelación como transiciones explícitas", () => {
    const initiative = createInitiative({
      id: "00000000-0000-4000-8000-000000000020",
      organizationId: standard.organizationId,
      workspaceId: "00000000-0000-4000-8000-000000000021",
      createdByActorId: "author",
      title: "Iniciativa",
      problemStatement: "Problema",
      expectedOutcome: "Resultado",
      classification: "internal",
      createdAt: now,
      updatedAt: now,
    });
    const reviewing = transitionInitiative(
      transitionInitiative(initiative, "presented", now),
      "under_review",
      now,
    );
    expect(transitionInitiative(reviewing, "returned", now).status).toBe(
      "returned",
    );
    expect(transitionInitiative(reviewing, "cancelled", now).status).toBe(
      "cancelled",
    );
  });
});
