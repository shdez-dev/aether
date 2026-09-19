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
      applicableCriteria: 1,
      assessedCriteria: 0,
      notApplicableCriteria: 0,
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

  it("nunca informa 100 % cuando un estándar sin criterios llega desde datos heredados", () => {
    const evaluation = evaluateInitiative({
      id: "00000000-0000-4000-8000-000000000017",
      organizationId: standard.organizationId,
      workspaceId: "00000000-0000-4000-8000-000000000014",
      initiativeId: "00000000-0000-4000-8000-000000000015",
      initiativeVersion: 4,
      standard: { ...standard, criteria: [] },
      results: [],
      evaluatedByActorId: "reviewer",
      evaluatedAt: now,
    });

    expect(evaluation.coverage).toEqual({
      totalCriteria: 0,
      applicableCriteria: 0,
      assessedCriteria: 0,
      notApplicableCriteria: 0,
      percentage: 0,
    });
    expect(() =>
      decideInitiative({
        id: "00000000-0000-4000-8000-000000000018",
        organizationId: standard.organizationId,
        workspaceId: evaluation.workspaceId,
        initiativeId: evaluation.initiativeId,
        evaluationId: evaluation.id,
        outcome: "approved",
        rationale: "No debe decidirse sin cobertura.",
        evidence: [],
        decidedByActorId: "owner",
        decidedAt: now,
        evaluation,
      }),
    ).toThrow(EvaluationDomainError);
  });

  it("separa los criterios no aplicables del denominador de cobertura", () => {
    const evaluation = evaluateInitiative({
      id: "00000000-0000-4000-8000-000000000019",
      organizationId: standard.organizationId,
      workspaceId: "00000000-0000-4000-8000-000000000014",
      initiativeId: "00000000-0000-4000-8000-000000000015",
      initiativeVersion: 4,
      standard: {
        ...standard,
        criteria: [
          standard.criteria[0]!,
          {
            ...standard.criteria[0]!,
            id: "00000000-0000-4000-8000-000000000020",
            code: "CONTEXT",
          },
        ],
      },
      results: [
        {
          criterionId: standard.criteria[0]!.id,
          assessment: "met",
          evidence: ["Evidencia"],
        },
        {
          criterionId: "00000000-0000-4000-8000-000000000020",
          assessment: "not_applicable",
          evidence: ["No aplica al contexto"],
        },
      ],
      evaluatedByActorId: "reviewer",
      evaluatedAt: now,
    });

    expect(evaluation.coverage).toEqual({
      totalCriteria: 2,
      applicableCriteria: 1,
      assessedCriteria: 1,
      notApplicableCriteria: 1,
      percentage: 100,
    });
    expect(evaluation.quality).toEqual({
      applicableWeight: 1,
      assessedWeight: 1,
      metWeight: 1,
      percentage: 100,
    });
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
