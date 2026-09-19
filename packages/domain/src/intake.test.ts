import { describe, expect, it } from "vitest";

import { assignIntakeResponsibility } from "./intake.js";

describe("intake domain", () => {
  it("requires a next review date for an intake responsibility", () => {
    expect(() =>
      assignIntakeResponsibility({
        id: "assignment-1",
        organizationId: "organization-1",
        workspaceId: "workspace-1",
        initiativeId: "initiative-1",
        responsibleActorId: "actor-1",
        assignedByActorId: "owner-1",
        assignedAt: new Date("2026-09-19T00:00:00.000Z"),
        nextReviewOn: " ",
      }),
    ).toThrow("INTAKE_REVIEW_DATE_REQUIRED");
  });
});
