import { describe, expect, it } from "vitest";

import { AddProjectNextActionRequestSchema } from "./initiatives.js";

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
