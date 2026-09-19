import { describe, expect, it } from "vitest";

import {
  assessInitiativeForTriage,
  publishTriageStandard,
} from "./triage.js";

const criterion = {
  id: "criterion-1",
  code: "SCOPE",
  name: "Alcance",
  description: "La iniciativa tiene un alcance verificable.",
  required: true,
};
const standard = publishTriageStandard({
  id: "standard-1",
  organizationId: "organization-1",
  name: "Triage institucional",
  version: 1,
  criteria: [criterion],
  publishedAt: new Date("2026-09-19T00:00:00.000Z"),
  publishedByActorId: "owner-1",
});

describe("triage domain", () => {
  it("requires all required criteria and keeps the exact standard snapshot", () => {
    expect(() =>
      assessInitiativeForTriage({
        id: "triage-1",
        organizationId: "organization-1",
        workspaceId: "workspace-1",
        initiativeId: "initiative-1",
        initiativeVersion: 3,
        standard,
        results: [],
        assessedByActorId: "actor-1",
        assessedAt: new Date("2026-09-19T00:00:00.000Z"),
      }),
    ).toThrow("REQUIRED_TRIAGE_CRITERION_MISSING");

    const triage = assessInitiativeForTriage({
      id: "triage-1",
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      initiativeId: "initiative-1",
      initiativeVersion: 3,
      standard,
      results: [
        {
          criterionId: criterion.id,
          assessment: "pass",
          justification: ["El alcance está descrito en el expediente."],
        },
      ],
      assessedByActorId: "actor-1",
      assessedAt: new Date("2026-09-19T00:00:00.000Z"),
    });

    expect(triage).toMatchObject({
      initiativeVersion: 3,
      standardId: "standard-1",
      standardVersion: 1,
      criteria: [{ criterion }],
    });
  });

  it("requires justification when a criterion is not applicable", () => {
    expect(() =>
      assessInitiativeForTriage({
        id: "triage-2",
        organizationId: "organization-1",
        workspaceId: "workspace-1",
        initiativeId: "initiative-1",
        initiativeVersion: 3,
        standard,
        results: [
          { criterionId: criterion.id, assessment: "not_applicable", justification: [] },
        ],
        assessedByActorId: "actor-1",
        assessedAt: new Date("2026-09-19T00:00:00.000Z"),
      }),
    ).toThrow("TRIAGE_NOT_APPLICABLE_REQUIRES_JUSTIFICATION");
  });
});
