export const InitiativeStatuses = [
  "draft",
  "presented",
  "under_review",
  "returned",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type InitiativeStatus = (typeof InitiativeStatuses)[number];
export type InitiativeClassification = "internal" | "confidential";
export const InitiativePriorities = ["low", "medium", "high"] as const;
export type InitiativePriority = (typeof InitiativePriorities)[number];

export type Initiative = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  createdByActorId: string;
  title: string;
  problemStatement: string;
  expectedOutcome: string;
  classification: InitiativeClassification;
  /** La urgencia declarada por quien plantea la iniciativa; no la modifica gestión. */
  requestedPriority: InitiativePriority | null;
  /** Priorización institucional independiente de la solicitud original. */
  operationalPriority: InitiativePriority | null;
  status: InitiativeStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;
export type InitiativeDuplicateWarning = Readonly<{
  initiativeId: string;
  title: string;
  createdAt: Date;
  matchedFields: readonly ("title" | "problem_statement")[];
}>;

const transitions: Readonly<
  Record<InitiativeStatus, readonly InitiativeStatus[]>
> = {
  draft: ["presented", "cancelled"],
  presented: ["under_review", "cancelled"],
  under_review: ["returned", "approved", "rejected", "cancelled"],
  returned: ["presented", "cancelled"],
  approved: [],
  rejected: [],
  cancelled: [],
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
  if (initiative.status !== "draft" && initiative.status !== "returned")
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

export function setInitiativeOperationalPriority(
  initiative: Initiative,
  operationalPriority: InitiativePriority,
  updatedAt: Date,
): Initiative {
  if (["approved", "rejected", "cancelled"].includes(initiative.status))
    throw new InitiativeDomainError("INITIATIVE_NOT_EDITABLE");
  return {
    ...initiative,
    operationalPriority,
    version: initiative.version + 1,
    updatedAt,
  };
}

export function allowedTransitions(
  status: InitiativeStatus,
): readonly InitiativeStatus[] {
  return transitions[status];
}

export function findPotentialInitiativeDuplicates(input: {
  reference: Initiative;
  candidates: readonly Initiative[];
}): readonly InitiativeDuplicateWarning[] {
  const referenceTitle = normalizeInitiativeContent(input.reference.title);
  const referenceProblem = normalizeInitiativeContent(
    input.reference.problemStatement,
  );
  return input.candidates
    .filter(
      (candidate) =>
        candidate.id !== input.reference.id &&
        candidate.organizationId === input.reference.organizationId &&
        candidate.workspaceId === input.reference.workspaceId &&
        !["rejected", "cancelled"].includes(candidate.status) &&
        normalizeInitiativeContent(candidate.title) === referenceTitle &&
        normalizeInitiativeContent(candidate.problemStatement) ===
          referenceProblem,
    )
    .sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    )
    .map((candidate) => ({
      initiativeId: candidate.id,
      title: candidate.title,
      createdAt: candidate.createdAt,
      matchedFields: ["title", "problem_statement"],
    }));
}

function normalizeInitiativeContent(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

export class InitiativeDomainError extends Error {
  constructor(
    public readonly code:
      "INITIATIVE_NOT_EDITABLE" | "INVALID_INITIATIVE_TRANSITION",
  ) {
    super(code);
  }
}
