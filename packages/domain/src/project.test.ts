import { describe, expect, it } from "vitest";

import { createProject, transitionProject } from "./project.js";

describe("project lifecycle", () => {
  it("allows pausing and resuming an active project", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const planned = createProject({
      id: "project",
      organizationId: "organization",
      workspaceId: "workspace",
      sourceInitiativeId: "initiative",
      sourceDecisionId: "decision",
      name: "Proyecto",
      objective: "Resolver una necesidad priorizada.",
      boundaries: "Sólo el alcance acordado.",
      successCriteria: "Entregar el resultado acordado.",
      nextMilestone: "Completar la preparación.",
      sponsorActorId: "sponsor",
      leadActorId: "lead",
      participants: [
        { actorId: "sponsor", role: "sponsor" },
        { actorId: "lead", role: "lead" },
      ],
      createdAt: now,
      updatedAt: now,
    });
    const active = transitionProject(planned, "active", now);
    const paused = transitionProject(active, "paused", now);
    const resumed = transitionProject(paused, "active", now);

    expect(paused).toMatchObject({ status: "paused", version: 2 });
    expect(resumed).toMatchObject({ status: "active", version: 3 });
  });
});
