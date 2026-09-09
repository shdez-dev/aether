import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  ProjectService,
  TenantService,
} from "@aether/application";
import { createInitiative, transitionInitiative } from "@aether/domain";

import {
  InMemoryEvaluationStore,
  InMemoryInitiativeStore,
} from "./initiatives.js";
import {
  InMemoryProjectAuditStore,
  InMemoryProjectExecutionStore,
  InMemoryProjectStore,
} from "./projects.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("project conversion and execution", () => {
  it("preserva iniciativa y decisión fuente, y sólo líder o gestión ejecutan", async () => {
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const tenantStore = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenantStore,
      ids,
      tokens: { generate: () => "x".repeat(43), hash: (value) => value },
      clock: { now: () => new Date("2026-09-11T10:00:00.000Z") },
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@test",
      name: "Org",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Ejecución",
      mode: "institutional",
    });
    for (const [actorId, email] of [
      ["lead", "lead@test"],
      ["observer", "observer@test"],
    ] as const) {
      const invitation = await tenants.invite({
        actorId: "owner",
        organizationId: organization.id,
        email,
        organizationRole: "member",
        workspaceIds: [workspace.id],
        workspaceRole: "member",
        expiresInDays: 7,
      });
      await tenants.acceptInvitation({
        token: invitation.deliveryToken,
        actorId,
        actorEmail: email,
      });
    }
    const initiatives = new InMemoryInitiativeStore();
    const draft = createInitiative({
      id: ids.next(),
      organizationId: organization.id,
      workspaceId: workspace.id,
      createdByActorId: "owner",
      title: "Proyecto piloto",
      problemStatement: "Problema",
      expectedOutcome: "Resultado",
      classification: "internal",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const approved = transitionInitiative(
      transitionInitiative(
        transitionInitiative(draft, "presented", new Date()),
        "under_review",
        new Date(),
      ),
      "approved",
      new Date(),
    );
    await initiatives.create(approved);
    const decisions = new InMemoryEvaluationStore();
    const decisionId = ids.next();
    await decisions.createDecision({
      id: decisionId,
      organizationId: organization.id,
      workspaceId: workspace.id,
      initiativeId: approved.id,
      evaluationId: ids.next(),
      outcome: "approved",
      rationale: "Aprobada",
      evidence: ["Acta"],
      standardId: ids.next(),
      standardVersion: 1,
      coverage: { totalCriteria: 1, assessedCriteria: 1, percentage: 100 },
      decidedByActorId: "owner",
      decidedAt: new Date(),
    });
    const projectStore = new InMemoryProjectStore();
    const execution = new InMemoryProjectExecutionStore();
    const audit = new InMemoryProjectAuditStore();
    const projects = new ProjectService({
      projects: projectStore,
      execution,
      audit,
      decisions,
      initiatives,
      tenancy: tenantStore,
      ids,
      clock: { now: () => new Date("2026-09-11T10:00:00.000Z") },
    });
    const project = await projects.createFromInitiative({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: approved.id,
      decisionId,
      name: "Piloto ejecutable",
      sponsorActorId: "owner",
      leadActorId: "lead",
      participants: [
        { actorId: "owner", role: "sponsor" },
        { actorId: "lead", role: "lead" },
        { actorId: "observer", role: "observer" },
      ],
      correlationId: ids.next(),
    });
    expect(project.sourceInitiativeId).toBe(approved.id);
    expect(project.sourceDecisionId).toBe(decisionId);
    await expect(
      projects.addMilestone({
        actorId: "observer",
        organizationId: organization.id,
        projectId: project.id,
        title: "No autorizado",
        dueOn: null,
        correlationId: ids.next(),
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const active = await projects.changeStatus({
      actorId: "lead",
      organizationId: organization.id,
      projectId: project.id,
      expectedVersion: project.version,
      status: "active",
      correlationId: ids.next(),
    });
    await projects.addMilestone({
      actorId: "lead",
      organizationId: organization.id,
      projectId: project.id,
      title: "Primer hito",
      dueOn: "2026-10-01",
      correlationId: ids.next(),
    });
    await projects.addNextAction({
      actorId: "lead",
      organizationId: organization.id,
      projectId: project.id,
      description: "Preparar piloto",
      ownerActorId: "lead",
      dueOn: "2026-09-20",
      correlationId: ids.next(),
    });
    expect(active.status).toBe("active");
    expect(execution.milestones).toHaveLength(1);
    expect(execution.actions).toHaveLength(1);
    expect(projectStore.durableEvents.map((event) => event.eventType)).toEqual([
      "project.created.v1",
      "project.status_changed.v1",
    ]);
    expect(audit.events.map((event) => event.eventType)).toEqual([
      "project.created_from_initiative.v1",
      "project.status_changed.v1",
      "project.milestone_added.v1",
      "project.next_action_added.v1",
    ]);
  });
});
