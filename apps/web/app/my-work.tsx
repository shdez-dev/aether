"use client";

import { useEffect, useState } from "react";

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
const statusLabels: Record<WorkItem["action"]["workflowStatus"], string> = {
  to_do: "Por hacer",
  in_progress: "En curso",
  in_review: "En revisión",
  done: "Hecha",
  cancelled: "Cancelada",
};

export function MyWork({
  organizationId,
  refreshKey,
  request,
  onOpenProject,
}: {
  organizationId: string;
  refreshKey: number;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  onOpenProject: (projectId: string) => Promise<void>;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [filter, setFilter] = useState<WorkKind | "all">("all");
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
        const data = (await response.json()) as WorkItem[];
        if (active) setItems(data);
      })
      .catch((caught: unknown) => {
        if (active) {
          setItems([]);
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
  }, [organizationId, refreshKey, revision, request]);

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

  const visible =
    filter === "all"
      ? items
      : items.filter((item) => item.kinds.includes(filter));
  return (
    <section id="my-work" className="ui-card" aria-label="Mi trabajo">
      <div className="task-toolbar">
        <div>
          <h2>Mi trabajo</h2>
          <p className="muted">
            Tareas visibles para ti en esta organización, aunque estén en otro
            workspace.
          </p>
        </div>
        <div className="form-actions">
          <label className="ui-field">
            Relación
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
          <button
            className="ui-button"
            type="button"
            disabled={loading}
            onClick={() => setRevision((current) => current + 1)}
          >
            Actualizar
          </button>
        </div>
      </div>
      {loading ? <p role="status">Cargando trabajo…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {openError ? <p role="alert">{openError}</p> : null}
      {!loading && !error && visible.length === 0 ? (
        <p className="muted">No hay tareas con esta relación.</p>
      ) : null}
      {!loading && !error && visible.length > 0 ? (
        <ul className="task-list my-work-list">
          {visible.map((item) => (
            <li
              className="task-card"
              key={item.action.id}
              data-task-id={item.action.id}
            >
              <strong>{item.action.description}</strong>
              <small>
                {statusLabels[item.action.workflowStatus]} ·{" "}
                {item.action.dueOn ?? "Sin fecha"} · Posición{" "}
                {item.action.position}
              </small>
              <div className="work-kinds">
                {item.kinds.map((kind) => (
                  <span className="ui-status" key={kind}>
                    {kindLabels[kind]}
                  </span>
                ))}
              </div>
              {item.action.blockedReason ? (
                <small className="task-blocked">
                  Bloqueada: {item.action.blockedReason}
                </small>
              ) : null}
              <button
                className="task-link-button"
                type="button"
                disabled={opening !== null}
                onClick={() => void openProject(item.action.projectId)}
              >
                {opening === item.action.projectId
                  ? "Abriendo…"
                  : "Abrir proyecto"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
