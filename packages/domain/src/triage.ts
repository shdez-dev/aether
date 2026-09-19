export type TriageCriterion = Readonly<{
  id: string;
  code: string;
  name: string;
  description: string;
  required: boolean;
}>;

export type TriageStandard = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  version: number;
  criteria: readonly TriageCriterion[];
  isActive: boolean;
  publishedAt: Date;
  publishedByActorId: string;
}>;

export type TriageAssessment = "pass" | "fail" | "not_applicable";
export type TriageCriterionResult = Readonly<{
  criterion: TriageCriterion;
  assessment: TriageAssessment | null;
  justification: readonly string[];
}>;
export type TriageResultInput = Readonly<{
  criterionId: string;
  assessment: TriageAssessment | null;
  justification: readonly string[];
}>;
export type InitiativeTriage = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  initiativeVersion: number;
  standardId: string;
  standardVersion: number;
  criteria: readonly TriageCriterionResult[];
  assessedByActorId: string;
  assessedAt: Date;
}>;

export function publishTriageStandard(
  input: Omit<TriageStandard, "isActive">,
): TriageStandard {
  if (input.criteria.length === 0)
    throw new TriageDomainError("TRIAGE_STANDARD_REQUIRES_CRITERIA");
  if (
    new Set(input.criteria.map((criterion) => criterion.id)).size !==
    input.criteria.length
  )
    throw new TriageDomainError("DUPLICATE_TRIAGE_CRITERION_ID");
  if (
    new Set(input.criteria.map((criterion) => criterion.code)).size !==
    input.criteria.length
  )
    throw new TriageDomainError("DUPLICATE_TRIAGE_CRITERION_CODE");
  return { ...input, criteria: [...input.criteria], isActive: false };
}

export function assessInitiativeForTriage(input: {
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  initiativeVersion: number;
  standard: TriageStandard;
  results: readonly TriageResultInput[];
  assessedByActorId: string;
  assessedAt: Date;
}): InitiativeTriage {
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
    throw new TriageDomainError("INVALID_TRIAGE_CRITERIA");
  if (
    input.standard.criteria.some(
      (criterion) => criterion.required && !resultById.has(criterion.id),
    )
  )
    throw new TriageDomainError("REQUIRED_TRIAGE_CRITERION_MISSING");
  if (
    input.results.some(
      (result) =>
        result.assessment === "not_applicable" &&
        !result.justification.some((item) => item.trim().length > 0),
    )
  )
    throw new TriageDomainError("TRIAGE_NOT_APPLICABLE_REQUIRES_JUSTIFICATION");

  return {
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    initiativeId: input.initiativeId,
    initiativeVersion: input.initiativeVersion,
    standardId: input.standard.id,
    standardVersion: input.standard.version,
    criteria: input.standard.criteria.map((criterion) => {
      const result = resultById.get(criterion.id);
      return {
        criterion,
        assessment: result?.assessment ?? null,
        justification: [...(result?.justification ?? [])],
      };
    }),
    assessedByActorId: input.assessedByActorId,
    assessedAt: input.assessedAt,
  };
}

export class TriageDomainError extends Error {
  constructor(
    public readonly code:
      | "TRIAGE_STANDARD_REQUIRES_CRITERIA"
      | "DUPLICATE_TRIAGE_CRITERION_ID"
      | "DUPLICATE_TRIAGE_CRITERION_CODE"
      | "INVALID_TRIAGE_CRITERIA"
      | "REQUIRED_TRIAGE_CRITERION_MISSING"
      | "TRIAGE_NOT_APPLICABLE_REQUIRES_JUSTIFICATION"
      | "TRIAGE_STANDARD_NOT_ACTIVE"
      | "TRIAGE_NOT_ALLOWED_FOR_INITIATIVE_STATE",
  ) {
    super(code);
  }
}
