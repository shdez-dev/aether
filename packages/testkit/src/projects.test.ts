import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  DocumentNotFoundError,
  ProjectService,
  TenantService,
} from "@aether/application";
import { createInitiative, transitionInitiative } from "@aether/domain";
import type {
  DocumentVersion,
  InstitutionalDocument,
  ProjectNextAction,
} from "@aether/domain";

import {
  InMemoryAuditHistoryStore,
  InMemoryEvaluationStore,
  InMemoryInitiativeAuditStore,
  InMemoryInitiativeStore,
} from "./initiatives.js";
import {
  InMemoryProjectAuditStore,
  InMemoryProjectClosureStore,
  InMemoryProjectExecutionStore,
  InMemoryProjectStore,
} from "./projects.js";
import { InMemoryDocumentStore } from "./documents.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("project conversion and execution", () => {
  it("serializes shared reordering through the expected task version", async () => {
    const execution = new InMemoryProjectExecutionStore();
    const base: ProjectNextAction = {
      id: "first",
      projectId: "project",
      description: "First",
      ownerActorId: "owner",
      executorTeamId: null,
      reviewerActorId: null,
      dueOn: null,
      priority: "medium",
      estimatedEffort: null,
      effortUnit: null,
      periodStartOn: null,
      periodEndOn: null,
      workflowStatus: "to_do",
      position: 1,
      blockedReason: null,
      unblockResponsibleActorId: null,
      completedAt: null,
      version: 0,
      createdByActorId: "owner",
      createdAt: new Date("2026-09-22T00:00:00.000Z"),
    };
    await execution.addNextAction(base);
    await execution.addNextAction({ ...base, id: "second" });
    const auditEvent = {
      id: "audit",
      eventType: "project.next_action_reordered.v1",
      organizationId: "organization",
      workspaceId: "workspace",
      projectId: base.projectId,
      actorId: "owner",
      correlationId: "correlation",
      occurredAt: base.createdAt,
      payload: {},
    };
    const [first, second] = await Promise.all([
      execution.reorderNextAction({
        action: { ...base, id: "second", position: 2 },
        position: 1,
        expectedVersion: 0,
        auditEvent,
      }),
      execution.reorderNextAction({
        action: { ...base, id: "second", position: 2 },
        position: 1,
        expectedVersion: 0,
        auditEvent,
      }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    await expect(
      execution.listNextActions(base.projectId),
    ).resolves.toMatchObject([
      { id: "second", position: 1, version: 1 },
      { id: "first", position: 2, version: 1 },
    ]);
  });
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
      ["replacement", "replacement@test"],
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
    const unscopedInvitation = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "unscoped@test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: unscopedInvitation.deliveryToken,
      actorId: "unscoped",
      actorEmail: "unscoped@test",
    });
    const executionTeam = await tenants.createTeam({
      actorId: "owner",
      organizationId: organization.id,
      workspaceId: workspace.id,
      name: "Equipo de ejecución",
      memberActorIds: ["replacement", "lead"],
      correlationId: ids.next(),
    });
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
      requestedPriority: "medium",
      operationalPriority: null,
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
    const conditionId = ids.next();
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
      coverage: {
        totalCriteria: 1,
        applicableCriteria: 1,
        assessedCriteria: 1,
        notApplicableCriteria: 0,
        percentage: 100,
      },
      quality: null,
      decidedByActorId: "owner",
      decidedAt: new Date(),
      nextReviewOn: null,
      conditions: [
        {
          id: conditionId,
          description: "Completar la validación operativa.",
          responsibleActorId: "lead",
          dueOn: "2026-10-01",
          status: "pending",
          resolvedByActorId: null,
          resolvedAt: null,
          resolutionNote: null,
        },
      ],
    });
    const projectStore = new InMemoryProjectStore();
    const audit = new InMemoryProjectAuditStore();
    const execution = new InMemoryProjectExecutionStore(audit);
    const closures = new InMemoryProjectClosureStore();
    const documentStore = new InMemoryDocumentStore();
    const projects = new ProjectService({
      projects: projectStore,
      execution,
      closures,
      documents: documentStore,
      audit,
      decisions,
      initiatives,
      tenancy: tenantStore,
      ids,
      clock: { now: () => new Date("2026-09-11T10:00:00.000Z") },
    });
    const conversionInput = {
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: approved.id,
      decisionId,
      name: "Piloto ejecutable",
      objective: "Reducir el tiempo de atención.",
      boundaries: "Sólo solicitudes internas priorizadas.",
      successCriteria: "Reducir la mediana de espera en 20 %.",
      nextMilestone: "Validar el piloto inicial.",
      sponsorActorId: "owner",
      leadActorId: null,
      participants: [
        { actorId: "owner", role: "sponsor" },
        { actorId: "observer", role: "observer" },
      ] as const,
      correlationId: ids.next(),
    };
    await expect(
      projects.createFromInitiative(conversionInput),
    ).rejects.toMatchObject({ code: "DECISION_CONDITIONS_PENDING" });
    const storedDecision = await decisions.findDecision(decisionId);
    await decisions.updateDecisionCondition({
      decisionId,
      condition: {
        ...storedDecision!.conditions![0]!,
        status: "exempted",
        resolvedByActorId: "owner",
        resolvedAt: new Date(),
        resolutionNote: "Resuelta dentro del alcance inicial.",
      },
    });
    await expect(
      projects.createFromInitiative({
        ...conversionInput,
        leadActorId: "unscoped",
        participants: [
          { actorId: "owner", role: "sponsor" },
          { actorId: "unscoped", role: "lead" },
          { actorId: "observer", role: "observer" },
        ],
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      projects.createFromInitiative({
        ...conversionInput,
        sponsorActorId: "unscoped",
        participants: [
          { actorId: "unscoped", role: "sponsor" },
          { actorId: "observer", role: "observer" },
        ],
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const pending = await projects.createFromInitiative(conversionInput);
    expect(pending).toMatchObject({
      sourceInitiativeId: approved.id,
      sourceDecisionId: decisionId,
      status: "pending_lead",
      leadActorId: null,
    });
    const retried = await projects.createFromInitiative({
      ...conversionInput,
      correlationId: ids.next(),
    });
    expect(retried.id).toBe(pending.id);
    await expect(
      projects.changeStatus({
        actorId: "owner",
        organizationId: organization.id,
        projectId: pending.id,
        expectedVersion: pending.version,
        status: "active",
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_LEAD_ASSIGNMENT_INVALID" });
    let project = await projects.assignLead({
      actorId: "owner",
      organizationId: organization.id,
      projectId: pending.id,
      expectedVersion: pending.version,
      leadActorId: "lead",
      correlationId: ids.next(),
    });
    expect(project).toMatchObject({
      status: "planned",
      leadActorId: "lead",
      version: 1,
    });
    project = await projects.replaceLead({
      actorId: "owner",
      organizationId: organization.id,
      projectId: project.id,
      expectedVersion: project.version,
      leadActorId: "replacement",
      reason: "El responsable original deja la iniciativa.",
      correlationId: ids.next(),
    });
    expect(project).toMatchObject({
      leadActorId: "replacement",
      version: 2,
      participants: expect.arrayContaining([
        { actorId: "lead", role: "contributor" },
        { actorId: "replacement", role: "lead" },
      ]),
    });
    await expect(
      projects.addMilestone({
        actorId: "lead",
        organizationId: organization.id,
        projectId: project.id,
        title: "No autorizado tras la sustitución",
        dueOn: null,
        correlationId: ids.next(),
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      projects.createFromInitiative({
        ...conversionInput,
        name: "Intento con parámetros distintos",
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ message: "PROJECT_ALREADY_EXISTS" });
    await expect(
      projects.list({
        actorId: "outsider",
        organizationId: organization.id,
        workspaceId: workspace.id,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
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
    await expect(
      projects.changeStatus({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        expectedVersion: project.version,
        status: "active",
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_MINIMUM_PLAN_REQUIRED" });
    await projects.addMilestone({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      title: "Primer hito",
      dueOn: "2026-10-01",
      correlationId: ids.next(),
    });
    const teamInboxAction = await projects.addNextAction({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      description: "Tomar desde la bandeja del equipo",
      ownerActorId: null,
      executorTeamId: executionTeam.id,
      reviewerActorId: null,
      dueOn: null,
      priority: "medium",
      estimatedEffort: null,
      effortUnit: null,
      periodStartOn: null,
      periodEndOn: null,
      correlationId: ids.next(),
    });
    await expect(
      projects.listMyWork({
        actorId: "lead",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject([
      { action: { id: teamInboxAction.id }, kinds: ["team_inbox"] },
    ]);
    await expect(
      projects.claimNextAction({
        actorId: "observer",
        organizationId: organization.id,
        projectId: project.id,
        actionId: teamInboxAction.id,
        expectedVersion: teamInboxAction.version,
        correlationId: ids.next(),
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      projects.transitionNextActionWorkflow({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        actionId: teamInboxAction.id,
        expectedVersion: teamInboxAction.version,
        status: "in_progress",
        blockedReason: null,
        unblockResponsibleActorId: null,
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_NEXT_ACTION_OWNER_REQUIRED" });
    await expect(
      projects.claimNextAction({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        actionId: teamInboxAction.id,
        expectedVersion: teamInboxAction.version,
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject({ ownerActorId: "replacement", version: 1 });
    const nextAction = await projects.addNextAction({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      description: "Preparar piloto",
      ownerActorId: "replacement",
      executorTeamId: executionTeam.id,
      reviewerActorId: "lead",
      dueOn: "2026-09-20",
      priority: "high",
      estimatedEffort: 12,
      effortUnit: "hours",
      periodStartOn: "2026-09-15",
      periodEndOn: "2026-09-20",
      correlationId: ids.next(),
    });
    await expect(
      projects.listNextActions({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        workflowStatus: "to_do",
        executorTeamId: executionTeam.id,
        ownerActorId: "replacement",
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject([
      { id: teamInboxAction.id, position: 1 },
      { id: nextAction.id, position: 2 },
    ]);
    await expect(
      projects.listNextActions({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        ownerActorId: "lead",
        correlationId: ids.next(),
      }),
    ).resolves.toEqual([]);
    await expect(
      projects.listTaskCalendar({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        fromOn: "2026-09-01",
        toOn: "2026-09-30",
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject({
      dated: [{ id: nextAction.id, dueOn: "2026-09-20" }],
      undated: [{ id: teamInboxAction.id, dueOn: null }],
    });
    await expect(
      projects.listTaskCalendar({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        fromOn: "2026-09-21",
        toOn: "2026-09-30",
        ownerActorId: "replacement",
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject({
      dated: [],
      undated: [{ id: teamInboxAction.id }],
    });
    await expect(
      projects.listTaskCalendar({
        actorId: "outsider",
        organizationId: organization.id,
        projectId: project.id,
        fromOn: "2026-09-01",
        toOn: "2026-09-30",
        correlationId: ids.next(),
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const dateChangeInput = {
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      actionId: teamInboxAction.id,
      expectedVersion: 1,
      proposedDueOn: "2026-09-21",
      correlationId: ids.next(),
    };
    const beforeDependency =
      await projects.previewTaskDateChange(dateChangeInput);
    await projects.declareNextActionDependency({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      actionId: teamInboxAction.id,
      dependsOnActionId: nextAction.id,
      correlationId: ids.next(),
    });
    await expect(
      projects.changeTaskDate({
        ...dateChangeInput,
        impactToken: beforeDependency.impactToken,
      }),
    ).rejects.toThrow("PROJECT_VERSION_CONFLICT");
    const impact = await projects.previewTaskDateChange(dateChangeInput);
    expect(impact).toMatchObject({
      currentDueOn: null,
      predecessors: [{ actionId: nextAction.id, dueOn: "2026-09-20" }],
      pendingMilestones: [{ title: "Primer hito", dueOn: "2026-10-01" }],
    });
    await expect(
      projects.changeTaskDate({
        ...dateChangeInput,
        impactToken: impact.impactToken,
      }),
    ).resolves.toMatchObject({ dueOn: "2026-09-21", version: 2 });
    await expect(
      projects.changeTaskDate({
        ...dateChangeInput,
        impactToken: impact.impactToken,
      }),
    ).rejects.toThrow("PROJECT_VERSION_CONFLICT");
    await projects.addNextActionCollaborator({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      actionId: nextAction.id,
      collaboratorActorId: "observer",
      expectedVersion: nextAction.version,
      correlationId: ids.next(),
    });
    const collaboratedAction = await execution.findNextAction(nextAction.id);
    await expect(
      projects.listMyWork({
        actorId: "observer",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: expect.objectContaining({ id: nextAction.id }),
          kinds: ["collaborator"],
        }),
      ]),
    );
    const blockedAction = await projects.transitionNextActionWorkflow({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      actionId: nextAction.id,
      expectedVersion: collaboratedAction!.version,
      status: "in_progress",
      blockedReason: "Esperando respuesta del proveedor.",
      unblockResponsibleActorId: "lead",
      correlationId: ids.next(),
    });
    await expect(
      projects.listMyWork({
        actorId: "lead",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: expect.objectContaining({ id: nextAction.id }),
          kinds: ["unblock"],
        }),
      ]),
    );
    const reviewAction = await projects.transitionNextActionWorkflow({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      actionId: nextAction.id,
      expectedVersion: blockedAction.version,
      status: "in_review",
      blockedReason: null,
      unblockResponsibleActorId: null,
      correlationId: ids.next(),
    });
    await expect(
      projects.listMyWork({
        actorId: "lead",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: expect.objectContaining({ id: nextAction.id }),
          kinds: ["review"],
        }),
      ]),
    );
    await expect(
      projects.transitionNextActionWorkflow({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        actionId: nextAction.id,
        expectedVersion: reviewAction.version,
        status: "done",
        blockedReason: null,
        unblockResponsibleActorId: null,
        correlationId: ids.next(),
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      projects.transitionNextActionWorkflow({
        actorId: "lead",
        organizationId: organization.id,
        projectId: project.id,
        actionId: nextAction.id,
        expectedVersion: reviewAction.version,
        status: "done",
        blockedReason: null,
        unblockResponsibleActorId: null,
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject({ workflowStatus: "done", version: 4 });
    await expect(
      projects.previewTaskDateChange({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        actionId: nextAction.id,
        expectedVersion: 4,
        proposedDueOn: "2026-09-22",
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_NEXT_ACTION_DATE_IMMUTABLE" });
    await expect(
      projects.listNextActions({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        correlationId: ids.next(),
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: nextAction.id,
          workflowStatus: "done",
          executorTeamId: executionTeam.id,
        }),
      ]),
    );
    const active = await projects.changeStatus({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      expectedVersion: project.version,
      status: "active",
      correlationId: ids.next(),
    });
    const completed = await projects.changeStatus({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      expectedVersion: active.version,
      status: "completed",
      correlationId: ids.next(),
    });
    const documentId = ids.next();
    const documentVersionId = ids.next();
    const document: InstitutionalDocument = {
      id: documentId,
      organizationId: organization.id,
      workspaceId: workspace.id,
      resourceType: "project",
      resourceId: project.id,
      classification: "internal",
      createdByActorId: "replacement",
      createdAt: new Date(),
    };
    const version: DocumentVersion = {
      id: documentVersionId,
      documentId,
      versionNumber: 1,
      originalName: "entrega.pdf",
      declaredContentType: "application/pdf",
      detectedContentType: "application/pdf",
      byteLength: 10,
      sha256: "a".repeat(64),
      status: "published",
      quarantineKey: "q",
      objectKey: "p",
      createdAt: document.createdAt,
      publishedAt: document.createdAt,
      rejectedAt: null,
      withdrawnAt: null,
      retentionUntil: null,
      evidenceStatus: "valid",
      supersedesVersionId: null,
      replacedByVersionId: null,
    };
    documentStore.documents.set(document.id, document);
    documentStore.versions.set(version.id, version);
    const foreignDocument: InstitutionalDocument = {
      ...document,
      id: ids.next(),
      resourceId: ids.next(),
    };
    const foreignVersion: DocumentVersion = {
      ...version,
      id: ids.next(),
      documentId: foreignDocument.id,
    };
    documentStore.documents.set(foreignDocument.id, foreignDocument);
    documentStore.versions.set(foreignVersion.id, foreignVersion);
    await expect(
      projects.acceptDeliverable({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        name: "Documento de otro proyecto",
        documentId: foreignDocument.id,
        documentVersionId: foreignVersion.id,
        correlationId: ids.next(),
      }),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    const deliverable = await projects.acceptDeliverable({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      name: "Informe final",
      documentId,
      documentVersionId,
      correlationId: ids.next(),
    });
    await expect(
      projects.close({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        outcomes: "Piloto completado",
        lessonsLearned: "Validar evidencia al inicio.",
        objectiveAssessment: "achieved",
        assessmentRationale:
          "La espera disminuyó conforme al objetivo acordado.",
        pendingItems: ["Medir adopción"],
        closureExceptions: [],
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_CLOSURE_EXCEPTION_INVALID" });
    const closure = await projects.close({
      actorId: "replacement",
      organizationId: organization.id,
      projectId: project.id,
      outcomes: "Piloto completado",
      lessonsLearned: "Validar evidencia al inicio.",
      objectiveAssessment: "achieved",
      assessmentRationale: "La espera disminuyó conforme al objetivo acordado.",
      pendingItems: ["Medir adopción"],
      closureExceptions: [
        {
          description: "Medir adopción",
          disposition: "transferred",
          responsibleActorId: "replacement",
          rationale: "El equipo de adopción continuará el seguimiento.",
        },
      ],
      correlationId: ids.next(),
    });
    expect(active.status).toBe("active");
    expect(execution.milestones).toHaveLength(1);
    expect(execution.actions).toHaveLength(2);
    expect(
      execution.actions.find((action) => action.id === nextAction.id),
    ).toMatchObject({
      priority: "high",
      executorTeamId: executionTeam.id,
      workflowStatus: "done",
      estimatedEffort: 12,
      effortUnit: "hours",
      periodStartOn: "2026-09-15",
      periodEndOn: "2026-09-20",
    });
    expect(completed.status).toBe("completed");
    expect(deliverable.documentVersionId).toBe(documentVersionId);
    expect(closures.closures.get(project.id)).toEqual(closure);
    expect(closure).toMatchObject({
      pendingItems: ["Medir adopción"],
      objectiveAssessment: "achieved",
      exceptions: [
        {
          description: "Medir adopción",
          disposition: "transferred",
          responsibleActorId: "replacement",
        },
      ],
    });
    await expect(
      projects.closureDossier({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject({
      project: { objective: "Reducir el tiempo de atención." },
      closure: {
        id: closure.id,
        objectiveAssessment: "achieved",
        exceptions: [{ description: "Medir adopción" }],
      },
    });
    await expect(
      projects.archive({
        actorId: "owner",
        organizationId: organization.id,
        projectId: project.id,
        expectedVersion: completed.version,
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject({ status: "archived" });
    await expect(
      projects.acceptDeliverable({
        actorId: "replacement",
        organizationId: organization.id,
        projectId: project.id,
        name: "Aceptación tardía",
        documentId,
        documentVersionId,
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "PROJECT_CLOSED_IMMUTABLE" });
    await expect(
      projects.previewTaskDateChange({
        ...dateChangeInput,
        expectedVersion: 2,
        proposedDueOn: "2026-09-22",
      }),
    ).rejects.toMatchObject({ code: "PROJECT_CLOSED_IMMUTABLE" });
    expect(projectStore.durableEvents.map((event) => event.eventType)).toEqual([
      "project.created.v1",
      "project.status_changed.v1",
      "project.status_changed.v1",
    ]);
    const projectHistory = await new InMemoryAuditHistoryStore(
      new InMemoryInitiativeAuditStore(),
      audit,
    ).list({
      organizationId: organization.id,
      resourceType: "project",
      resourceId: project.id,
    });
    expect(projectHistory.map((event) => event.action)).toEqual([
      "project.created_from_initiative.v1",
      "project.lead_assigned.v1",
      "project.lead_replaced.v1",
      "project.milestone_added.v1",
      "project.next_action_added.v1",
      "project.next_action_added.v1",
      "project.next_action_dependency_declared.v1",
      "project.next_action_date_changed.v1",
      "project.next_action_collaborator_added.v1",
      "project.next_action_workflow_changed.v1",
      "project.next_action_workflow_changed.v1",
      "project.next_action_workflow_changed.v1",
      "project.status_changed.v1",
      "project.status_changed.v1",
      "project.deliverable_accepted.v1",
      "project.closed.v1",
      "project.archived.v1",
    ]);
    expect(audit.events.map((event) => event.eventType)).toEqual([
      "project.created_from_initiative.v1",
      "project.lead_assigned.v1",
      "project.lead_replaced.v1",
      "project.milestone_added.v1",
      "project.next_action_added.v1",
      "project.next_action_added.v1",
      "project.next_action_dependency_declared.v1",
      "project.next_action_date_changed.v1",
      "project.next_action_collaborator_added.v1",
      "project.next_action_workflow_changed.v1",
      "project.next_action_workflow_changed.v1",
      "project.next_action_workflow_changed.v1",
      "project.status_changed.v1",
      "project.status_changed.v1",
      "project.deliverable_accepted.v1",
      "project.closed.v1",
      "project.archived.v1",
    ]);
    execution.actions.push({
      ...teamInboxAction,
      id: ids.next(),
      ownerActorId: "unscoped",
    });
    await expect(
      projects.listMyWork({
        actorId: "unscoped",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).resolves.toEqual([]);
  });
});
