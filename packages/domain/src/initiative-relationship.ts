export type InitiativeRelationshipKind =
  | "related"
  | "continues";

export type InitiativeRelationship = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  sourceInitiativeId: string;
  targetInitiativeId: string;
  kind: InitiativeRelationshipKind;
  declaredByActorId: string;
  declaredAt: Date;
}>;

export function declareInitiativeRelationship(
  input: InitiativeRelationship,
): InitiativeRelationship {
  if (input.sourceInitiativeId === input.targetInitiativeId)
    throw new InitiativeRelationshipDomainError("SELF_RELATIONSHIP_NOT_ALLOWED");
  return input;
}

export class InitiativeRelationshipDomainError extends Error {
  constructor(public readonly code: "SELF_RELATIONSHIP_NOT_ALLOWED") {
    super(code);
  }
}
