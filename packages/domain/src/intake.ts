export type IntakeResponsibility = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  responsibleActorId: string;
  assignedByActorId: string;
  assignedAt: Date;
  nextReviewOn: string;
}>;

export function assignIntakeResponsibility(
  input: IntakeResponsibility,
): IntakeResponsibility {
  if (!input.nextReviewOn.trim())
    throw new IntakeDomainError("INTAKE_REVIEW_DATE_REQUIRED");
  return input;
}

export class IntakeDomainError extends Error {
  constructor(
    public readonly code:
      | "INTAKE_REVIEW_DATE_REQUIRED"
      | "INTAKE_NOT_ALLOWED_FOR_INITIATIVE_STATE"
      | "INTAKE_ALREADY_ASSIGNED",
  ) {
    super(code);
  }
}
