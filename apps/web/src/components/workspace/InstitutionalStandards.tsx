"use client";

import { Check, ClipboardCheck, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  AccessCapabilitiesResponse,
  EvaluationStandardResponse,
} from "@aether/contracts";

type Request = (url: string, init?: RequestInit) => Promise<Response>;
type CriterionDraft = {
  key: string;
  name: string;
  description: string;
  dimension: string;
  weight: number;
  isExclusionary: boolean;
};
type MaturityLevelDraft = {
  key: string;
  name: string;
  minimumQualityPercentage: number;
};

const emptyCriterion = (): CriterionDraft => ({
  key: crypto.randomUUID(),
  name: "",
  description: "",
  dimension: "",
  weight: 1,
  isExclusionary: false,
});

const emptyMaturityLevel = (): MaturityLevelDraft => ({
  key: crypto.randomUUID(),
  name: "",
  minimumQualityPercentage: 0,
});

export function InstitutionalStandards({
  organizationId,
  capabilities,
  request,
  onActivated,
}: {
  organizationId: string;
  capabilities: AccessCapabilitiesResponse;
  request: Request;
  onActivated: () => void;
}) {
  const canRead = capabilities.canManageOrganization;
  const canConfigure = capabilities.accessLevels.includes("ADMIN");
  const [standards, setStandards] = useState<EvaluationStandardResponse[]>([]);
  const [loading, setLoading] = useState(canRead);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [revision, setRevision] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [criteria, setCriteria] = useState<CriterionDraft[]>([
    {
      key: "first",
      name: "",
      description: "",
      dimension: "",
      weight: 1,
      isExclusionary: false,
    },
  ]);
  const [maturityLevels, setMaturityLevels] = useState<MaturityLevelDraft[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [pendingActivation, setPendingActivation] = useState<string | null>(
    null,
  );
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    setStandards([]);
    void request(`evaluation-standards?organizationId=${organizationId}`)
      .then(async (response) => {
        const data = (await response.json()) as EvaluationStandardResponse[];
        if (active) setStandards(data);
      })
      .catch((caught) => {
        if (active)
          setLoadError(
            caught instanceof Error
              ? caught.message
              : "No se pudieron cargar los estándares.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canRead, organizationId, request, revision]);

  useEffect(() => {
    if (showForm) nameField.current?.focus({ preventScroll: true });
  }, [showForm]);

  const activeStandard = standards.find((standard) => standard.isActive);
  const version =
    Math.max(
      0,
      ...standards
        .filter((standard) => standard.name === name.trim())
        .map((standard) => standard.version),
    ) + 1;

  function updateCriterion(key: string, change: Partial<CriterionDraft>) {
    setCriteria((current) =>
      current.map((criterion) =>
        criterion.key === key ? { ...criterion, ...change } : criterion,
      ),
    );
  }

  function updateMaturityLevel(
    key: string,
    change: Partial<MaturityLevelDraft>,
  ) {
    setMaturityLevels((current) =>
      current.map((level) =>
        level.key === key ? { ...level, ...change } : level,
      ),
    );
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfigure || busy) return;
    if (
      !name.trim() ||
      criteria.some(
        (criterion) =>
          !criterion.name.trim() ||
          !criterion.description.trim() ||
          !Number.isFinite(criterion.weight) ||
          criterion.weight <= 0,
      ) ||
      maturityLevels.some(
        (level) =>
          !level.name.trim() ||
          !Number.isInteger(level.minimumQualityPercentage) ||
          level.minimumQualityPercentage < 0 ||
          level.minimumQualityPercentage > 100,
      )
    ) {
      setError("Completa los criterios y niveles con valores válidos.");
      return;
    }
    if (
      new Set(maturityLevels.map((level) => level.minimumQualityPercentage))
        .size !== maturityLevels.length
    ) {
      setError("Cada nivel debe tener un porcentaje mínimo distinto.");
      return;
    }
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await request("evaluation-standards", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name: name.trim(),
          version,
          criteria: criteria.map((criterion, index) => ({
            id: crypto.randomUUID(),
            code: `C${String(index + 1).padStart(2, "0")}`,
            name: criterion.name.trim(),
            description: criterion.description.trim(),
            weight: criterion.weight,
            dimension: criterion.dimension.trim() || "general",
            isExclusionary: criterion.isExclusionary,
          })),
          maturityLevels: maturityLevels.map((level, index) => ({
            code: `N${String(index + 1).padStart(2, "0")}`,
            name: level.name.trim(),
            minimumQualityPercentage: level.minimumQualityPercentage,
          })),
        }),
      });
      setShowForm(false);
      setName("");
      setCriteria([emptyCriterion()]);
      setMaturityLevels([]);
      setFeedback(
        "Versión publicada. Actívala cuando el equipo esté listo para aplicarla.",
      );
      setRevision((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo publicar el estándar.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function activate(standardId: string) {
    if (!canConfigure || busy) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await request(`evaluation-standards/${standardId}/activate`, {
        method: "POST",
        body: JSON.stringify({ organizationId }),
      });
      setPendingActivation(null);
      setFeedback(
        "Estándar activado. Las nuevas evaluaciones usarán esta versión.",
      );
      setRevision((current) => current + 1);
      onActivated();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo activar el estándar.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="organization-page__card organization-page__card--institutional"
      id="organization-institutional"
      aria-labelledby="organization-institutional-title"
    >
      <div className="organization-page__card-heading organization-page__card-heading--action">
        <span className="organization-page__card-icon">
          <ClipboardCheck size={20} aria-hidden="true" />
        </span>
        <div>
          <p className="organization-page__eyebrow">
            EVALUACIÓN DE INICIATIVAS
          </p>
          <h2 id="organization-institutional-title">Estándar de evaluación</h2>
          <p>
            Define los criterios antes de evaluar iniciativas. Cada versión
            queda conservada con las evaluaciones que la utilizaron.
          </p>
        </div>
        {canConfigure && !showForm ? (
          <button
            type="button"
            className="organization-page__secondary"
            onClick={() => setShowForm(true)}
          >
            <Plus size={16} aria-hidden="true" />
            Nueva versión
          </button>
        ) : null}
      </div>
      {!canRead ? (
        <p className="organization-page__hint">
          La administración de la organización configura este estándar. Tu
          acceso a iniciativas depende de tus permisos y asignaciones.
        </p>
      ) : null}
      {canRead && loading ? (
        <p className="organization-page__hint" role="status">
          Cargando estándares…
        </p>
      ) : null}
      {loadError ? (
        <div className="organization-page__feedback is-error" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Reintentar
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="organization-page__feedback is-error" role="alert">
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p className="organization-page__feedback is-success" role="status">
          <Check size={16} aria-hidden="true" />
          {feedback}
        </p>
      ) : null}
      {canRead && !loading && !loadError ? (
        <div className="organization-page__standard-content">
          <div className="organization-page__standard-summary">
            <span
              className="organization-page__standard-indicator"
              data-active={Boolean(activeStandard)}
            />
            <div>
              <strong>
                {activeStandard
                  ? `${activeStandard.name} · v${activeStandard.version}`
                  : "Sin estándar activo"}
              </strong>
              <p>
                {activeStandard
                  ? `${activeStandard.criteria.length} criterios para evaluar nuevas propuestas.`
                  : "Las iniciativas pueden presentarse, pero aún no evaluarse."}
              </p>
            </div>
          </div>
          {standards.length ? (
            <div className="organization-page__standard-versions">
              <h3>Versiones publicadas</h3>
              <ul>
                {standards.map((standard) => (
                  <li key={standard.id}>
                    <div className="organization-page__standard-version-row">
                      <span>
                        <strong>{standard.name}</strong>
                        <small>
                          Versión {standard.version} ·{" "}
                          {standard.criteria.length}{" "}
                          {standard.criteria.length === 1
                            ? "criterio"
                            : "criterios"}
                        </small>
                      </span>
                      {standard.isActive ? (
                        <span className="organization-page__standard-active">
                          <Check size={14} aria-hidden="true" /> Activo
                        </span>
                      ) : canConfigure ? (
                        pendingActivation === standard.id ? (
                          <span className="organization-page__standard-confirm">
                            <button
                              type="button"
                              className="organization-page__primary"
                              disabled={busy}
                              onClick={() => void activate(standard.id)}
                            >
                              {busy ? "Activando…" : "Confirmar"}
                            </button>
                            <button
                              type="button"
                              className="organization-page__icon-button"
                              aria-label="Cancelar activación"
                              onClick={() => setPendingActivation(null)}
                              disabled={busy}
                            >
                              <X size={16} aria-hidden="true" />
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="organization-page__text-button"
                            onClick={() => setPendingActivation(standard.id)}
                          >
                            Activar
                          </button>
                        )
                      ) : null}
                    </div>
                    <details className="organization-page__standard-details">
                      <summary>Ver criterios y niveles</summary>
                      <dl>
                        {standard.criteria.map((criterion) => (
                          <div key={criterion.id}>
                            <dt>
                              {criterion.name} · {criterion.dimension}
                            </dt>
                            <dd>{criterion.description}</dd>
                            <dd>
                              Peso {criterion.weight}
                              {criterion.isExclusionary
                                ? " · Obligatorio para aprobar"
                                : ""}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {standard.maturityLevels.length ? (
                        <p>
                          Niveles:{" "}
                          {standard.maturityLevels
                            .map(
                              (level) =>
                                `${level.name} (desde ${level.minimumQualityPercentage} %)`,
                            )
                            .join(" · ")}
                        </p>
                      ) : (
                        <p>Sin niveles de madurez configurados.</p>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {pendingActivation ? (
            <p className="organization-page__hint">
              Al activar otra versión, las próximas evaluaciones usarán sus
              criterios; el historial anterior se conserva.
            </p>
          ) : null}
          {!canConfigure ? (
            <p className="organization-page__hint">
              Solo la persona propietaria puede publicar o activar estándares.
            </p>
          ) : null}
        </div>
      ) : null}
      {canConfigure && showForm ? (
        <form className="organization-page__standard-form" onSubmit={publish}>
          <div className="organization-page__standard-form-heading">
            <div>
              <h3>Nueva versión del estándar</h3>
              <p>Publicarla no la activa automáticamente.</p>
            </div>
            <button
              type="button"
              className="organization-page__icon-button"
              aria-label="Cerrar formulario de estándar"
              onClick={() => setShowForm(false)}
              disabled={busy}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="organization-page__standard-form-top">
            <label className="organization-page__field">
              <span>Nombre del estándar</span>
              <input
                ref={nameField}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={255}
                placeholder="Ej. Evaluación de iniciativas"
                required
                disabled={busy}
              />
            </label>
            <p className="organization-page__standard-version">
              Versión <strong>{version}</strong>
              <small>Se calcula para este nombre.</small>
            </p>
          </div>
          <div className="organization-page__standard-criteria">
            <div className="organization-page__standard-criteria-heading">
              <h4>Criterios</h4>
              <button
                type="button"
                className="organization-page__text-button"
                onClick={() =>
                  setCriteria((current) => [...current, emptyCriterion()])
                }
                disabled={busy || criteria.length >= 100}
              >
                <Plus size={15} aria-hidden="true" /> Añadir criterio
              </button>
            </div>
            {criteria.map((criterion, index) => (
              <fieldset
                key={criterion.key}
                className="organization-page__criterion"
              >
                <legend>Criterio {index + 1}</legend>
                <div className="organization-page__criterion-fields">
                  <label className="organization-page__field">
                    <span>Nombre</span>
                    <input
                      value={criterion.name}
                      onChange={(event) =>
                        updateCriterion(criterion.key, {
                          name: event.target.value,
                        })
                      }
                      maxLength={255}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label className="organization-page__field">
                    <span>Peso relativo</span>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={criterion.weight}
                      onChange={(event) =>
                        updateCriterion(criterion.key, {
                          weight: Number(event.target.value),
                        })
                      }
                      required
                      disabled={busy}
                    />
                  </label>
                  <label className="organization-page__field organization-page__field--full">
                    <span>Dimensión</span>
                    <input
                      value={criterion.dimension}
                      onChange={(event) =>
                        updateCriterion(criterion.key, {
                          dimension: event.target.value,
                        })
                      }
                      maxLength={255}
                      placeholder="Ej. Impacto, factibilidad…"
                      disabled={busy}
                    />
                  </label>
                  <label className="organization-page__field organization-page__field--full">
                    <span>Qué se evaluará</span>
                    <input
                      value={criterion.description}
                      onChange={(event) =>
                        updateCriterion(criterion.key, {
                          description: event.target.value,
                        })
                      }
                      maxLength={2000}
                      required
                      disabled={busy}
                    />
                  </label>
                </div>
                <div className="organization-page__criterion-options">
                  <label>
                    <input
                      type="checkbox"
                      checked={criterion.isExclusionary}
                      onChange={(event) =>
                        updateCriterion(criterion.key, {
                          isExclusionary: event.target.checked,
                        })
                      }
                      disabled={busy}
                    />
                    Obligatorio para aprobar
                  </label>
                  {criteria.length > 1 ? (
                    <button
                      type="button"
                      className="organization-page__text-button"
                      onClick={() =>
                        setCriteria((current) =>
                          current.filter((item) => item.key !== criterion.key),
                        )
                      }
                      disabled={busy}
                    >
                      Quitar
                    </button>
                  ) : null}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="organization-page__standard-criteria">
            <div className="organization-page__standard-criteria-heading">
              <div>
                <h4>Niveles de madurez</h4>
                <p>Opcionales; indican el umbral mínimo de calidad.</p>
              </div>
              <button
                type="button"
                className="organization-page__text-button"
                onClick={() =>
                  setMaturityLevels((current) => [
                    ...current,
                    emptyMaturityLevel(),
                  ])
                }
                disabled={busy || maturityLevels.length >= 10}
              >
                <Plus size={15} aria-hidden="true" /> Añadir nivel
              </button>
            </div>
            {maturityLevels.map((level, index) => (
              <fieldset
                key={level.key}
                className="organization-page__criterion"
              >
                <legend>Nivel {index + 1}</legend>
                <div className="organization-page__criterion-fields">
                  <label className="organization-page__field">
                    <span>Nombre</span>
                    <input
                      value={level.name}
                      onChange={(event) =>
                        updateMaturityLevel(level.key, {
                          name: event.target.value,
                        })
                      }
                      maxLength={255}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label className="organization-page__field">
                    <span>Calidad mínima (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={level.minimumQualityPercentage}
                      onChange={(event) =>
                        updateMaturityLevel(level.key, {
                          minimumQualityPercentage: Number(event.target.value),
                        })
                      }
                      required
                      disabled={busy}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="organization-page__text-button"
                  onClick={() =>
                    setMaturityLevels((current) =>
                      current.filter((item) => item.key !== level.key),
                    )
                  }
                  disabled={busy}
                >
                  Quitar nivel
                </button>
              </fieldset>
            ))}
          </div>
          <div className="organization-page__form-footer">
            <p>
              Un peso de 2 cuenta el doble que uno de 1. Cada versión es
              inmutable.
            </p>
            <button
              type="submit"
              className="organization-page__primary"
              disabled={busy || !name.trim()}
            >
              {busy ? "Publicando…" : "Publicar versión"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
