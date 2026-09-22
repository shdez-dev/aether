import { describe, expect, it } from "vitest";

import {
  createProject,
  archiveProject,
  declareNextActionDependency,
  transitionNextActionWorkflow,
  transferProjectWorkspace,
  transitionProject,
} from "./project.js";

describe("project lifecycle", () => {
  it("keeps blocking separate from the shared task workflow", () => {
    const action = {
      id: "action",
      projectId: "project",
      description: "Preparar la evidencia.",
      ownerActorId: "owner",
      reviewerActorId: "reviewer",
      dueOn: null,
      priority: "medium" as const,
      estimatedEffort: null,
      effortUnit: null,
      periodStartOn: null,
      periodEndOn: null,
      workflowStatus: "to_do" as const,
      blockedReason: null,
      unblockResponsibleActorId: null,
      completedAt: null,
      version: 0,
      createdByActorId: "owner",
      createdAt: new Date("2026-09-22T12:00:00.000Z"),
    };
    const inProgress = transitionNextActionWorkflow({
      action,
      status: "in_progress",
      blockedReason: "Pendiente de respuesta externa.",
      unblockResponsibleActorId: "owner",
      at: action.createdAt,
    });
    expect(inProgress).toMatchObject({
      workflowStatus: "in_progress",
      version: 1,
      blockedReason: "Pendiente de respuesta externa.",
    });
    expect(() =>
      transitionNextActionWorkflow({
        action: inProgress,
        status: "done",
        blockedReason: null,
        unblockResponsibleActorId: null,
        at: action.createdAt,
      }),
    ).toThrow("PROJECT_NEXT_ACTION_TRANSITION_INVALID");
    expect(() =>
      transitionNextActionWorkflow({
        action,
        status: "to_do",
        blockedReason: "Sin contexto.",
        unblockResponsibleActorId: "owner",
        at: action.createdAt,
      }),
    ).toThrow("PROJECT_NEXT_ACTION_BLOCK_INVALID");
  });
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
    expect(() =>
      declareNextActionDependency({ dependency: first, existing: [first] }),
    ).toThrow("PROJECT_DEPENDENCY_INVALID");
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
  it("only archives terminal projects", () => {
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
    expect(() => archiveProject(planned, now)).toThrow(
      "PROJECT_ARCHIVE_INVALID",
    );
    const completed = transitionProject(
      transitionProject(planned, "active", now),
      "completed",
      now,
    );
    expect(archiveProject(completed, now)).toMatchObject({
      status: "archived",
    });
  });
});
