export const InitiativeStatuses = [
  "draft",
  "presented",
  "under_review",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export type InitiativeStatus = (typeof InitiativeStatuses)[number];
export type InitiativeClassification = "internal" | "confidential";

export type Initiative = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  createdByActorId: string;
  title: string;
  problemStatement: string;
  expectedOutcome: string;
  classification: InitiativeClassification;
  status: InitiativeStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

const transitions: Readonly<
  Record<InitiativeStatus, readonly InitiativeStatus[]>
> = {
  draft: ["presented", "withdrawn"],
  presented: ["under_review", "withdrawn"],
  under_review: ["approved", "rejected", "withdrawn"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function createInitiative(
  input: Omit<Initiative, "status" | "version">,
): Initiative {
  return { ...input, status: "draft", version: 0 };
}

export function editInitiative(
  initiative: Initiative,
  patch: Pick<
    Initiative,
    "title" | "problemStatement" | "expectedOutcome" | "classification"
  >,
  updatedAt: Date,
): Initiative {
  if (initiative.status !== "draft")
    throw new InitiativeDomainError("INITIATIVE_NOT_EDITABLE");
  return {
    ...initiative,
    ...patch,
    version: initiative.version + 1,
    updatedAt,
  };
}

export function transitionInitiative(
  initiative: Initiative,
  target: InitiativeStatus,
  updatedAt: Date,
): Initiative {
  if (!transitions[initiative.status].includes(target)) {
    throw new InitiativeDomainError("INVALID_INITIATIVE_TRANSITION");
  }
  return {
    ...initiative,
    status: target,
    version: initiative.version + 1,
    updatedAt,
  };
}

export function allowedTransitions(
  status: InitiativeStatus,
): readonly InitiativeStatus[] {
  return transitions[status];
}

export class InitiativeDomainError extends Error {
  constructor(
    public readonly code:
      "INITIATIVE_NOT_EDITABLE" | "INVALID_INITIATIVE_TRANSITION",
  ) {
    super(code);
  }
}
