import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  EvaluationService,
  InitiativeService,
  InitiativeVersionConflictError,
  TenantService,
  WorkspaceArchivedError,
} from "@aether/application";

import {
  InMemoryInitiativeAuditStore,
  InMemoryEvaluationStandardStore,
  InMemoryEvaluationStore,
  InMemoryInitiativeStore,
} from "./initiatives.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("initiative vertical slice", () => {
  it("autoriza creador, reviewer y decision maker de forma explícita y auditable", async () => {
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const tenantStore = new InMemoryTenantStore();
    const tokens = {
      generate: () => `token-${++sequence}`.padEnd(43, "x"),
      hash: (value: string) => `hash:${value}`,
    };
    const clock = { now: () => new Date("2026-09-09T12:00:00.000Z") };
    const tenants = new TenantService({
      store: tenantStore,
      ids,
      tokens,
      clock,
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Org",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Ideas",
      mode: "team",
    });
    const authorInvite = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "author@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: authorInvite.deliveryToken,
      actorId: "author",
      actorEmail: "author@example.test",
    });
    const reviewerInvite = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "reviewer@example.test",
      organizationRole: "admin",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: reviewerInvite.deliveryToken,
      actorId: "reviewer",
      actorEmail: "reviewer@example.test",
    });

    const audit = new InMemoryInitiativeAuditStore();
    const initiativeStore = new InMemoryInitiativeStore();
    const initiatives = new InitiativeService({
      store: initiativeStore,
      audit,
      tenancy: tenantStore,
      ids,
      clock,
    });
    const created = await initiatives.create({
      actorId: "author",
      organizationId: organization.id,
      workspaceId: workspace.id,
      correlationId: ids.next(),
      title: "Reducir tiempos",
      problemStatement: "Proceso lento",
      expectedOutcome: "Menos tiempo",
      classification: "internal",
    });
    const edited = await initiatives.edit({
      actorId: "author",
      organizationId: organization.id,
      initiativeId: created.id,
      correlationId: ids.next(),
      expectedVersion: 0,
      title: "Reducir tiempos de respuesta",
      problemStatement: "Proceso lento",
      expectedOutcome: "Menos tiempo",
      classification: "internal",
    });
    await expect(
      initiatives.present({
        actorId: "author",
        organizationId: organization.id,
        initiativeId: created.id,
        correlationId: ids.next(),
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(InitiativeVersionConflictError);
    const presented = await initiatives.present({
      actorId: "author",
      organizationId: organization.id,
      initiativeId: created.id,
      correlationId: ids.next(),
      expectedVersion: edited.version,
    });
    const standards = new InMemoryEvaluationStandardStore();
    const evaluations = new EvaluationService({
      standards,
      evaluations: new InMemoryEvaluationStore(),
      initiatives: initiativeStore,
      audit,
      tenancy: tenantStore,
      ids,
      clock,
    });
    const standard = await evaluations.publishStandard({
      actorId: "owner",
      organizationId: organization.id,
      name: "Estándar institucional",
      version: 1,
      criteria: [
        {
          id: ids.next(),
          code: "IMPACT",
          name: "Impacto",
          description: "El impacto está respaldado por evidencia.",
          weight: 1,
        },
      ],
    });
    await evaluations.activateStandard({
      actorId: "owner",
      organizationId: organization.id,
      standardId: standard.id,
    });
    const evaluation = await evaluations.review({
      actorId: "reviewer",
      organizationId: organization.id,
      initiativeId: created.id,
      correlationId: ids.next(),
      expectedVersion: presented.version,
      standardId: standard.id,
      results: [
        {
          criterionId: standard.criteria[0]!.id,
          assessment: "met",
          evidence: ["Indicador validado."],
        },
      ],
    });
    await expect(
      evaluations.decide({
        actorId: "reviewer",
        organizationId: organization.id,
        initiativeId: created.id,
        correlationId: ids.next(),
        expectedVersion: presented.version + 1,
        evaluationId: evaluation.id,
        outcome: "approved",
        rationale: "Revisión favorable.",
        evidence: ["Acta."],
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const decided = await evaluations.decide({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: created.id,
      correlationId: ids.next(),
      expectedVersion: presented.version + 1,
      evaluationId: evaluation.id,
      outcome: "approved",
      rationale: "Revisión favorable.",
      evidence: ["Acta."],
    });
    expect(decided.outcome).toBe("approved");
    expect(
      (
        await initiatives.auditTrail({
          actorId: "owner",
          organizationId: organization.id,
          initiativeId: created.id,
        })
      ).map((event) => event.eventType),
    ).toEqual([
      "initiative.created.v1",
      "initiative.edited.v1",
      "initiative.presented.v1",
      "initiative.evaluated.v1",
      "initiative.decided.v2",
    ]);
    await tenants.archiveWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      workspaceId: workspace.id,
      correlationId: ids.next(),
    });
    await expect(
      initiatives.edit({
        actorId: "author",
        organizationId: organization.id,
        initiativeId: created.id,
        correlationId: ids.next(),
        expectedVersion: presented.version + 2,
        title: "No debe editarse",
        problemStatement: "Proceso lento",
        expectedOutcome: "Menos tiempo",
        classification: "internal",
      }),
    ).rejects.toBeInstanceOf(WorkspaceArchivedError);
  });
});
