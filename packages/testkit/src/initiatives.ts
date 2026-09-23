import type {
  TriageStandardStore,
  TriageStore,
  IntakeAssignmentStore,
  UnassignedIntakeException,
  EvaluationStandardStore,
  EvaluationStore,
  AuditEvent,
  AuditHistoryStore,
  AuditResourceType,
  InitiativeAuditEvent,
  InitiativeAuditStore,
  InitiativeStore,
  InitiativeRelationshipStore,
} from "@aether/application";
import type {
  EvaluationStandard,
  InitiativeTriage,
  IntakeResponsibility,
  TriageStandard,
  Initiative,
  InitiativeRelationship,
  InitiativeDecision,
  InitiativeEvaluation,
  EvaluationReviewerAssignment,
} from "@aether/domain";

export class InMemoryInitiativeStore implements InitiativeStore {
  readonly initiatives = new Map<string, Initiative>();
  async create(initiative: Initiative): Promise<void> {
    this.initiatives.set(initiative.id, initiative);
  }
  async findById(initiativeId: string): Promise<Initiative | null> {
    return this.initiatives.get(initiativeId) ?? null;
  }
  async list(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Initiative[]> {
    return [...this.initiatives.values()].filter(
      (initiative) =>
        initiative.organizationId === input.organizationId &&
        initiative.workspaceId === input.workspaceId,
    );
  }
  async save(input: {
    initiative: Initiative;
    expectedVersion: number;
  }): Promise<boolean> {
    const current = this.initiatives.get(input.initiative.id);
    if (!current || current.version !== input.expectedVersion) return false;
    this.initiatives.set(input.initiative.id, input.initiative);
    return true;
  }
}

export class InMemoryInitiativeAuditStore implements InitiativeAuditStore {
  readonly events: InitiativeAuditEvent[] = [];
  async record(event: InitiativeAuditEvent): Promise<void> {
    this.events.push(event);
  }
  async list(input: {
    organizationId: string;
    initiativeId: string;
  }): Promise<readonly InitiativeAuditEvent[]> {
    return this.events.filter(
      (event) =>
        event.organizationId === input.organizationId &&
        event.initiativeId === input.initiativeId,
    );
  }
}

export class InMemoryAuditHistoryStore implements AuditHistoryStore {
  constructor(
    private readonly initiativeAudit: InMemoryInitiativeAuditStore,
    private readonly projectAudit?: {
      events: readonly import("@aether/application").ProjectAuditEvent[];
    },
  ) {}
  async list(input: {
    organizationId: string;
    resourceType: AuditResourceType;
    resourceId: string;
  }): Promise<readonly AuditEvent[]> {
    const initiativeEvents = this.initiativeAudit.events.map((event) => {
      const evaluationId = stringPayload(event.payload, "evaluationId");
      const decisionId = stringPayload(event.payload, "decisionId");
      const resourceType: AuditResourceType = decisionId
        ? "decision"
        : evaluationId
          ? "evaluation"
          : "initiative";
      return {
        id: event.id,
        action: event.eventType,
        resourceType,
        resourceId: decisionId ?? evaluationId ?? event.initiativeId,
        actorId: event.actorId,
        organizationId: event.organizationId,
        workspaceId: event.workspaceId,
        occurredAt: event.occurredAt,
        result: "succeeded" as const,
        correlationId: event.correlationId,
        causationId: null,
        asyncEventId: null,
        payload: event.payload,
      };
    });
    const projectEvents = (this.projectAudit?.events ?? []).map((event) => ({
      id: event.id,
      action: event.eventType,
      resourceType: "project" as const,
      resourceId: event.projectId,
      actorId: event.actorId,
      organizationId: event.organizationId,
      workspaceId: event.workspaceId,
      occurredAt: event.occurredAt,
      result: "succeeded" as const,
      correlationId: event.correlationId,
      causationId: null,
      asyncEventId: null,
      payload: event.payload,
    }));
    return [...initiativeEvents, ...projectEvents]
      .filter(
        (event) =>
          event.organizationId === input.organizationId &&
          event.resourceType === input.resourceType &&
          event.resourceId === input.resourceId,
      )
      .sort(
        (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
      );
  }
}

function stringPayload(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

export class InMemoryEvaluationStandardStore implements EvaluationStandardStore {
  readonly standards = new Map<string, EvaluationStandard>();
  readonly adoptions: {
    id: string;
    standardId: string;
    adoptedByActorId: string;
    adoptedAt: Date;
  }[] = [];
  async create(standard: EvaluationStandard): Promise<void> {
    this.standards.set(standard.id, standard);
  }
  async findById(standardId: string): Promise<EvaluationStandard | null> {
    return this.standards.get(standardId) ?? null;
  }
  async list(input: {
    organizationId: string;
  }): Promise<readonly EvaluationStandard[]> {
    return [...this.standards.values()].filter(
      (standard) => standard.organizationId === input.organizationId,
    );
  }
  async activate(input: {
    organizationId: string;
    standardId: string;
    adoptionId: string;
    adoptedByActorId: string;
    adoptedAt: Date;
  }): Promise<void> {
    for (const [id, standard] of this.standards) {
      if (standard.organizationId === input.organizationId)
        this.standards.set(id, {
          ...standard,
          isActive: id === input.standardId,
        });
    }
    this.adoptions.push({
      id: input.adoptionId,
      standardId: input.standardId,
      adoptedByActorId: input.adoptedByActorId,
      adoptedAt: input.adoptedAt,
    });
  }
}

export class InMemoryEvaluationStore implements EvaluationStore {
  readonly conflicts = new Map<
    string,
    import("@aether/domain").EvaluationConflict
  >();
  async createConflict(
    conflict: import("@aether/domain").EvaluationConflict,
  ): Promise<void> {
    if (
      await this.findOpenConflict({
        initiativeId: conflict.initiativeId,
        actorId: conflict.declaredByActorId,
      })
    )
      throw new Error("Open evaluation conflict already exists");
    this.conflicts.set(conflict.id, conflict);
  }
  async findConflict(conflictId: string) {
    return this.conflicts.get(conflictId) ?? null;
  }
  async findOpenConflict(input: { initiativeId: string; actorId: string }) {
    return (
      [...this.conflicts.values()].find(
        (conflict) =>
          conflict.initiativeId === input.initiativeId &&
          conflict.declaredByActorId === input.actorId &&
          conflict.resolvedAt === null,
      ) ?? null
    );
  }
  async resolveConflict(input: {
    conflict: import("@aether/domain").EvaluationConflict;
  }) {
    const conflict = this.conflicts.get(input.conflict.id);
    if (!conflict || conflict.resolvedAt) return false;
    this.conflicts.set(input.conflict.id, input.conflict);
    return true;
  }
  readonly drafts = new Map<
    string,
    import("@aether/domain").InitiativeEvaluationDraft
  >();
  async findActiveDraft(initiativeId: string) {
    return (
      [...this.drafts.values()].find(
        (draft) =>
          draft.initiativeId === initiativeId && draft.status === "draft",
      ) ?? null
    );
  }
  async saveDraft(input: {
    draft: import("@aether/domain").InitiativeEvaluationDraft;
    expectedVersion: number | null;
  }): Promise<boolean> {
    const existing = await this.findActiveDraft(input.draft.initiativeId);
    if (
      existing?.version !== input.expectedVersion &&
      !(existing === null && input.expectedVersion === null)
    )
      return false;
    this.drafts.set(input.draft.id, input.draft);
    return true;
  }
  async publishDraft(input: {
    draftId: string;
    expectedVersion: number;
    evaluationId: string;
  }): Promise<boolean> {
    const draft = this.drafts.get(input.draftId);
    if (
      !draft ||
      draft.status !== "draft" ||
      draft.version !== input.expectedVersion
    )
      return false;
    this.drafts.set(input.draftId, {
      ...draft,
      status: "published",
      publishedEvaluationId: input.evaluationId,
    });
    return true;
  }
  readonly reviewerAssignments = new Map<
    string,
    EvaluationReviewerAssignment
  >();
  readonly evaluations = new Map<string, InitiativeEvaluation>();
  readonly decisions = new Map<string, InitiativeDecision>();
  async createReviewerAssignment(
    assignment: EvaluationReviewerAssignment,
  ): Promise<void> {
    if (await this.findActiveReviewerAssignment(assignment.initiativeId))
      throw new Error("Active evaluation reviewer assignment already exists");
    this.reviewerAssignments.set(assignment.id, assignment);
  }
  async findReviewerAssignment(
    assignmentId: string,
  ): Promise<EvaluationReviewerAssignment | null> {
    return this.reviewerAssignments.get(assignmentId) ?? null;
  }
  async findActiveReviewerAssignment(
    initiativeId: string,
  ): Promise<EvaluationReviewerAssignment | null> {
    return (
      [...this.reviewerAssignments.values()].find(
        (assignment) =>
          assignment.initiativeId === initiativeId &&
          assignment.status === "assigned",
      ) ?? null
    );
  }
  async updateReviewerAssignment(
    assignment: EvaluationReviewerAssignment,
  ): Promise<void> {
    this.reviewerAssignments.set(assignment.id, assignment);
  }
  async createEvaluation(evaluation: InitiativeEvaluation): Promise<void> {
    this.evaluations.set(evaluation.id, evaluation);
  }
  async findEvaluation(
    evaluationId: string,
  ): Promise<InitiativeEvaluation | null> {
    return this.evaluations.get(evaluationId) ?? null;
  }
  async updateEvaluation(evaluation: InitiativeEvaluation): Promise<void> {
    this.evaluations.set(evaluation.id, evaluation);
  }
  async hasDecisionForEvaluation(evaluationId: string): Promise<boolean> {
    return [...this.decisions.values()].some(
      (decision) => decision.evaluationId === evaluationId,
    );
  }
  async createDecision(decision: InitiativeDecision): Promise<void> {
    this.decisions.set(decision.id, decision);
  }
  async findDecision(decisionId: string): Promise<InitiativeDecision | null> {
    return this.decisions.get(decisionId) ?? null;
  }
  async updateDecisionCondition(input: {
    decisionId: string;
    condition: import("@aether/domain").DecisionCondition;
  }): Promise<void> {
    const decision = this.decisions.get(input.decisionId);
    if (!decision) throw new Error("Decision condition not found");
    this.decisions.set(input.decisionId, {
      ...decision,
      conditions: (decision.conditions ?? []).map((condition) =>
        condition.id === input.condition.id ? input.condition : condition,
      ),
    });
  }
}

export class InMemoryTriageStandardStore implements TriageStandardStore {
  readonly standards = new Map<string, TriageStandard>();
  readonly adoptions: {
    id: string;
    standardId: string;
    adoptedByActorId: string;
    adoptedAt: Date;
  }[] = [];
  async create(standard: TriageStandard): Promise<void> {
    this.standards.set(standard.id, standard);
  }
  async findById(standardId: string): Promise<TriageStandard | null> {
    return this.standards.get(standardId) ?? null;
  }
  async list(input: {
    organizationId: string;
  }): Promise<readonly TriageStandard[]> {
    return [...this.standards.values()].filter(
      (standard) => standard.organizationId === input.organizationId,
    );
  }
  async activate(input: {
    organizationId: string;
    standardId: string;
    adoptionId: string;
    adoptedByActorId: string;
    adoptedAt: Date;
  }): Promise<void> {
    for (const [id, standard] of this.standards) {
      if (standard.organizationId === input.organizationId)
        this.standards.set(id, {
          ...standard,
          isActive: id === input.standardId,
        });
    }
    this.adoptions.push({
      id: input.adoptionId,
      standardId: input.standardId,
      adoptedByActorId: input.adoptedByActorId,
      adoptedAt: input.adoptedAt,
    });
  }
}

export class InMemoryTriageStore implements TriageStore {
  readonly triages = new Map<string, InitiativeTriage>();
  constructor(private readonly audit: InitiativeAuditStore) {}
  async createWithAudit(input: {
    triage: InitiativeTriage;
    auditEvent: InitiativeAuditEvent;
  }): Promise<void> {
    this.triages.set(input.triage.id, input.triage);
    try {
      await this.audit.record(input.auditEvent);
    } catch (error) {
      this.triages.delete(input.triage.id);
      throw error;
    }
  }
  async findById(triageId: string): Promise<InitiativeTriage | null> {
    return this.triages.get(triageId) ?? null;
  }
}

export class InMemoryIntakeAssignmentStore implements IntakeAssignmentStore {
  readonly assignments = new Map<string, IntakeResponsibility>();
  constructor(
    private readonly initiatives: InMemoryInitiativeStore,
    private readonly audit: InitiativeAuditStore,
  ) {}
  async createWithAudit(input: {
    assignment: IntakeResponsibility;
    auditEvent: InitiativeAuditEvent;
  }): Promise<void> {
    if (await this.findActiveByInitiative(input.assignment.initiativeId))
      throw new Error("Active intake assignment already exists");
    this.assignments.set(input.assignment.id, input.assignment);
    try {
      await this.audit.record(input.auditEvent);
    } catch (error) {
      this.assignments.delete(input.assignment.id);
      throw error;
    }
  }
  async findActiveByInitiative(
    initiativeId: string,
  ): Promise<IntakeResponsibility | null> {
    return (
      [...this.assignments.values()].find(
        (assignment) => assignment.initiativeId === initiativeId,
      ) ?? null
    );
  }
  async listUnassigned(input: {
    organizationId: string;
  }): Promise<readonly UnassignedIntakeException[]> {
    return [...this.initiatives.initiatives.values()]
      .filter(
        (initiative) =>
          initiative.organizationId === input.organizationId &&
          initiative.status === "presented" &&
          ![...this.assignments.values()].some(
            (assignment) => assignment.initiativeId === initiative.id,
          ),
      )
      .map((initiative) => ({
        organizationId: initiative.organizationId,
        workspaceId: initiative.workspaceId,
        initiativeId: initiative.id,
        title: initiative.title,
        updatedAt: initiative.updatedAt,
      }))
      .sort(
        (left, right) => left.updatedAt.getTime() - right.updatedAt.getTime(),
      );
  }
}

export class InMemoryInitiativeRelationshipStore implements InitiativeRelationshipStore {
  constructor(
    private readonly initiatives: InMemoryInitiativeStore,
    private readonly audit: InMemoryInitiativeAuditStore,
  ) {}
  readonly relationships = new Map<string, InitiativeRelationship>();
  async createWithAudit(input: {
    relationship: InitiativeRelationship;
    expectedSourceVersion: number;
    auditEvent: InitiativeAuditEvent;
  }): Promise<boolean> {
    const relationship = input.relationship;
    const source = this.initiatives.initiatives.get(
      relationship.sourceInitiativeId,
    );
    if (!source || source.version !== input.expectedSourceVersion) return false;
    if (
      [...this.relationships.values()].some(
        (existing) =>
          existing.sourceInitiativeId === relationship.sourceInitiativeId &&
          existing.targetInitiativeId === relationship.targetInitiativeId,
      )
    )
      throw new Error("Initiative relationship already exists");
    this.relationships.set(relationship.id, relationship);
    this.initiatives.initiatives.set(relationship.sourceInitiativeId, {
      ...source,
      version: source.version + 1,
      updatedAt: relationship.declaredAt,
    });
    await this.audit.record(input.auditEvent);
    return true;
  }
  async list(input: {
    organizationId: string;
    initiativeId: string;
  }): Promise<readonly InitiativeRelationship[]> {
    return [...this.relationships.values()].filter(
      (relationship) =>
        relationship.organizationId === input.organizationId &&
        (relationship.sourceInitiativeId === input.initiativeId ||
          relationship.targetInitiativeId === input.initiativeId),
    );
  }
}
