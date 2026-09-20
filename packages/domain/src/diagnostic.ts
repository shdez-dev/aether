export const DiagnosticEntryKinds = [
  "evidence",
  "opinion",
  "uncertainty",
] as const;
export type DiagnosticEntryKind = (typeof DiagnosticEntryKinds)[number];

export type DiagnosticEntry = Readonly<{
  kind: DiagnosticEntryKind;
  text: string;
  source: string | null;
}>;

export type InitiativeDiagnostic = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  initiativeId: string;
  version: number;
  beneficiaries: readonly string[];
  causes: readonly DiagnosticEntry[];
  constraints: readonly DiagnosticEntry[];
  previousAttempts: readonly DiagnosticEntry[];
  hypotheses: readonly DiagnosticEntry[];
  /** Null is retained only for diagnostics created before operational context existed. */
  scope: string | null;
  risks: readonly DiagnosticEntry[];
  resources: readonly string[];
  nextExperiment: string | null;
  savedByActorId: string;
  savedAt: Date;
}>;

export type InitiativeDiagnosticInput = Omit<
  InitiativeDiagnostic,
  "version" | "savedAt" | "scope"
> & {
  /** Every new save captures a non-empty operational scope. */
  scope: string;
};

export function saveInitiativeDiagnostic(input: {
  current: InitiativeDiagnostic | null;
  diagnostic: InitiativeDiagnosticInput;
  savedAt: Date;
}): InitiativeDiagnostic {
  const sections = [
    input.diagnostic.causes,
    input.diagnostic.constraints,
    input.diagnostic.previousAttempts,
    input.diagnostic.hypotheses,
    input.diagnostic.risks,
  ];
  for (const section of sections)
    for (const entry of section) validateEntry(entry);
  if (input.diagnostic.beneficiaries.some((beneficiary) => !beneficiary.trim()))
    throw new DiagnosticDomainError("DIAGNOSTIC_BENEFICIARY_REQUIRED");
  if (!input.diagnostic.scope.trim())
    throw new DiagnosticDomainError("DIAGNOSTIC_SCOPE_REQUIRED");
  if (input.diagnostic.resources.some((resource) => !resource.trim()))
    throw new DiagnosticDomainError("DIAGNOSTIC_RESOURCE_REQUIRED");
  return {
    ...input.diagnostic,
    beneficiaries: [...input.diagnostic.beneficiaries],
    causes: [...input.diagnostic.causes],
    constraints: [...input.diagnostic.constraints],
    previousAttempts: [...input.diagnostic.previousAttempts],
    hypotheses: [...input.diagnostic.hypotheses],
    risks: [...input.diagnostic.risks],
    resources: [...input.diagnostic.resources],
    version: (input.current?.version ?? -1) + 1,
    savedAt: input.savedAt,
  };
}

function validateEntry(entry: DiagnosticEntry) {
  if (!DiagnosticEntryKinds.includes(entry.kind))
    throw new DiagnosticDomainError("DIAGNOSTIC_ENTRY_KIND_INVALID");
  if (!entry.text.trim())
    throw new DiagnosticDomainError("DIAGNOSTIC_ENTRY_REQUIRED");
  if (entry.kind === "evidence" && !entry.source?.trim())
    throw new DiagnosticDomainError("DIAGNOSTIC_EVIDENCE_SOURCE_REQUIRED");
}

export class DiagnosticDomainError extends Error {
  constructor(
    public readonly code:
      | "DIAGNOSTIC_BENEFICIARY_REQUIRED"
      | "DIAGNOSTIC_ENTRY_REQUIRED"
      | "DIAGNOSTIC_EVIDENCE_SOURCE_REQUIRED"
      | "DIAGNOSTIC_SCOPE_REQUIRED"
      | "DIAGNOSTIC_RESOURCE_REQUIRED"
      | "DIAGNOSTIC_ENTRY_KIND_INVALID",
  ) {
    super(code);
  }
}
