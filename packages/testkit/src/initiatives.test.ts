import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  EvaluationConflictOfInterestError,
  EvaluationService,
  TriageService,
  InitiativeService,
  InitiativeVersionConflictError,
  NotificationService,
  TenantService,
  WorkspaceArchivedError,
} from "@aether/application";

import {
  InMemoryInitiativeAuditStore,
  InMemoryEvaluationStandardStore,
  InMemoryEvaluationStore,
  InMemoryInitiativeStore,
  InMemoryTriageStandardStore,
  InMemoryTriageStore,
} from "./initiatives.js";
import { InMemoryNotificationStore } from "./notifications.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("initiative vertical slice", () => {
  it("publica, adopta y aplica un triage versionado antes de la evaluación formal", async () => {
    const ids = { next: () => crypto.randomUUID() };
    const clock = { now: () => new Date("2026-09-19T00:00:00.000Z") };
    const tenantStore = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenantStore,
      ids,
      tokens: {
        generate: () => "x".repeat(43),
        hash: (value: string) => `hash:${value}`,
      },
      clock,
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Triage Org",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Ideas",
      mode: "team",
    });
    const initiativesStore = new InMemoryInitiativeStore();
    const audit = new InMemoryInitiativeAuditStore();
    const initiatives = new InitiativeService({
      store: initiativesStore,
      audit,
      tenancy: tenantStore,
      ids,
      clock,
    });
    const initiative = await initiatives.create({
      actorId: "owner",
      organizationId: organization.id,
      workspaceId: workspace.id,
      correlationId: ids.next(),
      title: "Iniciativa triage",
      problemStatement: "Problema",
      expectedOutcome: "Resultado",
      classification: "internal",
      requestedPriority: "medium",
    });
    const presented = await initiatives.present({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: initiative.id,
      correlationId: ids.next(),
      expectedVersion: initiative.version,
    });
    const standards = new InMemoryTriageStandardStore();
    const triages = new InMemoryTriageStore();
    const service = new TriageService({
      standards,
      triages,
      initiatives: initiativesStore,
      audit,
      tenancy: tenantStore,
      ids,
      clock,
    });
    const criterionId = ids.next();
    const standard = await service.publishStandard({
      actorId: "owner",
      organizationId: organization.id,
      name: "Triage inicial",
      version: 1,
      criteria: [
        {
          id: criterionId,
          code: "SCOPE",
          name: "Alcance",
          description: "Alcance verificable",
          required: true,
        },
      ],
    });
    await service.activateStandard({
      actorId: "owner",
      organizationId: organization.id,
      standardId: standard.id,
    });
    const triage = await service.triage({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: initiative.id,
      expectedVersion: presented.version,
      standardId: standard.id,
      results: [
        {
          criterionId,
          assessment: "pass",
          justification: ["El alcance está delimitado."],
        },
      ],
      correlationId: ids.next(),
    });
    expect(triage).toMatchObject({
      initiativeId: initiative.id,
      initiativeVersion: presented.version,
      standardId: standard.id,
      standardVersion: 1,
    });
    expect(audit.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "initiative.triaged.v1",
          payload: expect.objectContaining({ triageId: triage.id }),
        }),
      ]),
    );
  });

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
      requestedPriority: "high",
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
    const evaluationStore = new InMemoryEvaluationStore();
    const notificationStore = new InMemoryNotificationStore();
    const notifications = new NotificationService({
      store: notificationStore,
      tenancy: tenantStore,
      ids,
      clock,
    });
    const evaluations = new EvaluationService({
      standards,
      evaluations: evaluationStore,
      initiatives: initiativeStore,
      audit,
      tenancy: tenantStore,
      notifications,
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
    await evaluations.assignReviewer({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: created.id,
      reviewerActorId: "reviewer",
      correlationId: ids.next(),
    });
    await expect(
      evaluations.review({
        actorId: "owner",
        organizationId: organization.id,
        initiativeId: created.id,
        correlationId: ids.next(),
        expectedVersion: presented.version,
        standardId: standard.id,
        results: [
          {
            criterionId: standard.criteria[0]!.id,
            assessment: "met",
            evidence: ["No corresponde al revisor asignado."],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "EVALUATION_REVIEWER_NOT_ASSIGNED" });
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
    ).rejects.toBeInstanceOf(EvaluationConflictOfInterestError);
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
      conditions: [
        {
          description: "Validar la adopción con el área usuaria.",
          responsibleActorId: "author",
          dueOn: "2026-10-01",
        },
        {
          description: "Formalizar el alcance con el patrocinador.",
          responsibleActorId: "author",
          dueOn: "2026-10-02",
        },
      ],
    });
    expect(decided.outcome).toBe("approved");
    await expect(
      evaluations.annulEvaluation({
        actorId: "owner",
        organizationId: organization.id,
        evaluationId: evaluation.id,
        reason: "No puede invalidarse una evaluación ya decidida.",
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "EVALUATION_ALREADY_DECIDED" });
    expect(
      await notificationStore.list({
        actorId: "author",
        organizationId: organization.id,
      }),
    ).toEqual([
      expect.objectContaining({
        recipientActorId: "author",
        resourceType: "initiative",
        resourceId: created.id,
        title: "Hay una nueva decisión para una iniciativa.",
      }),
    ]);
    expect(decided.conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          responsibleActorId: "author",
          status: "pending",
          resolvedAt: null,
        }),
      ]),
    );
    const fulfilledConditionId = decided.conditions![0]!.id;
    await expect(
      evaluations.fulfillCondition({
        actorId: "reviewer",
        organizationId: organization.id,
        decisionId: decided.id,
        conditionId: fulfilledConditionId,
        note: "No debe autorizarse por rol de administrador.",
        correlationId: ids.next(),
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const fulfilled = await evaluations.fulfillCondition({
      actorId: "author",
      organizationId: organization.id,
      decisionId: decided.id,
      conditionId: fulfilledConditionId,
      note: "La adopción fue validada con el área usuaria.",
      correlationId: ids.next(),
    });
    expect(fulfilled.conditions![0]).toMatchObject({
      status: "fulfilled",
      resolvedByActorId: "author",
      resolutionNote: "La adopción fue validada con el área usuaria.",
    });
    const exempted = await evaluations.exemptCondition({
      actorId: "owner",
      organizationId: organization.id,
      decisionId: decided.id,
      conditionId: decided.conditions![1]!.id,
      reason: "La validación se incorporó en el alcance inicial.",
      correlationId: ids.next(),
    });
    expect(exempted.conditions![1]).toMatchObject({
      status: "exempted",
      resolvedByActorId: "owner",
      resolutionNote: "La validación se incorporó en el alcance inicial.",
    });
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
      "initiative.evaluation_reviewer_assigned.v1",
      "initiative.evaluated.v1",
      "initiative.decided.v2",
      "initiative.decision_condition_fulfilled.v1",
      "initiative.decision_condition_exempted.v1",
    ]);
    const annulmentDraft = await initiatives.create({
      actorId: "author",
      organizationId: organization.id,
      workspaceId: workspace.id,
      correlationId: ids.next(),
      title: "Revisar evidencia de anulación",
      problemStatement: "La evidencia de soporte está incompleta.",
      expectedOutcome: "Completar la revisión antes de decidir.",
      classification: "internal",
      requestedPriority: "medium",
    });
    const annulmentPresented = await initiatives.present({
      actorId: "author",
      organizationId: organization.id,
      initiativeId: annulmentDraft.id,
      correlationId: ids.next(),
      expectedVersion: annulmentDraft.version,
    });
    const abstentionAssignment = await evaluations.assignReviewer({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: annulmentDraft.id,
      reviewerActorId: "reviewer",
      correlationId: ids.next(),
    });
    const abstained = await evaluations.abstainFromReview({
      actorId: "reviewer",
      organizationId: organization.id,
      assignmentId: abstentionAssignment.id,
      reason: "Debo abstenerme por cercanía con la evidencia presentada.",
      correlationId: ids.next(),
    });
    expect(abstained).toMatchObject({
      status: "abstained",
      reason: "Debo abstenerme por cercanía con la evidencia presentada.",
    });
    const reassignment = await evaluations.reassignReview({
      actorId: "owner",
      organizationId: organization.id,
      assignmentId: abstentionAssignment.id,
      reviewerActorId: "owner",
      reason: "Se reasigna a un owner independiente.",
      correlationId: ids.next(),
    });
    expect(reassignment).toMatchObject({
      status: "assigned",
      assignedActorId: "owner",
    });
    const annulmentEvaluation = await evaluations.review({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: annulmentDraft.id,
      correlationId: ids.next(),
      expectedVersion: annulmentPresented.version,
      standardId: standard.id,
      results: [
        {
          criterionId: standard.criteria[0]!.id,
          assessment: "met",
          evidence: ["Evidencia pendiente de validación."],
        },
      ],
    });
    const annulled = await evaluations.annulEvaluation({
      actorId: "owner",
      organizationId: organization.id,
      evaluationId: annulmentEvaluation.id,
      reason: "La evidencia requiere una revisión adicional.",
      correlationId: ids.next(),
    });
    expect(annulled).toMatchObject({
      id: annulmentEvaluation.id,
      annulledByActorId: "owner",
      annulmentReason: "La evidencia requiere una revisión adicional.",
    });
    expect(annulled.annulledAt).toEqual(clock.now());
    await expect(
      evaluations.decide({
        actorId: "owner",
        organizationId: organization.id,
        initiativeId: annulmentDraft.id,
        correlationId: ids.next(),
        expectedVersion: annulmentPresented.version + 1,
        evaluationId: annulled.id,
        outcome: "approved",
        rationale: "No debe decidirse una evaluación anulada.",
        evidence: ["Acta."],
      }),
    ).rejects.toMatchObject({ code: "EVALUATION_ANNULLED" });
    const escalationDraft = await initiatives.create({
      actorId: "author",
      organizationId: organization.id,
      workspaceId: workspace.id,
      correlationId: ids.next(),
      title: "Escalar una abstención",
      problemStatement: "La abstención requiere intervención de gobierno.",
      expectedOutcome: "Definir el siguiente revisor institucional.",
      classification: "internal",
      requestedPriority: "medium",
    });
    const escalationPresented = await initiatives.present({
      actorId: "author",
      organizationId: organization.id,
      initiativeId: escalationDraft.id,
      correlationId: ids.next(),
      expectedVersion: escalationDraft.version,
    });
    const escalationAssignment = await evaluations.assignReviewer({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: escalationDraft.id,
      reviewerActorId: "reviewer",
      correlationId: ids.next(),
    });
    await evaluations.abstainFromReview({
      actorId: "reviewer",
      organizationId: organization.id,
      assignmentId: escalationAssignment.id,
      reason: "La revisión debe resolverse por una instancia superior.",
      correlationId: ids.next(),
    });
    const escalated = await evaluations.escalateReviewAbstention({
      actorId: "owner",
      organizationId: organization.id,
      assignmentId: escalationAssignment.id,
      reason: "Se solicita definición de comité para continuar.",
      correlationId: ids.next(),
    });
    expect(escalated).toMatchObject({
      status: "escalated",
      reason: "Se solicita definición de comité para continuar.",
    });
    expect(escalationPresented.status).toBe("presented");
    const returnedDraft = await initiatives.create({
      actorId: "author",
      organizationId: organization.id,
      workspaceId: workspace.id,
      correlationId: ids.next(),
      title: "Devolver con próxima revisión",
      problemStatement: "Falta completar observaciones del diagnóstico.",
      expectedOutcome: "Entregar una nueva versión en la fecha acordada.",
      classification: "internal",
      requestedPriority: "medium",
    });
    const returnedPresented = await initiatives.present({
      actorId: "author",
      organizationId: organization.id,
      initiativeId: returnedDraft.id,
      correlationId: ids.next(),
      expectedVersion: returnedDraft.version,
    });
    await evaluations.assignReviewer({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: returnedDraft.id,
      reviewerActorId: "reviewer",
      correlationId: ids.next(),
    });
    const returnedEvaluation = await evaluations.review({
      actorId: "reviewer",
      organizationId: organization.id,
      initiativeId: returnedDraft.id,
      correlationId: ids.next(),
      expectedVersion: returnedPresented.version,
      standardId: standard.id,
      results: [
        {
          criterionId: standard.criteria[0]!.id,
          assessment: "met",
          evidence: ["El criterio se revisó por completo."],
        },
      ],
    });
    await expect(
      evaluations.decide({
        actorId: "owner",
        organizationId: organization.id,
        initiativeId: returnedDraft.id,
        correlationId: ids.next(),
        expectedVersion: returnedPresented.version + 1,
        evaluationId: returnedEvaluation.id,
        outcome: "returned",
        rationale: "Completar el diagnóstico con las observaciones indicadas.",
        evidence: ["Acta de devolución."],
      }),
    ).rejects.toMatchObject({ code: "RETURNED_DECISION_REQUIRES_NEXT_REVIEW" });
    const returned = await evaluations.decide({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: returnedDraft.id,
      correlationId: ids.next(),
      expectedVersion: returnedPresented.version + 1,
      evaluationId: returnedEvaluation.id,
      outcome: "returned",
      rationale: "Completar el diagnóstico con las observaciones indicadas.",
      evidence: ["Acta de devolución."],
      nextReviewOn: "2026-10-15",
    });
    expect(returned).toMatchObject({
      outcome: "returned",
      nextReviewOn: "2026-10-15",
    });
    const returnedDetail = await initiatives.detail({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: returnedDraft.id,
    });
    await expect(
      initiatives.setOperationalPriority({
        actorId: "author",
        organizationId: organization.id,
        initiativeId: returnedDraft.id,
        correlationId: ids.next(),
        expectedVersion: returnedDetail.initiative.version,
        operationalPriority: "high",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const reprioritized = await initiatives.setOperationalPriority({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: returnedDraft.id,
      correlationId: ids.next(),
      expectedVersion: returnedDetail.initiative.version,
      operationalPriority: "high",
    });
    expect(reprioritized).toMatchObject({
      requestedPriority: "medium",
      operationalPriority: "high",
    });
    expect(
      (
        await initiatives.auditTrail({
          actorId: "owner",
          organizationId: organization.id,
          initiativeId: returnedDraft.id,
        })
      ).at(-1),
    ).toMatchObject({
      eventType: "initiative.operational_priority_set.v1",
      payload: { operationalPriority: "high" },
    });
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
