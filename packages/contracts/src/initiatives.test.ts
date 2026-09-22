import { describe, expect, it } from "vitest";

import {
  AddProjectNextActionRequestSchema,
  CloseProjectRequestSchema,
} from "./initiatives.js";
import {
  CapacityBalanceQuerySchema,
  DeclareCapacityAvailabilityRequestSchema,
} from "./capacity.js";

const action = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  description: "Preparar el piloto operativo.",
  ownerActorId: "owner",
  dueOn: "2026-10-02",
  priority: "high",
  estimatedEffort: 12,
  effortUnit: "hours",
  periodStartOn: "2026-09-28",
  periodEndOn: "2026-10-02",
};

describe("AddProjectNextActionRequestSchema", () => {
  it("requires complete estimation and period declarations", () => {
    expect(AddProjectNextActionRequestSchema.parse(action)).toEqual(action);
    expect(() =>
      AddProjectNextActionRequestSchema.parse({
        ...action,
        effortUnit: null,
      }),
    ).toThrow("La estimación y su unidad deben declararse juntas.");
    expect(() =>
      AddProjectNextActionRequestSchema.parse({
        ...action,
        periodEndOn: "2026-09-27",
      }),
    ).toThrow("El período no puede terminar antes de comenzar.");
  });
});

describe("capacity contracts", () => {
  it("requires a valid, complete capacity period", () => {
    expect(
      DeclareCapacityAvailabilityRequestSchema.parse({
        availableActorId: "person",
        unit: "hours",
        period: { startsOn: "2026-10-01", endsOn: "2026-10-07" },
        availableEffort: 20,
      }),
    ).toMatchObject({ availableEffort: 20 });
    expect(() =>
      CapacityBalanceQuerySchema.parse({
        capacityActorId: "person",
        unit: "hours",
        periodStartsOn: "2026-10-07",
        periodEndsOn: "2026-10-01",
      }),
    ).toThrow("El período no puede terminar antes de comenzar.");
  });
});

describe("CloseProjectRequestSchema", () => {
  it("preserves structured closure exceptions and defaults compatibility items", () => {
    const closure = CloseProjectRequestSchema.parse({
      organizationId: "00000000-0000-4000-8000-000000000001",
      outcomes: "Piloto entregado.",
      lessonsLearned: "Validar responsables antes del cierre.",
      objectiveAssessment: "achieved",
      assessmentRationale: "La medición final cumplió el objetivo comprometido.",
      closureExceptions: [
        {
          description: "Medir adopción posterior.",
          disposition: "transferred",
          responsibleActorId: "adoption-owner",
          rationale: "El equipo de adopción mantiene el seguimiento.",
        },
      ],
    });
    expect(closure.pendingItems).toEqual([]);
    expect(closure.closureExceptions).toHaveLength(1);
    expect(
      CloseProjectRequestSchema.safeParse({
        ...closure,
        closureExceptions: [
          {
            ...closure.closureExceptions[0],
            disposition: "unknown",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CloseProjectRequestSchema.safeParse({
        ...closure,
        objectiveAssessment: "not_assessed",
      }).success,
    ).toBe(false);
  });
});
