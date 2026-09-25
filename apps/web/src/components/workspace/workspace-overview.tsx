import type { ReactNode } from "react";
import { ArrowRight, Layers3 } from "lucide-react";
import type { InitiativeResponse, ProjectResponse } from "@aether/contracts";
import { initiativeStatusLabel } from "../../initiatives";
import { projectStatusLabel } from "../../lib/constants/project-status";
import type { WorkspaceView } from "./workspace-navigation";
import {
  buildWorkspacePhases,
  type WorkspacePhaseId,
} from "./workspace-phases";

type OverviewProps = {
  organizationName: string;
  workspaceName: string;
  initiatives: InitiativeResponse[];
  projects: ProjectResponse[];
  taskCount: number;
  loading: boolean;
  children: ReactNode;
  onNavigate: (view: WorkspaceView) => void;
  onCreateInitiative: () => void;
  onOpenInitiative: (initiative: InitiativeResponse) => void;
  onOpenProject: (project: ProjectResponse) => void;
};

const phaseStatus: Record<
  Exclude<WorkspacePhaseId, "project" | "tasks">,
  InitiativeResponse["status"][]
> = {
  initiative: ["draft"],
  diagnosis: ["presented"],
  evaluation: ["under_review"],
  decision: ["approved", "rejected", "returned", "cancelled"],
};

const initiativeNextAction: Record<InitiativeResponse["status"], string> = {
  draft: "Completar y presentar",
  presented: "Iniciar diagnóstico",
  under_review: "Continuar evaluación",
  returned: "Atender observaciones",
  approved: "Preparar proyecto",
  rejected: "Consultar la decisión",
  cancelled: "Consultar el cierre",
};

const initiativeTone: Record<
  InitiativeResponse["status"],
  "action" | "evaluation" | "attention" | "progress" | "neutral"
> = {
  draft: "action",
  presented: "attention",
  under_review: "evaluation",
  returned: "attention",
  approved: "progress",
  rejected: "neutral",
  cancelled: "neutral",
};

export function WorkspaceOverview({
  organizationName,
  workspaceName,
  initiatives,
  projects,
  taskCount,
  loading,
  children,
  onNavigate,
  onCreateInitiative,
  onOpenInitiative,
  onOpenProject,
}: OverviewProps) {
  const pending = initiatives.filter((item) =>
    ["presented", "under_review", "returned"].includes(item.status),
  );
  const drafts = initiatives.filter((item) => item.status === "draft");
  const activeProjects = projects.filter((item) => item.status === "active");
  const nextInitiative = pending[0] ?? drafts[0];
  const nextProject = nextInitiative ? undefined : activeProjects[0];
  const phases = buildWorkspacePhases(initiatives, projects, taskCount);
  const highlights = [
    ...pending
      .slice(0, 2)
      .map((item) => ({ type: "initiative" as const, item })),
    ...drafts
      .slice(0, 2)
      .map((item) => ({ type: "initiative" as const, item })),
    ...activeProjects
      .slice(0, 2)
      .map((item) => ({ type: "project" as const, item })),
  ].slice(0, 3);
  const date = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const dateLabel = date.charAt(0).toLocaleUpperCase("es-CL") + date.slice(1);

  function openPhase(phase: WorkspacePhaseId) {
    if (phase === "project") {
      onNavigate("projects");
      return;
    }
    if (phase === "tasks") {
      document
        .getElementById("my-work")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const item = initiatives.find((initiative) =>
      phaseStatus[phase].includes(initiative.status),
    );
    if (item) onOpenInitiative(item);
    else onNavigate("initiatives");
  }

  return (
    <div className="workspace-overview workspace-gravity" id="overview">
      <div className="workspace-overview__heading workspace-gravity__context">
        <div>
          <p className="workspace-kicker">MI DÍA · {workspaceName}</p>
          <h1>Hoy, con dirección.</h1>
          <p>
            Tu trabajo prioritario y el avance de {organizationName}, en un solo
            lugar.
          </p>
        </div>
        <span className="workspace-date">{dateLabel}</span>
      </div>

      <div className="workspace-gravity__grid">
        <div className="workspace-day-column">
          {children}
          <section className="workspace-next-step" aria-labelledby="next-title">
            <div className="workspace-next-step__heading">
              <p className="workspace-kicker">SIGUIENTE PASO</p>
              <span aria-hidden="true">02</span>
            </div>
            {nextInitiative ? (
              <>
                <div
                  className="workspace-next-step__status"
                  data-tone={initiativeTone[nextInitiative.status]}
                >
                  {initiativeStatusLabel(nextInitiative.status)}
                </div>
                <h2 id="next-title">{nextInitiative.title}</h2>
                <p>
                  Próxima acción:{" "}
                  <strong>{initiativeNextAction[nextInitiative.status]}</strong>
                </p>
                <button
                  type="button"
                  onClick={() => onOpenInitiative(nextInitiative)}
                >
                  Abrir iniciativa <ArrowRight size={15} aria-hidden="true" />
                </button>
              </>
            ) : nextProject ? (
              <>
                <div
                  className="workspace-next-step__status"
                  data-tone="progress"
                >
                  {projectStatusLabel(nextProject.status)}
                </div>
                <h2 id="next-title">{nextProject.name}</h2>
                <p>
                  Próximo hito:{" "}
                  <strong>
                    {nextProject.nextMilestone ?? "Revisar los próximos pasos"}
                  </strong>
                </p>
                <button
                  type="button"
                  onClick={() => onOpenProject(nextProject)}
                >
                  Abrir proyecto <ArrowRight size={15} aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <h2 id="next-title">Define una nueva dirección.</h2>
                <p>
                  No hay acciones pendientes. Cuando surja una idea, conviértela
                  en una iniciativa compartida.
                </p>
                <button type="button" onClick={onCreateInitiative}>
                  Crear iniciativa <ArrowRight size={15} aria-hidden="true" />
                </button>
              </>
            )}
          </section>
        </div>

        <section className="workspace-cycle" aria-labelledby="cycle-title">
          <div className="workspace-cycle__header">
            <p className="workspace-kicker">VISIÓN GENERAL</p>
            <h2 id="cycle-title">Estado del ciclo</h2>
            <p>Iniciativas y actividad en sus seis etapas</p>
          </div>

          <div className="workspace-cycle__visual">
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle
                className="workspace-cycle__orbit"
                cx="100"
                cy="100"
                r="91"
              />
              <path
                className="workspace-cycle__outline"
                d="M100 18 171 59v82l-71 41-71-41V59z"
              />
              <g className="workspace-cycle__mark">
                {[0, 60, 120, 180, 240, 300].map((angle) => (
                  <path
                    key={angle}
                    d="M78 52h44"
                    transform={"rotate(" + angle + " 100 100)"}
                  />
                ))}
              </g>
            </svg>
            <div
              className="workspace-cycle__core"
              role="img"
              aria-label={
                (loading ? "Cargando" : initiatives.length) +
                " iniciativas en el ciclo"
              }
            >
              <strong>{loading ? "—" : initiatives.length}</strong>
            </div>
          </div>

          <div className="workspace-cycle__stages">
            {phases.map((phase) => {
              return (
                <button
                  key={phase.id}
                  type="button"
                  className="workspace-cycle__stage"
                  data-tone={phase.tone}
                  onClick={() => openPhase(phase.id)}
                  aria-label={
                    phase.label + ": " + (loading ? "cargando" : phase.count)
                  }
                >
                  <span className="workspace-cycle__stage-index">
                    {String(phase.index).padStart(2, "0")}
                  </span>
                  <span className="workspace-cycle__stage-label">
                    {phase.label}
                  </span>
                  <strong>{loading ? "—" : phase.count}</strong>
                </button>
              );
            })}
          </div>
          <div className="workspace-cycle__summary">
            <span data-tone="attention">
              <strong>{loading ? "—" : pending.length}</strong>
              <small>requieren atención</small>
            </span>
            <span data-tone="progress">
              <strong>{loading ? "—" : activeProjects.length}</strong>
              <small>proyectos activos</small>
            </span>
          </div>
        </section>

        <section className="workspace-focus" aria-label="Puntos de continuidad">
          <div className="workspace-focus__header">
            <div>
              <p className="workspace-kicker">CONTINUIDAD</p>
              <h2>Retoma el hilo</h2>
            </div>
            <span className="workspace-focus__context">
              <Layers3 size={16} aria-hidden="true" /> Actividad reciente
            </span>
          </div>
          {highlights.length ? (
            <div className="workspace-focus__list">
              {highlights.map((entry) => (
                <button
                  key={entry.type + "-" + entry.item.id}
                  type="button"
                  onClick={() =>
                    entry.type === "initiative"
                      ? onOpenInitiative(entry.item)
                      : onOpenProject(entry.item)
                  }
                  className="workspace-focus__row"
                >
                  <span
                    className="workspace-focus__bullet"
                    data-tone={
                      entry.type === "initiative"
                        ? initiativeTone[entry.item.status]
                        : "progress"
                    }
                    aria-hidden="true"
                  />
                  <span className="workspace-focus__row-copy">
                    <strong>
                      {entry.type === "initiative"
                        ? entry.item.title
                        : entry.item.name}
                    </strong>
                    <small>
                      {entry.type === "initiative"
                        ? initiativeStatusLabel(entry.item.status) +
                          " → " +
                          initiativeNextAction[entry.item.status]
                        : "Proyecto · " +
                          projectStatusLabel(entry.item.status) +
                          " → Revisar próximos pasos"}
                    </small>
                  </span>
                  <span className="workspace-focus__meta">
                    {entry.type === "initiative"
                      ? entry.item.requestedPriority
                      : "Proyecto"}
                  </span>
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <div className="workspace-focus__empty">
              <p>
                Las iniciativas y los proyectos recientes aparecerán aquí con su
                estado y siguiente acción.
              </p>
              <button type="button" onClick={onCreateInitiative}>
                Crear la primera iniciativa
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
