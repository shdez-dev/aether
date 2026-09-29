"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Circle,
  Inbox,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

type WorkKind = "owned" | "review" | "team_inbox" | "unblock" | "collaborator";
type WorkItem = {
  action: {
    id: string;
    projectId: string;
    description: string;
    workflowStatus:
      "to_do" | "in_progress" | "in_review" | "done" | "cancelled";
    dueOn: string | null;
    blockedReason: string | null;
    position: number;
  };
  kinds: WorkKind[];
};
const kindLabels: Record<WorkKind, string> = {
  owned: "Responsable",
  review: "Revisión pendiente",
  team_inbox: "Bandeja de equipo",
  unblock: "Desbloqueo",
  collaborator: "Colaboración",
};
const views = [
  { id: "all", label: "Todas" },
  { id: "to_do", label: "Por hacer" },
  { id: "in_progress", label: "En curso" },
  { id: "in_review", label: "En revisión" },
] as const;
type WorkView = (typeof views)[number]["id"];
const statusLabels = {
  to_do: "Por hacer",
  in_progress: "En curso",
  in_review: "En revisión",
  done: "Hecha",
  cancelled: "Cancelada",
};

function dueLabel(dueOn: string | null) {
  if (!dueOn) return { label: "Sin fecha", overdue: false };
  const due = new Date(dueOn + "T12:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sameDay = due.toDateString() === today.toDateString();
  return {
    label: sameDay
      ? "Hoy"
      : new Intl.DateTimeFormat("es-CL", {
          day: "numeric",
          month: "short",
        }).format(due),
    overdue: due < today,
  };
}

type MyWorkProps = {
  organizationId: string;
  refreshKey: number;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  onOpenProject: (projectId: string) => Promise<void>;
  onSummaryChange?: (activeTaskCount: number) => void;
} & (
  | { variant: "summary"; onViewAll: () => void }
  | { variant?: "full"; onViewAll?: never }
);

export function MyWork({
  organizationId,
  refreshKey,
  request,
  onOpenProject,
  onSummaryChange,
  variant = "full",
  onViewAll,
}: MyWorkProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [filter, setFilter] = useState<WorkKind | "all">("all");
  const [view, setView] = useState<WorkView>("all");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openError, setOpenError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void request(`organizations/${organizationId}/my-work`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error("No pudimos cargar tus tareas. Inténtalo otra vez.");
        const data = (await response.json()) as WorkItem[];
        if (active) {
          const open = data.filter(
            (item) =>
              !["done", "cancelled"].includes(item.action.workflowStatus),
          );
          setItems(open);
          onSummaryChange?.(open.length);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setItems([]);
          onSummaryChange?.(0);
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar Mi trabajo.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId, refreshKey, revision, request, onSummaryChange]);

  async function openProject(projectId: string) {
    if (opening) return;
    setOpening(projectId);
    setOpenError("");
    try {
      await onOpenProject(projectId);
    } catch (caught) {
      setOpenError(
        caught instanceof Error
          ? caught.message
          : "No se pudo abrir el proyecto.",
      );
      setItems([]);
      setRevision((current) => current + 1);
    } finally {
      setOpening(null);
    }
  }

  const related =
    filter === "all"
      ? items
      : items.filter((item) => item.kinds.includes(filter));
  const visible = related.filter(
    (item) => view === "all" || item.action.workflowStatus === view,
  );
  const filtered = filter !== "all" || view !== "all";

  if (variant === "summary") {
    return (
      <section
        className="day-panel day-task-preview"
        aria-label="Resumen de mis tareas"
      >
        <div className="day-task-preview__copy">
          <p className="day-eyebrow">TU FOCO PERSONAL</p>
          <h2>
            {loading
              ? "Revisando tus tareas…"
              : error
                ? "No pudimos consultar tus tareas"
                : items.length
                  ? `${items.length} ${items.length === 1 ? "tarea pendiente" : "tareas pendientes"}`
                  : "Todo al día"}
          </h2>
          <p role={loading ? "status" : error ? "alert" : undefined}>
            {loading
              ? "Buscando el trabajo que requiere de ti."
              : error ||
                (items.length
                  ? "Tu trabajo personal, reunido desde todos los espacios de esta organización."
                  : "No hay tareas que requieran de ti ahora. Cuando aparezcan, las encontrarás en Mis tareas.")}
          </p>
          {openError ? (
            <p className="day-error" role="alert">
              {openError}
            </p>
          ) : null}
        </div>
        <div className="day-task-preview__actions">
          {error ? (
            <button
              className="day-button day-button--quiet"
              type="button"
              onClick={() => setRevision((current) => current + 1)}
            >
              Reintentar
            </button>
          ) : null}
          <button
            className="day-button day-button--secondary"
            type="button"
            onClick={onViewAll}
          >
            Ver mis tareas <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      id="my-work"
      className="day-panel day-inbox"
      aria-label="Mi trabajo"
    >
      <div className="day-panel-heading">
        <div>
          <p className="day-eyebrow">TU FOCO PERSONAL</p>
          <div className="day-inbox-title">
            <h2>Tus pendientes</h2>
            {!loading && !error ? (
              <span className="day-count">{items.length}</span>
            ) : null}
          </div>
          <p className="day-panel-description">
            Tus tareas en todos los espacios de esta organización.
          </p>
        </div>
        <button
          className="day-icon-button"
          type="button"
          disabled={loading}
          onClick={() => setRevision((current) => current + 1)}
          aria-label="Actualizar tareas"
          title="Actualizar tareas"
        >
          <RefreshCw
            size={18}
            className={loading ? "day-spinning" : undefined}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="day-inbox-filters">
        <div
          className="day-filter-group"
          role="group"
          aria-label="Estado de las tareas"
        >
          {views.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={view === entry.id}
              onClick={() => setView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <label className="day-relation">
          <span>Relación</span>
          <select
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as WorkKind | "all")
            }
          >
            <option value="all">Todas</option>
            {(Object.entries(kindLabels) as [WorkKind, string][]).map(
              ([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ),
            )}
          </select>
        </label>
      </div>

      {openError ? (
        <p className="day-error" role="alert">
          {openError}
        </p>
      ) : null}
      {loading ? (
        <div className="day-loading" role="status">
          <span>Cargando tus pendientes…</span>
          <div aria-hidden="true" />
          <div aria-hidden="true" />
          <div aria-hidden="true" />
        </div>
      ) : error ? (
        <div className="day-empty">
          <TriangleAlert size={30} aria-hidden="true" />
          <h3>No pudimos cargar tus pendientes</h3>
          <p role="alert">{error}</p>
          <button
            className="day-button day-button--secondary"
            type="button"
            onClick={() => setRevision((current) => current + 1)}
          >
            Volver a intentar
          </button>
        </div>
      ) : !visible.length ? (
        <div className="day-empty">
          <div className="day-inbox-art" aria-hidden="true">
            <div className="day-inbox-sheet">
              <span />
              <span />
              <span />
            </div>
            <Inbox size={64} strokeWidth={1.1} />
            <span className="day-inbox-check">
              <Check size={16} strokeWidth={2.5} />
            </span>
          </div>
          <h3>
            {filtered
              ? "Sin tareas con estos filtros"
              : "Un poco de calma en tu día"}
          </h3>
          <p>
            {filtered
              ? "Prueba otra combinación para encontrar lo que buscas."
              : "No tienes tareas pendientes. Cuando necesiten de ti, las encontrarás aquí."}
          </p>
          {filtered ? (
            <button
              className="day-button day-button--secondary"
              type="button"
              onClick={() => {
                setView("all");
                setFilter("all");
              }}
            >
              Mostrar todas las tareas
            </button>
          ) : (
            <span className="day-empty-note">
              <span aria-hidden="true" />
              Bandeja al día
            </span>
          )}
        </div>
      ) : (
        <>
          <p className="day-result-count" role="status">
            {visible.length}{" "}
            {visible.length === 1 ? "tarea pendiente" : "tareas pendientes"}
          </p>
          <ul className="day-task-list">
            {visible.map((item) => {
              const due = dueLabel(item.action.dueOn);
              return (
                <li key={item.action.id} data-task-id={item.action.id}>
                  <Circle
                    className="day-task-marker"
                    size={18}
                    aria-hidden="true"
                  />
                  <div className="day-task-copy">
                    <strong>{item.action.description}</strong>
                    <div className="day-task-meta">
                      <span className="day-badge">
                        {statusLabels[item.action.workflowStatus]}
                      </span>
                      <span className="day-due" data-overdue={due.overdue}>
                        <CalendarDays size={13} aria-hidden="true" />
                        {due.overdue ? "Vencida · " : ""}
                        {due.label}
                      </span>
                    </div>
                    <div className="day-task-roles">
                      {item.kinds.map((kind) => (
                        <span key={kind}>{kindLabels[kind]}</span>
                      ))}
                    </div>
                    {item.action.blockedReason ? (
                      <p className="day-blocked">
                        <TriangleAlert size={14} aria-hidden="true" />
                        Bloqueada: {item.action.blockedReason}
                      </p>
                    ) : null}
                  </div>
                  <button
                    className="day-task-open"
                    type="button"
                    disabled={opening !== null}
                    onClick={() => void openProject(item.action.projectId)}
                    aria-label={
                      opening === item.action.projectId
                        ? "Abriendo proyecto"
                        : "Abrir proyecto"
                    }
                    title="Abrir proyecto"
                  >
                    <ArrowUpRight size={19} aria-hidden="true" />
                    {opening === item.action.projectId ? (
                      <span>Abriendo…</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="day-inbox-footer">
        <span aria-hidden="true">↳</span> Tu trabajo personal, aunque cambies de
        espacio.
      </div>
    </section>
  );
}
