import { describe, expect, it } from "vitest";

import {
  DiagnosticDomainError,
  saveInitiativeDiagnostic,
  type InitiativeDiagnosticInput,
} from "./diagnostic.js";

const input = (): InitiativeDiagnosticInput => ({
  id: "diagnostic-1",
  organizationId: "organization-1",
  workspaceId: "workspace-1",
  initiativeId: "initiative-1",
  beneficiaries: ["Personas atendidas"],
  causes: [
    {
      kind: "evidence",
      text: "La espera excede 30 días",
      source: "Registro de atención",
    },
  ],
  constraints: [
    {
      kind: "opinion",
      text: "La capacidad actual es insuficiente",
      source: null,
    },
  ],
  previousAttempts: [],
  hypotheses: [
    {
      kind: "uncertainty",
      text: "La automatización podría reducir la espera",
      source: null,
    },
  ],
  scope: "Atención de solicitudes internas durante el próximo trimestre",
  risks: [],
  resources: ["Equipo de operaciones"],
  nextExperiment: null,
  savedByActorId: "actor-1",
});

describe("saveInitiativeDiagnostic", () => {
  it("preserva el diagnóstico histórico sin scope y exige scope para su siguiente guardado", () => {
    const saved = saveInitiativeDiagnostic({
      current: null,
      diagnostic: input(),
      savedAt: new Date("2026-09-19T00:00:00.000Z"),
    });
    expect(saved.version).toBe(0);
    const legacy = { ...saved, scope: null };
    const updated = saveInitiativeDiagnostic({
      current: legacy,
      diagnostic: input(),
      savedAt: new Date("2026-09-20T00:00:00.000Z"),
    });
    expect(updated).toMatchObject({ version: 1, scope: input().scope });
  });

  it.each([
    [
      "requires a source for evidence",
      {
        ...input(),
        causes: [{ kind: "evidence" as const, text: "Dato", source: null }],
      },
      "DIAGNOSTIC_EVIDENCE_SOURCE_REQUIRED",
    ],
    [
      "rejects blank resources",
      { ...input(), resources: [" "] },
      "DIAGNOSTIC_RESOURCE_REQUIRED",
    ],
    [
      "rejects unknown entry kinds",
      {
        ...input(),
        risks: [{ kind: "unsupported" as never, text: "Riesgo", source: null }],
      },
      "DIAGNOSTIC_ENTRY_KIND_INVALID",
    ],
  ])("%s", (_description, diagnostic, code) => {
    expect(() =>
      saveInitiativeDiagnostic({
        current: null,
        diagnostic,
        savedAt: new Date(),
      }),
    ).toThrow(
      new DiagnosticDomainError(
        code as ConstructorParameters<typeof DiagnosticDomainError>[0],
      ),
    );
  });
});
