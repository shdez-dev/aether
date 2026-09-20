import { describe, expect, it } from "vitest";

import {
  createProject,
  declareNextActionDependency,
  transferProjectWorkspace,
  transitionProject,
} from "./project.js";

describe("project lifecycle", () => {
  it("rejects self-references and cycles between next actions", () => {
    const first = { actionId: "action-a", dependsOnActionId: "action-b" };
    expect(
      declareNextActionDependency({ dependency: first, existing: [] }),
    ).toEqual(first);
    expect(() =>
      declareNextActionDependency({
        dependency: { actionId: "action-b", dependsOnActionId: "action-a" },
        existing: [first],
      }),
    ).toThrow("PROJECT_DEPENDENCY_CYCLE");
  });
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
  it("requires a planned project and an explicit transfer reason", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const project = createProject({
      id: "project",
      organizationId: "organization",
      workspaceId: "workspace-a",
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
    expect(
      transferProjectWorkspace({
        project,
        workspaceId: "workspace-b",
        reason: "Cambio de contexto operativo.",
        updatedAt: now,
      }),
    ).toMatchObject({ workspaceId: "workspace-b", version: 1 });
    expect(() =>
      transferProjectWorkspace({
        project: transitionProject(project, "active", now),
        workspaceId: "workspace-b",
        reason: "Cambio de contexto operativo.",
        updatedAt: now,
      }),
    ).toThrow("PROJECT_WORKSPACE_TRANSFER_INVALID");
  });
});
