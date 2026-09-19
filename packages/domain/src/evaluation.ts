export type EvaluationCriterion = Readonly<{
  id: string;
  code: string;
  name: string;
  description: string;
  weight: number;
}>;

export type EvaluationStandard = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  version: number;
  criteria: readonly EvaluationCriterion[];
  isActive: boolean;
  publishedAt: Date;
  publishedByActorId: string;
}>;

export type CriterionAssessment = "met" | "not_met" | "not_applicable";
export type EvaluationCriterionResult = Readonly<{
  criterion: EvaluationCriterion;
  assessment: CriterionAssessment | null;
  evidence: readonly string[];
}>;
export type EvaluationResultInput = Readonly<{
  criterionId: string;
  assessment: CriterionAssessment | null;
  evidence: readonly string[];
}>;
export type EvaluationCoverage = Readonly<{
  totalCriteria: number;
  applicableCriteria: number;
  assessedCriteria: number;
  notApplicableCriteria: number;
  percentage: number;
}>;
export type EvaluationQuality = Readonly<{
  applicableWeight: number;
  assessedWeight: number;
  metWeight: number;
  percentage: number;
}>;
export type InitiativeEvaluation = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  initiativeVersion: number;
  standardId: string;
  standardVersion: number;
  criteria: readonly EvaluationCriterionResult[];
  coverage: EvaluationCoverage;
  quality: EvaluationQuality | null;
  evaluatedByActorId: string;
  evaluatedAt: Date;
}>;
export type DecisionOutcome =
  "approved" | "rejected" | "returned" | "cancelled";
export type InitiativeDecision = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  evaluationId: string;
  outcome: DecisionOutcome;
  rationale: string;
  evidence: readonly string[];
  standardId: string;
  standardVersion: number;
  coverage: EvaluationCoverage;
  quality: EvaluationQuality | null;
  decidedByActorId: string;
  decidedAt: Date;
  conditions?: readonly DecisionCondition[];
}>;
export type DecisionCondition = Readonly<{
  id: string;
  description: string;
  responsibleActorId: string;
  dueOn: string;
  status: "pending" | "fulfilled" | "exempted";
  resolvedByActorId: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}>;

export function publishEvaluationStandard(
  input: Omit<EvaluationStandard, "isActive">,
): EvaluationStandard {
  if (input.criteria.length === 0)
    throw new EvaluationDomainError("STANDARD_REQUIRES_CRITERIA");
  if (
    new Set(input.criteria.map((criterion) => criterion.code)).size !==
    input.criteria.length
  )
    throw new EvaluationDomainError("DUPLICATE_CRITERION_CODE");
  if (input.criteria.some((criterion) => criterion.weight <= 0))
    throw new EvaluationDomainError("INVALID_CRITERION_WEIGHT");
  return { ...input, criteria: [...input.criteria], isActive: false };
}

export function evaluateInitiative(input: {
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  initiativeVersion: number;
  standard: EvaluationStandard;
  results: readonly EvaluationResultInput[];
  evaluatedByActorId: string;
  evaluatedAt: Date;
}): InitiativeEvaluation {
  const resultById = new Map(
    input.results.map((result) => [result.criterionId, result]),
  );
  if (
    resultById.size !== input.results.length ||
    input.results.some(
      (result) =>
        !input.standard.criteria.some(
          (criterion) => criterion.id === result.criterionId,
        ),
    )
  )
    throw new EvaluationDomainError("INVALID_EVALUATION_CRITERIA");
  const criteria = input.standard.criteria.map((criterion) => {
    const result = resultById.get(criterion.id);
    return {
      criterion,
      assessment: result?.assessment ?? null,
      evidence: [...(result?.evidence ?? [])],
    };
  });
  const notApplicableCriteria = criteria.filter(
    (criterion) => criterion.assessment === "not_applicable",
  ).length;
  const assessedCriteria = criteria.filter(
    (criterion) =>
      criterion.assessment === "met" || criterion.assessment === "not_met",
  ).length;
  const totalCriteria = criteria.length;
  const applicableCriteria = totalCriteria - notApplicableCriteria;
  const applicableWeight = criteria
    .filter((criterion) => criterion.assessment !== "not_applicable")
    .reduce((total, criterion) => total + criterion.criterion.weight, 0);
  const assessedWeight = criteria
    .filter(
      (criterion) =>
        criterion.assessment === "met" || criterion.assessment === "not_met",
    )
    .reduce((total, criterion) => total + criterion.criterion.weight, 0);
  const metWeight = criteria
    .filter((criterion) => criterion.assessment === "met")
    .reduce((total, criterion) => total + criterion.criterion.weight, 0);
  return {
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    initiativeId: input.initiativeId,
    initiativeVersion: input.initiativeVersion,
    standardId: input.standard.id,
    standardVersion: input.standard.version,
    criteria,
    coverage: {
      totalCriteria,
      applicableCriteria,
      assessedCriteria,
      notApplicableCriteria,
      percentage:
        applicableCriteria === 0
          ? 0
          : Math.round((assessedCriteria / applicableCriteria) * 100),
    },
    quality: {
      applicableWeight,
      assessedWeight,
      metWeight,
      percentage:
        assessedWeight === 0 ? 0 : Math.round((metWeight / assessedWeight) * 100),
    },
    evaluatedByActorId: input.evaluatedByActorId,
    evaluatedAt: input.evaluatedAt,
  };
}

export function decideInitiative(
  input: Omit<
    InitiativeDecision,
    "coverage" | "quality" | "standardId" | "standardVersion"
  > & {
    evaluation: InitiativeEvaluation;
    conditions?: readonly DecisionCondition[];
  },
): InitiativeDecision {
  if (input.outcome !== "approved" && (input.conditions?.length ?? 0) > 0)
    throw new EvaluationDomainError("DECISION_CONDITIONS_REQUIRE_APPROVAL");
  if (input.evaluation.initiativeId !== input.initiativeId)
    throw new EvaluationDomainError("EVALUATION_DOES_NOT_MATCH_INITIATIVE");
  if (input.evaluation.coverage.percentage !== 100)
    throw new EvaluationDomainError("EVALUATION_INCOMPLETE");
  return {
    ...input,
    standardId: input.evaluation.standardId,
    standardVersion: input.evaluation.standardVersion,
    coverage: input.evaluation.coverage,
    quality: input.evaluation.quality,
    conditions: input.conditions ?? [],
  };
}

export function exemptDecisionCondition(input: {
  decision: InitiativeDecision;
  conditionId: string;
  actorId: string;
  reason: string;
  occurredAt: Date;
}): InitiativeDecision {
  const conditions = input.decision.conditions ?? [];
  const condition = conditions.find((item) => item.id === input.conditionId);
  if (!condition || condition.status !== "pending")
    throw new EvaluationDomainError("DECISION_CONDITION_NOT_PENDING");
  return {
    ...input.decision,
    conditions: conditions.map((item) =>
      item.id === input.conditionId
        ? {
            ...item,
            status: "exempted",
            resolvedByActorId: input.actorId,
            resolvedAt: input.occurredAt,
            resolutionNote: input.reason,
          }
        : item,
    ),
  };
}

export function fulfillDecisionCondition(input: {
  decision: InitiativeDecision;
  conditionId: string;
  actorId: string;
  note: string;
  occurredAt: Date;
}): InitiativeDecision {
  const conditions = input.decision.conditions ?? [];
  const condition = conditions.find((item) => item.id === input.conditionId);
  if (!condition || condition.status !== "pending")
    throw new EvaluationDomainError("DECISION_CONDITION_NOT_PENDING");
  return {
    ...input.decision,
    conditions: conditions.map((item) =>
      item.id === input.conditionId
        ? {
            ...item,
            status: "fulfilled",
            resolvedByActorId: input.actorId,
            resolvedAt: input.occurredAt,
            resolutionNote: input.note,
          }
        : item,
    ),
  };
}

export class EvaluationDomainError extends Error {
  constructor(
    public readonly code:
      | "STANDARD_REQUIRES_CRITERIA"
      | "DUPLICATE_CRITERION_CODE"
      | "INVALID_CRITERION_WEIGHT"
      | "INVALID_EVALUATION_CRITERIA"
      | "EVALUATION_DOES_NOT_MATCH_INITIATIVE"
      | "EVALUATION_INCOMPLETE"
      | "DECISION_CONDITION_NOT_PENDING"
      | "DECISION_CONDITIONS_REQUIRE_APPROVAL",
  ) {
    super(code);
  }
}
