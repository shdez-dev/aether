import {
  EvaluationDomainError,
  decideInitiative,
  exemptDecisionCondition,
  fulfillDecisionCondition,
  evaluateInitiative,
  publishEvaluationStandard,
  transitionInitiative,
  type EvaluationCriterion,
  type EvaluationMaturityLevel,
  type DecisionCondition,
  type InitiativeDecision,
  type InitiativeEvaluation,
  type EvaluationStandard,
  type EvaluationReviewerAssignment,
  type EvaluationConflict,
  type InitiativeEvaluationDraft,
  type EvaluationResultInput,
} from "@aether/domain";

import type {
  InitiativeAuditEvent,
  InitiativeAuditStore,
  InitiativeStore,
} from "./initiatives.js";
import { InitiativeVersionConflictError } from "./initiatives.js";
import {
  AccessDeniedError,
  assertWorkspaceWritable,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";
import type { TemporaryAccessGrantAuthorizer } from "./access-grants.js";
import type { NotificationService } from "./notifications.js";
import type { DurableDomainEvent } from "./outbox.js";

export interface EvaluationStandardStore {
  create(standard: EvaluationStandard): Promise<void>;
  findById(standardId: string): Promise<EvaluationStandard | null>;
  list(input: {
    organizationId: string;
  }): Promise<readonly EvaluationStandard[]>;
  activate(input: {
    organizationId: string;
    standardId: string;
    adoptionId: string;
    adoptedByActorId: string;
    adoptedAt: Date;
  }): Promise<void>;
}
export interface EvaluationStore {
  createConflict(conflict: EvaluationConflict): Promise<void>;
  findConflict(conflictId: string): Promise<EvaluationConflict | null>;
  findOpenConflict(input: {
    initiativeId: string;
    actorId: string;
  }): Promise<EvaluationConflict | null>;
  resolveConflict(input: { conflict: EvaluationConflict }): Promise<boolean>;
  findActiveDraft(
    initiativeId: string,
  ): Promise<InitiativeEvaluationDraft | null>;
  saveDraft(input: {
    draft: InitiativeEvaluationDraft;
    expectedVersion: number | null;
  }): Promise<boolean>;
  saveDraftWithAudit?(input: {
    draft: InitiativeEvaluationDraft;
    expectedVersion: number | null;
    auditEvent: InitiativeAuditEvent;
  }): Promise<boolean>;
  publishDraft(input: {
    draftId: string;
    expectedVersion: number;
    evaluationId: string;
  }): Promise<boolean>;
  commitReview?(input: {
    initiative: import("@aether/domain").Initiative;
    expectedVersion: number;
    evaluation: InitiativeEvaluation;
    assignment: EvaluationReviewerAssignment;
    auditEvent: InitiativeAuditEvent;
    event: DurableDomainEvent;
    draft?: { id: string; expectedVersion: number };
  }): Promise<boolean>;
  commitDecision?(input: {
    initiative: import("@aether/domain").Initiative;
    expectedVersion: number;
    decision: InitiativeDecision;
    auditEvent: InitiativeAuditEvent;
    event: DurableDomainEvent;
  }): Promise<boolean>;
  createReviewerAssignment(
    assignment: EvaluationReviewerAssignment,
  ): Promise<void>;
  findReviewerAssignment(
    assignmentId: string,
  ): Promise<EvaluationReviewerAssignment | null>;
  findActiveReviewerAssignment(
    initiativeId: string,
  ): Promise<EvaluationReviewerAssignment | null>;
  updateReviewerAssignment(
    assignment: EvaluationReviewerAssignment,
  ): Promise<void>;
  createEvaluation(evaluation: InitiativeEvaluation): Promise<void>;
  findEvaluation(evaluationId: string): Promise<InitiativeEvaluation | null>;
  updateEvaluation(evaluation: InitiativeEvaluation): Promise<void>;
  hasDecisionForEvaluation(evaluationId: string): Promise<boolean>;
  createDecision(decision: InitiativeDecision): Promise<void>;
  findDecision(decisionId: string): Promise<InitiativeDecision | null>;
  updateDecisionCondition(input: {
    decisionId: string;
    condition: DecisionCondition;
  }): Promise<void>;
}
export interface EvaluationIdGenerator {
  next(): string;
}
export interface EvaluationClock {
  now(): Date;
}

export class EvaluationService {
  constructor(
    private readonly dependencies: {
      standards: EvaluationStandardStore;
      evaluations: EvaluationStore;
      initiatives: InitiativeStore;
      audit: InitiativeAuditStore;
      tenancy: TenantStore;
      accessGrants?: TemporaryAccessGrantAuthorizer;
      notifications?: NotificationService;
      ids: EvaluationIdGenerator;
      clock: EvaluationClock;
    },
  ) {}

  async publishStandard(input: {
    actorId: string;
    organizationId: string;
    name: string;
    version: number;
    criteria: readonly EvaluationCriterion[];
    maturityLevels?: readonly EvaluationMaturityLevel[];
  }): Promise<EvaluationStandard> {
    await this.assertOwner(input.actorId, input.organizationId);
    const standard = publishEvaluationStandard({
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      name: input.name,
      version: input.version,
      criteria: input.criteria,
      maturityLevels: input.maturityLevels ?? [],
      publishedAt: this.dependencies.clock.now(),
      publishedByActorId: input.actorId,
    });
    await this.dependencies.standards.create(standard);
    return standard;
  }

  async activateStandard(input: {
    actorId: string;
    organizationId: string;
    standardId: string;
  }): Promise<void> {
    await this.assertOwner(input.actorId, input.organizationId);
    const standard = await this.dependencies.standards.findById(
      input.standardId,
    );
    if (!standard || standard.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    await this.dependencies.standards.activate({
      organizationId: input.organizationId,
      standardId: input.standardId,
      adoptionId: this.dependencies.ids.next(),
      adoptedByActorId: input.actorId,
      adoptedAt: this.dependencies.clock.now(),
    });
  }
  async listStandards(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly EvaluationStandard[]> {
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    return this.dependencies.standards.list(input);
  }
  async getDraft(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
  }): Promise<InitiativeEvaluationDraft> {
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await this.assertAssignedReviewerOrOwner(
      initiative.id,
      input.actorId,
      input.organizationId,
    );
    const draft = await this.dependencies.evaluations.findActiveDraft(
      initiative.id,
    );
    if (!draft) throw new EvaluationDomainError("EVALUATION_DRAFT_NOT_FOUND");
    return draft;
  }
  async saveDraft(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    expectedInitiativeVersion: number;
    expectedDraftVersion: number | null;
    standardId: string;
    results: readonly EvaluationResultInput[];
    findings?: readonly string[];
    recommendation?: string | null;
    correlationId: string;
  }): Promise<InitiativeEvaluationDraft> {
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    await this.assertAssignedReviewer(
      initiative.id,
      input.actorId,
      input.organizationId,
    );
    if (initiative.version !== input.expectedInitiativeVersion)
      throw new InitiativeVersionConflictError();
    if (initiative.status !== "presented")
      throw new EvaluationDomainError("EVALUATION_INCOMPLETE");
    const standard = await this.requireActiveStandard(
      input.standardId,
      input.organizationId,
    );
    const existing = await this.dependencies.evaluations.findActiveDraft(
      initiative.id,
    );
    if (
      existing?.version !== input.expectedDraftVersion &&
      !(existing === null && input.expectedDraftVersion === null)
    )
      throw new EvaluationDomainError("EVALUATION_DRAFT_VERSION_CONFLICT");
    if (
      existing &&
      (existing.standardId !== standard.id ||
        existing.standardVersion !== standard.version)
    )
      throw new EvaluationDomainError("EVALUATION_DRAFT_STANDARD_CHANGED");
    evaluateInitiative({
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      initiativeVersion: initiative.version,
      standard,
      results: input.results,
      findings: input.findings ?? [],
      recommendation: input.recommendation ?? null,
      evaluatedByActorId: input.actorId,
      evaluatedAt: this.dependencies.clock.now(),
    });
    const draft: InitiativeEvaluationDraft = {
      id: existing?.id ?? this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      initiativeVersion: initiative.version,
      standardId: standard.id,
      standardVersion: standard.version,
      results: input.results.map((result) => ({
        ...result,
        evidence: [...result.evidence],
      })),
      findings: [...(input.findings ?? [])],
      recommendation: input.recommendation ?? null,
      version: existing ? existing.version + 1 : 0,
      status: "draft",
      updatedByActorId: input.actorId,
      updatedAt: this.dependencies.clock.now(),
      publishedEvaluationId: null,
    };
    await this.persistDraft(
      draft,
      existing?.version ?? null,
      this.makeAuditEvent(
        initiative,
        input.actorId,
        input.correlationId,
        "initiative.evaluation_draft_saved.v1",
        initiative.status,
        initiative.status,
        {
          draftId: draft.id,
          draftVersion: draft.version,
          standardId: standard.id,
        },
      ),
    );
    return draft;
  }
  async migrateDraft(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    expectedDraftVersion: number;
    standardId: string;
    mappings: readonly { fromCriterionId: string; toCriterionId: string }[];
    discardedCriterionIds: readonly string[];
    reason: string;
    correlationId: string;
  }): Promise<InitiativeEvaluationDraft> {
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    await this.assertAssignedReviewer(
      initiative.id,
      input.actorId,
      input.organizationId,
    );
    if (initiative.status !== "presented")
      throw new EvaluationDomainError("EVALUATION_INCOMPLETE");
    const draft = await this.dependencies.evaluations.findActiveDraft(
      initiative.id,
    );
    if (!draft) throw new EvaluationDomainError("EVALUATION_DRAFT_NOT_FOUND");
    if (draft.version !== input.expectedDraftVersion)
      throw new EvaluationDomainError("EVALUATION_DRAFT_VERSION_CONFLICT");
    if (draft.initiativeVersion !== initiative.version)
      throw new InitiativeVersionConflictError();
    const standard = await this.requireActiveStandard(
      input.standardId,
      input.organizationId,
    );
    if (draft.standardId === standard.id)
      throw new EvaluationDomainError("EVALUATION_DRAFT_MIGRATION_INVALID");
    const sourceIds = draft.results.map((result) => result.criterionId);
    const usedSourceIds = [
      ...input.mappings.map((item) => item.fromCriterionId),
      ...input.discardedCriterionIds,
    ];
    const targets = input.mappings.map((item) => item.toCriterionId);
    if (
      !input.reason.trim() ||
      new Set(usedSourceIds).size !== usedSourceIds.length ||
      new Set(targets).size !== targets.length ||
      sourceIds.length !== usedSourceIds.length ||
      usedSourceIds.some((id) => !sourceIds.includes(id)) ||
      targets.some(
        (id) => !standard.criteria.some((criterion) => criterion.id === id),
      )
    )
      throw new EvaluationDomainError("EVALUATION_DRAFT_MIGRATION_INVALID");
    const results = input.mappings.map((item) => {
      const source = draft.results.find(
        (result) => result.criterionId === item.fromCriterionId,
      )!;
      return { ...source, criterionId: item.toCriterionId };
    });
    evaluateInitiative({
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      initiativeVersion: initiative.version,
      standard,
      results,
      evaluatedByActorId: input.actorId,
      evaluatedAt: this.dependencies.clock.now(),
    });
    const migrated: InitiativeEvaluationDraft = {
      ...draft,
      standardId: standard.id,
      standardVersion: standard.version,
      results,
      version: draft.version + 1,
      updatedByActorId: input.actorId,
      updatedAt: this.dependencies.clock.now(),
    };
    await this.persistDraft(
      migrated,
      draft.version,
      this.makeAuditEvent(
        initiative,
        input.actorId,
        input.correlationId,
        "initiative.evaluation_draft_migrated.v1",
        initiative.status,
        initiative.status,
        {
          draftId: draft.id,
          oldStandardId: draft.standardId,
          newStandardId: standard.id,
          mappings: input.mappings,
          discardedCriterionIds: input.discardedCriterionIds,
          reason: input.reason,
        },
      ),
    );
    return migrated;
  }
  async publishDraft(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    expectedInitiativeVersion: number;
    expectedDraftVersion: number;
    correlationId: string;
  }): Promise<InitiativeEvaluation> {
    const draft = await this.getDraft(input);
    if (draft.version !== input.expectedDraftVersion)
      throw new EvaluationDomainError("EVALUATION_DRAFT_VERSION_CONFLICT");
    if (draft.initiativeVersion !== input.expectedInitiativeVersion)
      throw new InitiativeVersionConflictError();
    await this.requireActiveStandard(draft.standardId, input.organizationId);
    return this.review({
      actorId: input.actorId,
      organizationId: input.organizationId,
      initiativeId: input.initiativeId,
      standardId: draft.standardId,
      expectedVersion: input.expectedInitiativeVersion,
      correlationId: input.correlationId,
      results: draft.results,
      findings: draft.findings,
      recommendation: draft.recommendation,
      draft: { id: draft.id, expectedVersion: draft.version },
    });
  }
  async getEvaluation(input: {
    actorId: string;
    organizationId: string;
    evaluationId: string;
    correlationId?: string | undefined;
  }): Promise<InitiativeEvaluation> {
    const evaluation = await this.dependencies.evaluations.findEvaluation(
      input.evaluationId,
    );
    if (!evaluation || evaluation.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    await this.assertResourceRead({
      actorId: input.actorId,
      organizationId: evaluation.organizationId,
      workspaceId: evaluation.workspaceId,
      resourceType: "evaluation",
      resourceId: evaluation.id,
      correlationId: input.correlationId,
    });
    return evaluation;
  }
  async assignReviewer(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    reviewerActorId: string;
    correlationId: string;
  }): Promise<EvaluationReviewerAssignment> {
    await this.assertOwner(input.actorId, input.organizationId);
    await this.assertOrganizationManager(
      input.reviewerActorId,
      input.organizationId,
    );
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    if (initiative.status !== "presented")
      throw new EvaluationDomainError("EVALUATION_INCOMPLETE");
    if (
      await this.dependencies.evaluations.findActiveReviewerAssignment(
        initiative.id,
      )
    )
      throw new EvaluationDomainError("EVALUATION_REVIEWER_NOT_ASSIGNED");
    const now = this.dependencies.clock.now();
    const assignment: EvaluationReviewerAssignment = {
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      assignedActorId: input.reviewerActorId,
      assignedByActorId: input.actorId,
      assignedAt: now,
      status: "assigned",
      statusChangedAt: now,
      statusChangedByActorId: input.actorId,
      reason: null,
    };
    await this.dependencies.evaluations.createReviewerAssignment(assignment);
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.evaluation_reviewer_assigned.v1",
      initiative.status,
      initiative.status,
      {
        assignmentId: assignment.id,
        reviewerActorId: assignment.assignedActorId,
      },
    );
    return assignment;
  }
  async abstainFromReview(input: {
    actorId: string;
    organizationId: string;
    assignmentId: string;
    reason: string;
    correlationId: string;
  }): Promise<EvaluationReviewerAssignment> {
    const assignment = await this.requireReviewerAssignment(
      input.assignmentId,
      input.organizationId,
    );
    if (
      assignment.status !== "assigned" ||
      assignment.assignedActorId !== input.actorId
    )
      throw new EvaluationDomainError("EVALUATION_REVIEWER_NOT_ASSIGNED");
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    const initiative = await this.requireInitiative(
      assignment.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    const updated: EvaluationReviewerAssignment = {
      ...assignment,
      status: "abstained",
      statusChangedAt: this.dependencies.clock.now(),
      statusChangedByActorId: input.actorId,
      reason: input.reason,
    };
    await this.dependencies.evaluations.updateReviewerAssignment(updated);
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.evaluation_reviewer_abstained.v1",
      initiative.status,
      initiative.status,
      { assignmentId: assignment.id },
    );
    return updated;
  }
  async declareConflict(input: {
    actorId: string;
    organizationId: string;
    assignmentId: string;
    reason: string;
    correlationId: string;
  }): Promise<EvaluationConflict> {
    const assignment = await this.requireReviewerAssignment(
      input.assignmentId,
      input.organizationId,
    );
    if (
      assignment.status !== "assigned" ||
      assignment.assignedActorId !== input.actorId
    )
      throw new EvaluationDomainError("EVALUATION_REVIEWER_NOT_ASSIGNED");
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    const initiative = await this.requireInitiative(
      assignment.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    if (
      await this.dependencies.evaluations.findOpenConflict({
        initiativeId: initiative.id,
        actorId: input.actorId,
      })
    )
      throw new EvaluationDomainError("EVALUATION_CONFLICT_ALREADY_DECLARED");
    const conflict: EvaluationConflict = {
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      assignmentId: assignment.id,
      declaredByActorId: input.actorId,
      reason: input.reason,
      declaredAt: this.dependencies.clock.now(),
      resolvedByActorId: null,
      resolution: null,
      resolvedAt: null,
    };
    await this.dependencies.evaluations.createConflict(conflict);
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.evaluation_conflict_declared.v1",
      initiative.status,
      initiative.status,
      { conflictId: conflict.id, assignmentId: assignment.id },
    );
    return conflict;
  }
  async resolveConflict(input: {
    actorId: string;
    organizationId: string;
    conflictId: string;
    resolution: string;
    correlationId: string;
  }): Promise<EvaluationConflict> {
    await this.assertOwner(input.actorId, input.organizationId);
    const conflict = await this.dependencies.evaluations.findConflict(
      input.conflictId,
    );
    if (!conflict || conflict.organizationId !== input.organizationId)
      throw new EvaluationDomainError("EVALUATION_CONFLICT_NOT_FOUND");
    if (conflict.resolvedAt)
      throw new EvaluationDomainError("EVALUATION_CONFLICT_NOT_FOUND");
    const initiative = await this.requireInitiative(
      conflict.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    const resolved: EvaluationConflict = {
      ...conflict,
      resolvedByActorId: input.actorId,
      resolution: input.resolution,
      resolvedAt: this.dependencies.clock.now(),
    };
    if (
      !(await this.dependencies.evaluations.resolveConflict({
        conflict: resolved,
      }))
    )
      throw new EvaluationDomainError("EVALUATION_CONFLICT_NOT_FOUND");
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.evaluation_conflict_resolved.v1",
      initiative.status,
      initiative.status,
      { conflictId: conflict.id },
    );
    return resolved;
  }
  async reassignReview(input: {
    actorId: string;
    organizationId: string;
    assignmentId: string;
    reviewerActorId: string;
    reason: string;
    correlationId: string;
  }): Promise<EvaluationReviewerAssignment> {
    await this.assertOwner(input.actorId, input.organizationId);
    await this.assertOrganizationManager(
      input.reviewerActorId,
      input.organizationId,
    );
    const assignment = await this.requireReviewerAssignment(
      input.assignmentId,
      input.organizationId,
    );
    if (assignment.status !== "abstained")
      throw new EvaluationDomainError("EVALUATION_ASSIGNMENT_NOT_ABSTAINED");
    const initiative = await this.requireInitiative(
      assignment.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    const now = this.dependencies.clock.now();
    await this.dependencies.evaluations.updateReviewerAssignment({
      ...assignment,
      status: "reassigned",
      statusChangedAt: now,
      statusChangedByActorId: input.actorId,
      reason: input.reason,
    });
    const reassignment: EvaluationReviewerAssignment = {
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      assignedActorId: input.reviewerActorId,
      assignedByActorId: input.actorId,
      assignedAt: now,
      status: "assigned",
      statusChangedAt: now,
      statusChangedByActorId: input.actorId,
      reason: null,
    };
    await this.dependencies.evaluations.createReviewerAssignment(reassignment);
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.evaluation_reviewer_reassigned.v1",
      initiative.status,
      initiative.status,
      {
        assignmentId: assignment.id,
        reassignmentId: reassignment.id,
        reviewerActorId: reassignment.assignedActorId,
      },
    );
    return reassignment;
  }
  async escalateReviewAbstention(input: {
    actorId: string;
    organizationId: string;
    assignmentId: string;
    reason: string;
    correlationId: string;
  }): Promise<EvaluationReviewerAssignment> {
    await this.assertOwner(input.actorId, input.organizationId);
    const assignment = await this.requireReviewerAssignment(
      input.assignmentId,
      input.organizationId,
    );
    if (assignment.status !== "abstained")
      throw new EvaluationDomainError("EVALUATION_ASSIGNMENT_NOT_ABSTAINED");
    const initiative = await this.requireInitiative(
      assignment.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    const updated: EvaluationReviewerAssignment = {
      ...assignment,
      status: "escalated",
      statusChangedAt: this.dependencies.clock.now(),
      statusChangedByActorId: input.actorId,
      reason: input.reason,
    };
    await this.dependencies.evaluations.updateReviewerAssignment(updated);
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.evaluation_reviewer_abstention_escalated.v1",
      initiative.status,
      initiative.status,
      { assignmentId: assignment.id },
    );
    return updated;
  }
  async getDecision(input: {
    actorId: string;
    organizationId: string;
    decisionId: string;
    correlationId?: string | undefined;
  }): Promise<InitiativeDecision> {
    const decision = await this.dependencies.evaluations.findDecision(
      input.decisionId,
    );
    if (!decision || decision.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    await this.assertResourceRead({
      actorId: input.actorId,
      organizationId: decision.organizationId,
      workspaceId: decision.workspaceId,
      resourceType: "decision",
      resourceId: decision.id,
      correlationId: input.correlationId,
    });
    return decision;
  }
  async annulEvaluation(input: {
    actorId: string;
    organizationId: string;
    evaluationId: string;
    reason: string;
    correlationId: string;
  }): Promise<InitiativeEvaluation> {
    await this.assertOwner(input.actorId, input.organizationId);
    const evaluation = await this.dependencies.evaluations.findEvaluation(
      input.evaluationId,
    );
    if (!evaluation || evaluation.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    if (evaluation.annulledAt)
      throw new EvaluationDomainError("EVALUATION_ALREADY_ANNULLED");
    if (
      await this.dependencies.evaluations.hasDecisionForEvaluation(
        evaluation.id,
      )
    )
      throw new EvaluationDomainError("EVALUATION_ALREADY_DECIDED");
    const initiative = await this.requireInitiative(
      evaluation.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    const updated = {
      ...evaluation,
      annulledByActorId: input.actorId,
      annulledAt: this.dependencies.clock.now(),
      annulmentReason: input.reason,
    };
    await this.dependencies.evaluations.updateEvaluation(updated);
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.evaluation_annulled.v1",
      initiative.status,
      initiative.status,
      { evaluationId: evaluation.id },
    );
    return updated;
  }

  async review(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    standardId: string;
    expectedVersion: number;
    correlationId: string;
    results: readonly {
      criterionId: string;
      assessment: "met" | "not_met" | "not_applicable" | null;
      evidence: readonly string[];
    }[];
    findings?: readonly string[];
    recommendation?: string | null;
    draft?: { id: string; expectedVersion: number };
  }): Promise<InitiativeEvaluation> {
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    if (initiative.status !== "presented")
      throw new EvaluationDomainError("EVALUATION_INCOMPLETE");
    const assignment =
      await this.dependencies.evaluations.findActiveReviewerAssignment(
        initiative.id,
      );
    if (!assignment || assignment.assignedActorId !== input.actorId)
      throw new EvaluationDomainError("EVALUATION_REVIEWER_NOT_ASSIGNED");
    if (
      await this.dependencies.evaluations.findOpenConflict({
        initiativeId: initiative.id,
        actorId: input.actorId,
      })
    )
      throw new EvaluationDomainError("EVALUATION_CONFLICT_UNRESOLVED");
    const activeDraft = await this.dependencies.evaluations.findActiveDraft(
      initiative.id,
    );
    if (
      activeDraft &&
      (activeDraft.id !== input.draft?.id ||
        activeDraft.version !== input.draft.expectedVersion)
    )
      throw new EvaluationDomainError("EVALUATION_DRAFT_EXISTS");
    if (!activeDraft && input.draft)
      throw new EvaluationDomainError("EVALUATION_DRAFT_NOT_FOUND");
    if (initiative.version !== input.expectedVersion)
      throw new InitiativeVersionConflictError();
    const standard = await this.dependencies.standards.findById(
      input.standardId,
    );
    if (
      !standard ||
      standard.organizationId !== input.organizationId ||
      !standard.isActive
    )
      throw new EvaluationDomainError("INVALID_EVALUATION_CRITERIA");
    const now = this.dependencies.clock.now();
    const evaluation = evaluateInitiative({
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      initiativeVersion: initiative.version,
      standard,
      results: input.results,
      findings: input.findings ?? [],
      recommendation: input.recommendation ?? null,
      evaluatedByActorId: input.actorId,
      evaluatedAt: now,
    });
    if (evaluation.coverage.percentage !== 100)
      throw new EvaluationDomainError("EVALUATION_INCOMPLETE");
    const reviewing = transitionInitiative(initiative, "under_review", now);
    const completedAssignment = {
      ...assignment,
      status: "completed",
      statusChangedAt: now,
      statusChangedByActorId: input.actorId,
      reason: null,
    } as const;
    const auditEvent = this.makeAuditEvent(
      reviewing,
      input.actorId,
      input.correlationId,
      "initiative.evaluated.v1",
      initiative.status,
      reviewing.status,
      {
        evaluationId: evaluation.id,
        standardId: evaluation.standardId,
        standardVersion: evaluation.standardVersion,
        coverage: evaluation.coverage,
        evidenceCount: evaluation.criteria.reduce(
          (count, result) => count + result.evidence.length,
          0,
        ),
      },
    );
    if (this.dependencies.evaluations.commitReview) {
      if (
        !(await this.dependencies.evaluations.commitReview({
          initiative: reviewing,
          expectedVersion: initiative.version,
          evaluation,
          assignment: completedAssignment,
          auditEvent,
          event: this.durableEvent(reviewing, auditEvent),
          ...(input.draft ? { draft: input.draft } : {}),
        }))
      )
        throw new InitiativeVersionConflictError();
    } else {
      if (
        !(await this.dependencies.initiatives.save({
          initiative: reviewing,
          expectedVersion: initiative.version,
        }))
      )
        throw new InitiativeVersionConflictError();
      await this.dependencies.evaluations.createEvaluation(evaluation);
      await this.dependencies.evaluations.updateReviewerAssignment(
        completedAssignment,
      );
      if (
        input.draft &&
        !(await this.dependencies.evaluations.publishDraft({
          draftId: input.draft.id,
          expectedVersion: input.draft.expectedVersion,
          evaluationId: evaluation.id,
        }))
      )
        throw new EvaluationDomainError("EVALUATION_DRAFT_VERSION_CONFLICT");
      await this.dependencies.audit.record(auditEvent);
    }
    return evaluation;
  }

  async decide(input: {
    actorId: string;
    organizationId: string;
    initiativeId: string;
    evaluationId: string;
    expectedVersion: number;
    outcome: InitiativeDecision["outcome"];
    rationale: string;
    evidence: readonly string[];
    nextReviewOn?: string | null | undefined;
    conditions?:
      | readonly {
          description: string;
          responsibleActorId: string;
          dueOn: string;
        }[]
      | undefined;
    correlationId: string;
  }): Promise<InitiativeDecision> {
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    const evaluation = await this.dependencies.evaluations.findEvaluation(
      input.evaluationId,
    );
    if (!evaluation) throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    if (evaluation.annulledAt)
      throw new EvaluationDomainError("EVALUATION_ANNULLED");
    if (evaluation.evaluatedByActorId === input.actorId)
      throw new EvaluationConflictOfInterestError();
    await this.assertOwner(input.actorId, input.organizationId);
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    if (initiative.version !== input.expectedVersion)
      throw new InitiativeVersionConflictError();
    if (initiative.status !== "under_review")
      throw new EvaluationDomainError("EVALUATION_INCOMPLETE");
    const now = this.dependencies.clock.now();
    for (const condition of input.conditions ?? [])
      await this.assertOrganizationMember(
        condition.responsibleActorId,
        input.organizationId,
      );
    const decision = decideInitiative({
      id: this.dependencies.ids.next(),
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      evaluationId: evaluation.id,
      outcome: input.outcome,
      rationale: input.rationale,
      evidence: [...input.evidence],
      decidedByActorId: input.actorId,
      decidedAt: now,
      nextReviewOn: input.nextReviewOn ?? null,
      evaluation,
      conditions: (input.conditions ?? []).map((condition) => ({
        id: this.dependencies.ids.next(),
        ...condition,
        status: "pending" as const,
        resolvedByActorId: null,
        resolvedAt: null,
        resolutionNote: null,
      })),
    });
    const decided = transitionInitiative(initiative, decision.outcome, now);
    const auditEvent = this.makeAuditEvent(
      decided,
      input.actorId,
      input.correlationId,
      "initiative.decided.v2",
      initiative.status,
      decided.status,
      {
        decisionId: decision.id,
        evaluationId: decision.evaluationId,
        standardId: decision.standardId,
        standardVersion: decision.standardVersion,
        coverage: decision.coverage,
        evidenceCount: decision.evidence.length,
      },
    );
    if (this.dependencies.evaluations.commitDecision) {
      if (
        !(await this.dependencies.evaluations.commitDecision({
          initiative: decided,
          expectedVersion: initiative.version,
          decision,
          auditEvent,
          event: this.durableEvent(decided, auditEvent),
        }))
      )
        throw new InitiativeVersionConflictError();
    } else {
      if (
        !(await this.dependencies.initiatives.save({
          initiative: decided,
          expectedVersion: initiative.version,
        }))
      )
        throw new InitiativeVersionConflictError();
      await this.dependencies.evaluations.createDecision(decision);
      await this.dependencies.audit.record(auditEvent);
    }
    if (initiative.createdByActorId !== input.actorId)
      await this.dependencies.notifications?.notify({
        organizationId: initiative.organizationId,
        workspaceId: initiative.workspaceId,
        recipientActorId: initiative.createdByActorId,
        eventKey: `initiative.decision:${decision.id}:requester`,
        resourceType: "initiative",
        resourceId: initiative.id,
        title: "Hay una nueva decisión para una iniciativa.",
      });
    return decision;
  }

  async exemptCondition(input: {
    actorId: string;
    organizationId: string;
    decisionId: string;
    conditionId: string;
    reason: string;
    correlationId: string;
  }): Promise<InitiativeDecision> {
    await this.assertOwner(input.actorId, input.organizationId);
    const decision = await this.dependencies.evaluations.findDecision(
      input.decisionId,
    );
    if (!decision || decision.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    const updated = exemptDecisionCondition({
      decision,
      conditionId: input.conditionId,
      actorId: input.actorId,
      reason: input.reason,
      occurredAt: this.dependencies.clock.now(),
    });
    const condition = updated.conditions?.find(
      (item) => item.id === input.conditionId,
    );
    if (!condition)
      throw new EvaluationDomainError("DECISION_CONDITION_NOT_PENDING");
    await this.dependencies.evaluations.updateDecisionCondition({
      decisionId: updated.id,
      condition,
    });
    const initiative = await this.requireInitiative(
      decision.initiativeId,
      input.organizationId,
    );
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.decision_condition_exempted.v1",
      initiative.status,
      initiative.status,
      { decisionId: decision.id, conditionId: input.conditionId },
    );
    return updated;
  }

  async fulfillCondition(input: {
    actorId: string;
    organizationId: string;
    decisionId: string;
    conditionId: string;
    note: string;
    correlationId: string;
  }): Promise<InitiativeDecision> {
    const decision = await this.dependencies.evaluations.findDecision(
      input.decisionId,
    );
    if (!decision || decision.organizationId !== input.organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId: input.actorId,
      organizationId: input.organizationId,
    });
    if (!role) throw new AccessDeniedError("organization:manage");
    const condition = decision.conditions?.find(
      (item) => item.id === input.conditionId,
    );
    if (role !== "owner" && condition?.responsibleActorId !== input.actorId)
      throw new AccessDeniedError("organization:manage");
    const updated = fulfillDecisionCondition({
      decision,
      conditionId: input.conditionId,
      actorId: input.actorId,
      note: input.note,
      occurredAt: this.dependencies.clock.now(),
    });
    const updatedCondition = updated.conditions?.find(
      (item) => item.id === input.conditionId,
    );
    if (!updatedCondition)
      throw new EvaluationDomainError("DECISION_CONDITION_NOT_PENDING");
    await this.dependencies.evaluations.updateDecisionCondition({
      decisionId: updated.id,
      condition: updatedCondition,
    });
    const initiative = await this.requireInitiative(
      decision.initiativeId,
      input.organizationId,
    );
    await this.record(
      initiative,
      input.actorId,
      input.correlationId,
      "initiative.decision_condition_fulfilled.v1",
      initiative.status,
      initiative.status,
      { decisionId: decision.id, conditionId: input.conditionId },
    );
    return updated;
  }

  private async requireInitiative(
    initiativeId: string,
    organizationId: string,
  ) {
    const initiative =
      await this.dependencies.initiatives.findById(initiativeId);
    if (!initiative || initiative.organizationId !== organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    return initiative;
  }
  private async requireActiveStandard(
    standardId: string,
    organizationId: string,
  ): Promise<EvaluationStandard> {
    const standard = await this.dependencies.standards.findById(standardId);
    if (
      !standard ||
      standard.organizationId !== organizationId ||
      !standard.isActive
    )
      throw new EvaluationDomainError("EVALUATION_DRAFT_STANDARD_CHANGED");
    return standard;
  }
  private async assertAssignedReviewer(
    initiativeId: string,
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    await this.assertOrganizationManager(actorId, organizationId);
    const assignment =
      await this.dependencies.evaluations.findActiveReviewerAssignment(
        initiativeId,
      );
    if (!assignment || assignment.assignedActorId !== actorId)
      throw new EvaluationDomainError("EVALUATION_REVIEWER_NOT_ASSIGNED");
  }
  private async assertAssignedReviewerOrOwner(
    initiativeId: string,
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (role === "owner") return;
    await this.assertAssignedReviewer(initiativeId, actorId, organizationId);
  }
  private async persistDraft(
    draft: InitiativeEvaluationDraft,
    expectedVersion: number | null,
    auditEvent: InitiativeAuditEvent,
  ): Promise<void> {
    if (this.dependencies.evaluations.saveDraftWithAudit) {
      if (
        !(await this.dependencies.evaluations.saveDraftWithAudit({
          draft,
          expectedVersion,
          auditEvent,
        }))
      )
        throw new EvaluationDomainError("EVALUATION_DRAFT_VERSION_CONFLICT");
    } else {
      if (
        !(await this.dependencies.evaluations.saveDraft({
          draft,
          expectedVersion,
        }))
      )
        throw new EvaluationDomainError("EVALUATION_DRAFT_VERSION_CONFLICT");
      await this.dependencies.audit.record(auditEvent);
    }
  }
  private async requireReviewerAssignment(
    assignmentId: string,
    organizationId: string,
  ): Promise<EvaluationReviewerAssignment> {
    const assignment =
      await this.dependencies.evaluations.findReviewerAssignment(assignmentId);
    if (!assignment || assignment.organizationId !== organizationId)
      throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
    return assignment;
  }
  private async assertOrganizationManager(
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId,
    });
    if (role !== "owner" && role !== "admin")
      throw new AccessDeniedError("organization:manage");
  }
  private async assertOwner(
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    if (
      (await this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId,
      })) !== "owner"
    )
      throw new AccessDeniedError("organization:manage");
  }
  private async assertOrganizationMember(
    actorId: string,
    organizationId: string,
  ): Promise<void> {
    if (
      !(await this.dependencies.tenancy.findOrganizationRole({
        actorId,
        organizationId,
      }))
    )
      throw new AccessDeniedError("organization:manage");
  }
  private async assertResourceRead(input: {
    actorId: string;
    organizationId: string;
    workspaceId: string;
    resourceType: "evaluation" | "decision";
    resourceId: string;
    correlationId?: string | undefined;
  }): Promise<void> {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId: input.actorId,
      organizationId: input.organizationId,
    });
    if (role === "owner" || role === "admin") return;
    if (
      await this.dependencies.accessGrants?.authorize({
        ...input,
        action: "read",
        correlationId: input.correlationId ?? this.dependencies.ids.next(),
      })
    )
      return;
    throw new AccessDeniedError("organization:manage");
  }
  private async record(
    initiative: Awaited<ReturnType<InitiativeStore["findById"]>> & {},
    actorId: string,
    correlationId: string,
    eventType: string,
    fromStatus: import("@aether/domain").InitiativeStatus,
    toStatus: import("@aether/domain").InitiativeStatus,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.dependencies.audit.record(
      this.makeAuditEvent(
        initiative,
        actorId,
        correlationId,
        eventType,
        fromStatus,
        toStatus,
        payload,
      ),
    );
  }
  private makeAuditEvent(
    initiative: Awaited<ReturnType<InitiativeStore["findById"]>> & {},
    actorId: string,
    correlationId: string,
    eventType: string,
    fromStatus: import("@aether/domain").InitiativeStatus,
    toStatus: import("@aether/domain").InitiativeStatus,
    payload: Record<string, unknown>,
  ): InitiativeAuditEvent {
    return {
      id: this.dependencies.ids.next(),
      eventType,
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
      initiativeId: initiative.id,
      actorId,
      correlationId,
      occurredAt: this.dependencies.clock.now(),
      fromStatus,
      toStatus,
      payload,
    };
  }
  private durableEvent(
    initiative: import("@aether/domain").Initiative,
    auditEvent: InitiativeAuditEvent,
  ): DurableDomainEvent {
    return {
      eventId: auditEvent.id,
      eventType: auditEvent.eventType,
      occurredAt: auditEvent.occurredAt,
      aggregateId: initiative.id,
      aggregateType: "initiative",
      aggregateVersion: initiative.version,
      organizationId: initiative.organizationId,
      correlationId: auditEvent.correlationId,
      causationId: null,
      schemaVersion: 1,
      payload: auditEvent.payload,
    };
  }
}

export { EvaluationDomainError };
export class EvaluationConflictOfInterestError extends Error {}
