export type EvaluationCriterion = Readonly<{
  id: string;
  code: string;
  name: string;
  description: string;
  weight: number;
  dimension?: string;
  isExclusionary?: boolean;
}>;
export type EvaluationMaturityLevel = Readonly<{
  code: string;
  name: string;
  minimumQualityPercentage: number;
}>;

export type EvaluationStandard = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  version: number;
  criteria: readonly EvaluationCriterion[];
  maturityLevels?: readonly EvaluationMaturityLevel[];
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
export type InitiativeEvaluationDraft = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  initiativeVersion: number;
  standardId: string;
  standardVersion: number;
  results: readonly EvaluationResultInput[];
  findings: readonly string[];
  recommendation: string | null;
  version: number;
  status: "draft" | "published";
  updatedByActorId: string;
  updatedAt: Date;
  publishedEvaluationId: string | null;
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
export type EvaluationMaturity = Readonly<{
  levelCode: string;
  levelName: string;
  minimumQualityPercentage: number;
}>;
export type EvaluationReviewerAssignmentStatus =
  "assigned" | "abstained" | "reassigned" | "escalated" | "completed";
export type EvaluationReviewerAssignment = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  assignedActorId: string;
  assignedByActorId: string;
  assignedAt: Date;
  status: EvaluationReviewerAssignmentStatus;
  statusChangedAt: Date;
  statusChangedByActorId: string;
  reason: string | null;
}>;
export type EvaluationConflict = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  assignmentId: string;
  declaredByActorId: string;
  reason: string;
  declaredAt: Date;
  resolvedByActorId: string | null;
  resolution: string | null;
  resolvedAt: Date | null;
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
  findings: readonly string[];
  recommendation: string | null;
  coverage: EvaluationCoverage;
  quality: EvaluationQuality | null;
  maturity: EvaluationMaturity | null;
  evaluatedByActorId: string;
  evaluatedAt: Date;
  annulledByActorId: string | null;
  annulledAt: Date | null;
  annulmentReason: string | null;
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
  maturity: EvaluationMaturity | null;
  decidedByActorId: string;
  decidedAt: Date;
  nextReviewOn: string | null;
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
  const maturityLevels = (input.maturityLevels ?? [])
    .map((level) => ({
      ...level,
      code: level.code.trim(),
      name: level.name.trim(),
    }))
    .sort(
      (left, right) =>
        left.minimumQualityPercentage - right.minimumQualityPercentage,
    );
  if (
    new Set(maturityLevels.map((level) => level.code)).size !==
      maturityLevels.length ||
    new Set(maturityLevels.map((level) => level.minimumQualityPercentage))
      .size !== maturityLevels.length ||
    maturityLevels.some(
      (level) =>
        !level.code.trim() ||
        !level.name.trim() ||
        level.minimumQualityPercentage < 0 ||
        level.minimumQualityPercentage > 100 ||
        !Number.isInteger(level.minimumQualityPercentage),
    )
  )
    throw new EvaluationDomainError("INVALID_MATURITY_SCALE");
  return {
    ...input,
    criteria: input.criteria.map((criterion) => ({
      ...criterion,
      dimension: criterion.dimension?.trim() || "general",
      isExclusionary: criterion.isExclusionary ?? false,
    })),
    maturityLevels,
    isActive: false,
  };
}

export function evaluateInitiative(input: {
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  initiativeVersion: number;
  standard: EvaluationStandard;
  results: readonly EvaluationResultInput[];
  findings?: readonly string[];
  recommendation?: string | null;
  evaluatedByActorId: string;
  evaluatedAt: Date;
}): InitiativeEvaluation {
  const findings = [...(input.findings ?? [])].map((finding) => finding.trim());
  const recommendation = input.recommendation?.trim() || null;
  if (findings.some((finding) => !finding))
    throw new EvaluationDomainError("INVALID_EVALUATION_FINDINGS");
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
  if (
    input.results.some(
      (result) =>
        result.assessment === "not_applicable" &&
        !result.evidence.some((item) => item.trim().length > 0),
    )
  )
    throw new EvaluationDomainError("NOT_APPLICABLE_REQUIRES_JUSTIFICATION");
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
  const coverage: EvaluationCoverage = {
    totalCriteria,
    applicableCriteria,
    assessedCriteria,
    notApplicableCriteria,
    percentage:
      applicableCriteria === 0
        ? 0
        : Math.round((assessedCriteria / applicableCriteria) * 100),
  };
  const quality: EvaluationQuality = {
    applicableWeight,
    assessedWeight,
    metWeight,
    percentage:
      assessedWeight === 0 ? 0 : Math.round((metWeight / assessedWeight) * 100),
  };
  const maturityLevel =
    coverage.percentage === 100
      ? [...(input.standard.maturityLevels ?? [])]
          .reverse()
          .find((level) => quality.percentage >= level.minimumQualityPercentage)
      : undefined;
  return {
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    initiativeId: input.initiativeId,
    initiativeVersion: input.initiativeVersion,
    standardId: input.standard.id,
    standardVersion: input.standard.version,
    criteria,
    findings,
    recommendation,
    coverage,
    quality,
    maturity: maturityLevel
      ? {
          levelCode: maturityLevel.code,
          levelName: maturityLevel.name,
          minimumQualityPercentage: maturityLevel.minimumQualityPercentage,
        }
      : null,
    evaluatedByActorId: input.evaluatedByActorId,
    evaluatedAt: input.evaluatedAt,
    annulledByActorId: null,
    annulledAt: null,
    annulmentReason: null,
  };
}

export function decideInitiative(
  input: Omit<
    InitiativeDecision,
    "coverage" | "quality" | "maturity" | "standardId" | "standardVersion"
  > & {
    evaluation: InitiativeEvaluation;
    conditions?: readonly DecisionCondition[];
  },
): InitiativeDecision {
  if (!input.rationale.trim())
    throw new EvaluationDomainError("DECISION_RATIONALE_REQUIRED");
  if (input.outcome !== "approved" && (input.conditions?.length ?? 0) > 0)
    throw new EvaluationDomainError("DECISION_CONDITIONS_REQUIRE_APPROVAL");
  if (input.outcome === "returned" && !input.nextReviewOn)
    throw new EvaluationDomainError("RETURNED_DECISION_REQUIRES_NEXT_REVIEW");
  if (input.outcome !== "returned" && input.nextReviewOn)
    throw new EvaluationDomainError("NEXT_REVIEW_ONLY_FOR_RETURNED_DECISION");
  if (input.evaluation.initiativeId !== input.initiativeId)
    throw new EvaluationDomainError("EVALUATION_DOES_NOT_MATCH_INITIATIVE");
  if (input.evaluation.coverage.percentage !== 100)
    throw new EvaluationDomainError("EVALUATION_INCOMPLETE");
  if (
    input.outcome === "approved" &&
    input.evaluation.criteria.some(
      (result) =>
        result.criterion.isExclusionary && result.assessment !== "met",
    )
  )
    throw new EvaluationDomainError("EXCLUSIONARY_CRITERION_NOT_MET");
  return {
    ...input,
    standardId: input.evaluation.standardId,
    standardVersion: input.evaluation.standardVersion,
    coverage: input.evaluation.coverage,
    quality: input.evaluation.quality,
    maturity: input.evaluation.maturity,
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
      | "INVALID_MATURITY_SCALE"
      | "INVALID_EVALUATION_CRITERIA"
      | "INVALID_EVALUATION_FINDINGS"
      | "NOT_APPLICABLE_REQUIRES_JUSTIFICATION"
      | "EVALUATION_ALREADY_ANNULLED"
      | "EVALUATION_ALREADY_DECIDED"
      | "EVALUATION_ANNULLED"
      | "EVALUATION_REVIEWER_NOT_ASSIGNED"
      | "EVALUATION_DRAFT_NOT_FOUND"
      | "EVALUATION_DRAFT_VERSION_CONFLICT"
      | "EVALUATION_DRAFT_STANDARD_CHANGED"
      | "EVALUATION_DRAFT_MIGRATION_INVALID"
      | "EVALUATION_DRAFT_EXISTS"
      | "EVALUATION_CONFLICT_ALREADY_DECLARED"
      | "EVALUATION_CONFLICT_NOT_FOUND"
      | "EVALUATION_CONFLICT_UNRESOLVED"
      | "EVALUATION_ASSIGNMENT_NOT_ABSTAINED"
      | "RETURNED_DECISION_REQUIRES_NEXT_REVIEW"
      | "NEXT_REVIEW_ONLY_FOR_RETURNED_DECISION"
      | "EVALUATION_DOES_NOT_MATCH_INITIATIVE"
      | "EVALUATION_INCOMPLETE"
      | "EXCLUSIONARY_CRITERION_NOT_MET"
      | "DECISION_RATIONALE_REQUIRED"
      | "DECISION_CONDITION_NOT_PENDING"
      | "DECISION_CONDITIONS_REQUIRE_APPROVAL",
  ) {
    super(code);
  }
}
