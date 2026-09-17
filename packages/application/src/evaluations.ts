import {
  EvaluationDomainError,
  decideInitiative,
  exemptDecisionCondition,
  evaluateInitiative,
  publishEvaluationStandard,
  transitionInitiative,
  type EvaluationCriterion,
  type DecisionCondition,
  type InitiativeDecision,
  type InitiativeEvaluation,
  type EvaluationStandard,
} from "@aether/domain";

import type { InitiativeAuditStore, InitiativeStore } from "./initiatives.js";
import { InitiativeVersionConflictError } from "./initiatives.js";
import {
  AccessDeniedError,
  assertWorkspaceWritable,
  ResourceNotFoundError,
  type TenantStore,
} from "./tenancy.js";
import type { TemporaryAccessGrantAuthorizer } from "./access-grants.js";

export interface EvaluationStandardStore {
  create(standard: EvaluationStandard): Promise<void>;
  findById(standardId: string): Promise<EvaluationStandard | null>;
  list(input: {
    organizationId: string;
  }): Promise<readonly EvaluationStandard[]>;
  activate(input: {
    organizationId: string;
    standardId: string;
  }): Promise<void>;
}
export interface EvaluationStore {
  createEvaluation(evaluation: InitiativeEvaluation): Promise<void>;
  findEvaluation(evaluationId: string): Promise<InitiativeEvaluation | null>;
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
  }): Promise<EvaluationStandard> {
    await this.assertOwner(input.actorId, input.organizationId);
    const standard = publishEvaluationStandard({
      id: this.dependencies.ids.next(),
      organizationId: input.organizationId,
      name: input.name,
      version: input.version,
      criteria: input.criteria,
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
    });
  }
  async listStandards(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly EvaluationStandard[]> {
    await this.assertOrganizationManager(input.actorId, input.organizationId);
    return this.dependencies.standards.list(input);
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
      evaluatedByActorId: input.actorId,
      evaluatedAt: now,
    });
    const reviewing = transitionInitiative(initiative, "under_review", now);
    if (
      !(await this.dependencies.initiatives.save({
        initiative: reviewing,
        expectedVersion: initiative.version,
      }))
    )
      throw new InitiativeVersionConflictError();
    await this.dependencies.evaluations.createEvaluation(evaluation);
    await this.record(
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
    conditions?:
      | readonly {
          description: string;
          responsibleActorId: string;
          dueOn: string;
        }[]
      | undefined;
    correlationId: string;
  }): Promise<InitiativeDecision> {
    await this.assertOwner(input.actorId, input.organizationId);
    const initiative = await this.requireInitiative(
      input.initiativeId,
      input.organizationId,
    );
    await assertWorkspaceWritable(
      this.dependencies.tenancy,
      initiative.workspaceId,
    );
    if (initiative.status !== "under_review")
      throw new EvaluationDomainError("EVALUATION_INCOMPLETE");
    if (initiative.version !== input.expectedVersion)
      throw new InitiativeVersionConflictError();
    const evaluation = await this.dependencies.evaluations.findEvaluation(
      input.evaluationId,
    );
    if (!evaluation) throw new ResourceNotFoundError("INITIATIVE_NOT_FOUND");
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
    if (
      !(await this.dependencies.initiatives.save({
        initiative: decided,
        expectedVersion: initiative.version,
      }))
    )
      throw new InitiativeVersionConflictError();
    await this.dependencies.evaluations.createDecision(decision);
    await this.record(
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
    await this.dependencies.audit.record({
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
    });
  }
}

export { EvaluationDomainError };
