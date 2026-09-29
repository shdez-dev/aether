import type { FormEvent } from "react";

import type { InitiativeProposalDetails } from "@aether/contracts";
import { Button } from "@aether/ui";

export type InitiativeProposalDraft = {
  title: string;
  problemStatement: string;
  expectedOutcome: string;
  classification: "internal" | "confidential";
  requestedPriority: "low" | "medium" | "high" | null;
  proposalDetails: InitiativeProposalDetails;
};

const steps = ["Contexto", "Impacto", "Propuesta", "Pilotaje"] as const;

export function InitiativeProposalWizard({
  draft,
  mode = "create",
  onChange,
  step,
  maxStep,
  error,
  busy,
  onStepChange,
  onContinue,
  onBack,
  onSubmit,
  onCancel,
}: {
  draft: InitiativeProposalDraft;
  mode?: "create" | "edit";
  onChange: (draft: InitiativeProposalDraft) => void;
  step: number;
  maxStep: number;
  error: string;
  busy: boolean;
  onStepChange: (step: number) => void;
  onContinue: () => void;
  onBack: () => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const updateDetails = (change: Partial<InitiativeProposalDetails>) =>
    onChange({
      ...draft,
      proposalDetails: { ...draft.proposalDetails, ...change },
    });
  const visibleSections = mode === "edit" ? [0, 1, 2, 3] : [step];

  return (
    <div
      className={`initiative-wizard${mode === "edit" ? " initiative-wizard--edit" : ""}`}
    >
      <header className="initiative-wizard__header">
        <button
          type="button"
          className="initiative-wizard__back-link"
          onClick={onCancel}
        >
          <span aria-hidden="true">←</span>{" "}
          {mode === "edit" ? "Volver al detalle" : "Volver a iniciativas"}
        </button>
        {mode === "create" ? (
          <p className="workspace-kicker">PLANTEA UNA IDEA</p>
        ) : null}
        <h1>{mode === "edit" ? "Editar iniciativa" : "Nueva iniciativa"}</h1>
        {mode === "create" ? (
          <p>
            Cuéntanos qué necesidad existe, a quién afecta y qué valor esperas
            generar. Guardaremos tu propuesta como borrador.
          </p>
        ) : null}
      </header>

      {mode === "create" ? (
        <nav
          className="initiative-wizard__steps"
          aria-label="Pasos de la propuesta"
        >
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-current={step === index ? "step" : undefined}
              disabled={index > maxStep}
              className={
                index < step
                  ? "is-complete"
                  : index === step
                    ? "is-current"
                    : ""
              }
              onClick={() => onStepChange(index)}
            >
              <span>{index < step ? "✓" : `0${index + 1}`}</span>
              {label}
            </button>
          ))}
        </nav>
      ) : null}

      <form className="initiative-wizard__form" onSubmit={onSubmit}>
        <div className="initiative-wizard__main">
          {error ? (
            <p className="initiative-wizard__error" role="alert">
              {error}
            </p>
          ) : null}
          {visibleSections.map((sectionStep) => (
            <section
              className="initiative-wizard__panel"
              aria-labelledby={`initiative-section-title-${sectionStep}`}
              key={sectionStep}
            >
              {mode === "create" ? (
                <div className="initiative-wizard__panel-heading">
                  <span>PASO 0{sectionStep + 1} DE 04</span>
                  <p>{stepDescriptions[sectionStep]}</p>
                </div>
              ) : null}
              <h2 id={`initiative-section-title-${sectionStep}`}>
                {mode === "edit"
                  ? steps[sectionStep]
                  : stepHeadings[sectionStep]}
              </h2>
              {sectionStep === 0 ? (
                <div className="initiative-wizard__fields">
                  <label
                    className="ui-field initiative-wizard__field--wide"
                    htmlFor="initiative-project-name"
                  >
                    <span>Nombre del proyecto</span>
                    <small>Un nombre breve y fácil de reconocer.</small>
                    <input
                      id="initiative-project-name"
                      value={draft.title}
                      maxLength={255}
                      autoFocus
                      required
                      onChange={(event) =>
                        onChange({ ...draft, title: event.target.value })
                      }
                    />
                  </label>
                  <TextareaField
                    id="initiative-summary"
                    label="Resumen del proyecto"
                    hint="En pocas líneas, explica qué oportunidad estás explorando."
                    value={draft.proposalDetails.summary}
                    required={mode === "create"}
                    onChange={(value) => updateDetails({ summary: value })}
                  />
                  <TextareaField
                    id="initiative-problem"
                    label="Problemática identificada"
                    hint="¿Qué problemática o necesidad busca solucionar? Describe la situación actual, no la solución."
                    value={draft.problemStatement}
                    required
                    onChange={(value) =>
                      onChange({ ...draft, problemStatement: value })
                    }
                  />
                </div>
              ) : null}
              {sectionStep === 1 ? (
                <div className="initiative-wizard__fields">
                  <TextareaField
                    id="initiative-impacted-people"
                    label="Personas impactadas"
                    hint="¿Quiénes se ven impactados? Describe los grupos o perfiles afectados."
                    value={draft.proposalDetails.impactedPeople}
                    required={mode === "create"}
                    onChange={(value) =>
                      updateDetails({ impactedPeople: value })
                    }
                  />
                  <TextareaField
                    id="initiative-impact"
                    label="Impacto de la problemática"
                    hint="¿Qué consecuencias tiene para las personas o para la organización?"
                    value={draft.proposalDetails.problemImpact}
                    required={mode === "create"}
                    onChange={(value) =>
                      updateDetails({ problemImpact: value })
                    }
                  />
                  <label
                    className="ui-field initiative-wizard__field--compact"
                    htmlFor="initiative-impacted-count"
                  >
                    <span>¿Cuántas personas aproximadamente?</span>
                    <small>
                      Usa una estimación si todavía no tienes una cifra exacta.
                    </small>
                    <input
                      id="initiative-impacted-count"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={1_000_000_000}
                      step={1}
                      required={mode === "create"}
                      value={draft.proposalDetails.impactedCount ?? ""}
                      onChange={(event) =>
                        updateDetails({
                          impactedCount: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}
              {sectionStep === 2 ? (
                <div className="initiative-wizard__fields">
                  <TextareaField
                    id="initiative-value"
                    className="initiative-wizard__field--wide"
                    label="Propuesta de valor"
                    hint="¿Cómo y en cuánto podría mitigarse el impacto? Enfócate en un valor medible, no en describir la solución."
                    value={draft.expectedOutcome}
                    required
                    onChange={(value) =>
                      onChange({ ...draft, expectedOutcome: value })
                    }
                  />
                  <TextareaField
                    id="initiative-solution"
                    label="Solución"
                    hint="¿En qué consiste la solución que están desarrollando? Destaca sus elementos innovadores."
                    value={draft.proposalDetails.solution}
                    required={mode === "create"}
                    onChange={(value) => updateDetails({ solution: value })}
                  />
                  <TextareaField
                    id="initiative-differentiation"
                    label="¿Qué la hace diferente?"
                    hint="¿Por qué el proyecto es distinto o mejor que las alternativas existentes?"
                    value={draft.proposalDetails.differentiation}
                    required={mode === "create"}
                    onChange={(value) =>
                      updateDetails({ differentiation: value })
                    }
                  />
                </div>
              ) : null}
              {sectionStep === 3 ? (
                <div className="initiative-wizard__fields initiative-wizard__fields--pilotage">
                  <label
                    className="ui-field"
                    htmlFor="initiative-project-stage"
                  >
                    <span>Estado actual del proyecto</span>
                    <small>
                      Selecciona la etapa que mejor representa su avance actual.
                    </small>
                    <select
                      id="initiative-project-stage"
                      value={draft.proposalDetails.projectStage}
                      onChange={(event) =>
                        updateDetails({
                          projectStage: event.target
                            .value as InitiativeProposalDetails["projectStage"],
                        })
                      }
                    >
                      <option value="idea">Idea</option>
                      <option value="prototype">Prototipo</option>
                      <option value="in_development">En desarrollo</option>
                      <option value="operating">Funcionando</option>
                      <option value="other">Otra etapa</option>
                    </select>
                  </label>
                  <label
                    className="ui-field"
                    htmlFor="initiative-requested-priority"
                  >
                    <span>Prioridad solicitada</span>
                    <small>
                      Una referencia para el equipo; no reemplaza la prioridad
                      operativa de la organización.
                    </small>
                    <select
                      id="initiative-requested-priority"
                      value={draft.requestedPriority ?? ""}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          requestedPriority: event.target.value
                            ? (event.target.value as NonNullable<
                                InitiativeProposalDraft["requestedPriority"]
                              >)
                            : null,
                        })
                      }
                    >
                      <option value="">Sin definir</option>
                      <option value="low">Baja</option>
                      <option value="medium">Media</option>
                      <option value="high">Alta</option>
                    </select>
                  </label>
                  <TextareaField
                    id="initiative-stage-rationale"
                    className="initiative-wizard__field--wide"
                    label="Justificación de la etapa"
                    hint="¿Qué han validado o construido y por qué corresponde a este estado?"
                    value={draft.proposalDetails.stageRationale}
                    required={mode === "create"}
                    onChange={(value) =>
                      updateDetails({ stageRationale: value })
                    }
                  />
                  <TextareaField
                    id="initiative-pilot-plan"
                    label="Plan de pilotaje"
                    hint="¿Cómo planean realizar un pilotaje para validar la solución? Incluye participantes, duración y señales de éxito."
                    value={draft.proposalDetails.pilotPlan}
                    required={mode === "create"}
                    onChange={(value) => updateDetails({ pilotPlan: value })}
                  />
                  <TextareaField
                    id="initiative-pilot-resources"
                    label="Recursos para el pilotaje"
                    hint="¿Qué personas, tiempo, presupuesto, herramientas o accesos necesitan?"
                    value={draft.proposalDetails.pilotResources}
                    required={mode === "create"}
                    onChange={(value) =>
                      updateDetails({ pilotResources: value })
                    }
                  />
                  <label
                    className="ui-field initiative-wizard__field--compact"
                    htmlFor="initiative-classification"
                  >
                    <span>Clasificación</span>
                    <small>
                      Elige confidencial si la propuesta contiene información
                      sensible.
                    </small>
                    <select
                      id="initiative-classification"
                      value={draft.classification}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          classification: event.target
                            .value as InitiativeProposalDraft["classification"],
                        })
                      }
                    >
                      <option value="internal">Interna</option>
                      <option value="confidential">Confidencial</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </section>
          ))}
          <div
            className={`initiative-wizard__actions${mode === "edit" ? " initiative-wizard__actions--edit" : ""}`}
          >
            {mode === "edit" ? (
              <>
                <Button type="button" tone="quiet" onClick={onCancel}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Guardando…" : "Guardar cambios"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  tone="quiet"
                  onClick={onBack}
                  disabled={step === 0}
                >
                  Anterior
                </Button>
                <span>Paso {step + 1} de 4</span>
                {step < 3 ? (
                  <Button type="button" onClick={onContinue}>
                    Continuar <span aria-hidden="true">→</span>
                  </Button>
                ) : (
                  <Button type="submit" disabled={busy}>
                    {busy ? "Guardando…" : "Guardar como borrador"}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {mode === "create" ? (
          <aside
            className="initiative-wizard__preview"
            aria-label="Vista previa de la propuesta"
          >
            <p className="workspace-kicker">TU PROPUESTA</p>
            <span
              className="initiative-wizard__preview-icon"
              aria-hidden="true"
            >
              ✳
            </span>
            <h2>{draft.title.trim() || "Nombre del proyecto"}</h2>
            <p className="initiative-wizard__preview-summary">
              {draft.proposalDetails.summary.trim() ||
                "El resumen de la idea aparecerá aquí mientras la completas."}
            </p>
            <div className="initiative-wizard__preview-divider" />
            <p className="initiative-wizard__preview-label">
              PROBLEMA QUE ABORDA
            </p>
            <p className="initiative-wizard__preview-problem">
              {draft.problemStatement.trim() ||
                "Una descripción clara ayuda a evaluar la propuesta con contexto."}
            </p>
            <div className="initiative-wizard__preview-facts">
              <span>Personas impactadas</span>
              <strong>
                {draft.proposalDetails.impactedCount
                  ? new Intl.NumberFormat("es-CL").format(
                      draft.proposalDetails.impactedCount,
                    )
                  : "Por definir"}
              </strong>
            </div>
            <p className="initiative-wizard__privacy-note">
              Se guardará en{" "}
              <strong>
                {draft.classification === "confidential"
                  ? "modo confidencial"
                  : "tu espacio de trabajo"}
              </strong>{" "}
              como borrador; podrás revisarlo antes de presentarlo.
            </p>
          </aside>
        ) : null}
      </form>
    </div>
  );
}

function TextareaField({
  id,
  label,
  hint,
  value,
  onChange,
  className,
  required = false,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={`ui-field ${className ?? ""}`} htmlFor={id}>
      <span>{label}</span>
      <small id={`${id}-hint`}>{hint}</small>
      <textarea
        id={id}
        value={value}
        maxLength={10_000}
        required={required}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

const stepDescriptions = [
  "Pon la idea en contexto y describe la necesidad.",
  "Dimensiona quiénes viven el problema y sus consecuencias.",
  "Explica el valor, la solución y aquello que la distingue.",
  "Cuenta cómo validarán la idea y qué necesitan para hacerlo.",
] as const;

const stepHeadings = [
  "¿Qué quieres mejorar?",
  "¿A quién afecta y cómo?",
  "¿Qué valor puede generar?",
  "¿Cómo la llevarán a prueba?",
] as const;
