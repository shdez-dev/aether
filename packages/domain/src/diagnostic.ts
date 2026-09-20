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
  savedByActorId: string;
  savedAt: Date;
}>;

export type InitiativeDiagnosticInput = Omit<
  InitiativeDiagnostic,
  "version" | "savedAt"
>;

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
  ];
  for (const section of sections)
    for (const entry of section) validateEntry(entry);
  if (input.diagnostic.beneficiaries.some((beneficiary) => !beneficiary.trim()))
    throw new DiagnosticDomainError("DIAGNOSTIC_BENEFICIARY_REQUIRED");
  return {
    ...input.diagnostic,
    beneficiaries: [...input.diagnostic.beneficiaries],
    causes: [...input.diagnostic.causes],
    constraints: [...input.diagnostic.constraints],
    previousAttempts: [...input.diagnostic.previousAttempts],
    hypotheses: [...input.diagnostic.hypotheses],
    version: (input.current?.version ?? -1) + 1,
    savedAt: input.savedAt,
  };
}

function validateEntry(entry: DiagnosticEntry) {
  if (!entry.text.trim()) throw new DiagnosticDomainError("DIAGNOSTIC_ENTRY_REQUIRED");
  if (entry.kind === "evidence" && !entry.source?.trim())
    throw new DiagnosticDomainError("DIAGNOSTIC_EVIDENCE_SOURCE_REQUIRED");
}

export class DiagnosticDomainError extends Error {
  constructor(
    public readonly code:
      | "DIAGNOSTIC_BENEFICIARY_REQUIRED"
      | "DIAGNOSTIC_ENTRY_REQUIRED"
      | "DIAGNOSTIC_EVIDENCE_SOURCE_REQUIRED",
  ) {
    super(code);
  }
}
