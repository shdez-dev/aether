"use client";

import { useEffect, useState } from "react";

type WorkflowStatus =
  "to_do" | "in_progress" | "in_review" | "done" | "cancelled";
type Task = {
  id: string;
  description: string;
  workflowStatus: WorkflowStatus;
  position: number;
  ownerActorId: string | null;
  executorTeamId: string | null;
  reviewerActorId: string | null;
  blockedReason: string | null;
  unblockResponsibleActorId: string | null;
  dueOn: string | null;
  priority: "low" | "medium" | "high";
  version: number;
};
type Calendar = { dated: Task[]; undated: Task[] };
type View = "list" | "board" | "calendar";
type DateImpact = {
  actionId: string;
  expectedVersion: number;
  currentDueOn: string | null;
  proposedDueOn: string | null;
  predecessors: { actionId: string; dueOn: string | null }[];
  successors: { actionId: string; dueOn: string | null }[];
  pendingMilestones: { id: string; title: string; dueOn: string | null }[];
  impactToken: string;
};

const statuses: { value: WorkflowStatus; label: string }[] = [
  { value: "to_do", label: "Por hacer" },
  { value: "in_progress", label: "En curso" },
  { value: "in_review", label: "En revisión" },
  { value: "done", label: "Hecho" },
  { value: "cancelled", label: "Cancelado" },
];

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function TaskCard({
  task,
  onEditDate,
  readOnly,
}: {
  task: Task;
  onEditDate: (task: Task) => void;
  readOnly: boolean;
}) {
  return (
    <li className="task-card" data-task-id={task.id}>
      <strong>{task.description}</strong>
      <small>
        {statuses.find((status) => status.value === task.workflowStatus)?.label}
        {" · "}
        {task.ownerActorId ?? "Sin responsable"}
        {" · "}
        {task.dueOn ?? "Sin fecha"}
        {" · "}
        Prioridad {task.priority}
      </small>
      {task.executorTeamId ? (
        <small>Equipo: {task.executorTeamId}</small>
      ) : null}
      {task.reviewerActorId ? (
        <small>Revisor: {task.reviewerActorId}</small>
      ) : null}
      {task.blockedReason ? (
        <small className="task-blocked">
          Bloqueada: {task.blockedReason} · Desbloquea:{" "}
          {task.unblockResponsibleActorId}
        </small>
      ) : null}
      {!readOnly &&
      task.workflowStatus !== "done" &&
      task.workflowStatus !== "cancelled" ? (
        <button
          className="task-link-button"
          type="button"
          onClick={() => onEditDate(task)}
        >
          Cambiar fecha
        </button>
      ) : null}
    </li>
  );
}

export function ProjectTasks({
  projectId,
  organizationId,
  refreshKey,
  request,
  readOnly = false,
}: {
  projectId: string;
  organizationId: string;
  refreshKey: unknown;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  readOnly?: boolean;
}) {
  const [view, setView] = useState<View>("list");
  const [month, setMonth] = useState(currentMonth);
  const [status, setStatus] = useState<WorkflowStatus | "">("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendar, setCalendar] = useState<Calendar>({
    dated: [],
    undated: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateEdit, setDateEdit] = useState<{
    taskId: string;
    proposedDueOn: string;
  } | null>(null);
  const [dateImpact, setDateImpact] = useState<DateImpact | null>(null);
  const [dateBusy, setDateBusy] = useState(false);
  const [dateError, setDateError] = useState("");
  const [revision, setRevision] = useState(0);

  const selectedTask = tasks.find((task) => task.id === dateEdit?.taskId);
  function editDate(task: Task) {
    if (dateBusy || readOnly) return;
    setDateEdit({ taskId: task.id, proposedDueOn: task.dueOn ?? "" });
    setDateImpact(null);
    setDateError("");
  }

  async function previewDate() {
    if (!selectedTask || !dateEdit || readOnly) return;
    setDateBusy(true);
    setDateImpact(null);
    setDateError("");
    try {
      const query = new URLSearchParams({
        organizationId,
        expectedVersion: String(selectedTask.version),
      });
      if (dateEdit.proposedDueOn)
        query.set("proposedDueOn", dateEdit.proposedDueOn);
      const response = await request(
        `projects/${projectId}/next-actions/${selectedTask.id}/date-impact?${query}`,
      );
      setDateImpact((await response.json()) as DateImpact);
    } catch (caught) {
      setDateError(
        caught instanceof Error
          ? caught.message
          : "No se pudo revisar el impacto.",
      );
    } finally {
      setDateBusy(false);
    }
  }

  async function confirmDate() {
    if (!selectedTask || !dateEdit || !dateImpact || dateBusy || readOnly)
      return;
    if (
      dateImpact.actionId !== selectedTask.id ||
      dateImpact.expectedVersion !== selectedTask.version ||
      dateImpact.proposedDueOn !== (dateEdit.proposedDueOn || null)
    )
      return;
    setDateBusy(true);
    setDateError("");
    try {
      await request(
        `projects/${projectId}/next-actions/${selectedTask.id}/date`,
        {
          method: "POST",
          body: JSON.stringify({
            organizationId,
            expectedVersion: selectedTask.version,
            proposedDueOn: dateImpact.proposedDueOn,
            impactToken: dateImpact.impactToken,
          }),
        },
      );
      setDateEdit(null);
      setDateImpact(null);
      setRevision((current) => current + 1);
    } catch (caught) {
      setDateImpact(null);
      setDateError(
        caught instanceof Error
          ? caught.message
          : "No se pudo cambiar la fecha.",
      );
      setRevision((current) => current + 1);
    } finally {
      setDateBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    const [year, monthNumber] = month.split("-").map(Number);
    if (!year || !monthNumber) return;
    const endDay = new Date(year, monthNumber, 0).getDate();
    const query = new URLSearchParams({ organizationId });
    if (status) query.set("workflowStatus", status);
    const calendarQuery = new URLSearchParams(query);
    calendarQuery.set("fromOn", `${month}-01`);
    calendarQuery.set("toOn", `${month}-${String(endDay).padStart(2, "0")}`);
    setLoading(true);
    setError("");
    void Promise.all([
      request(`projects/${projectId}/next-actions?${query}`),
      request(`projects/${projectId}/next-actions/calendar?${calendarQuery}`),
    ])
      .then(async ([listResponse, calendarResponse]) => {
        const [list, monthCalendar] = await Promise.all([
          listResponse.json() as Promise<Task[]>,
          calendarResponse.json() as Promise<Calendar>,
        ]);
        if (active) {
          setTasks(list);
          setCalendar(monthCalendar);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudieron cargar las tareas.",
          );
          setTasks([]);
          setCalendar({ dated: [], undated: [] });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, organizationId, refreshKey, request, month, status, revision]);

  const [year, monthNumber] = month.split("-").map(Number);
  const dayCount =
    year && monthNumber ? new Date(year, monthNumber, 0).getDate() : 0;
  const firstWeekday =
    year && monthNumber
      ? (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7
      : 0;
  const tasksByDay = new Map<string, Task[]>();
  for (const task of calendar.dated) {
    if (!task.dueOn) continue;
    const dayTasks = tasksByDay.get(task.dueOn) ?? [];
    dayTasks.push(task);
    tasksByDay.set(task.dueOn, dayTasks);
  }

  return (
    <section className="ui-card project-tasks" aria-label="Tareas del proyecto">
      <div className="task-toolbar">
        <div>
          <h2>Tareas del proyecto</h2>
          <p className="muted">
            Lista, tablero y calendario muestran las mismas tareas.
          </p>
        </div>
        <label className="ui-field">
          Estado
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as WorkflowStatus | "")
            }
          >
            <option value="">Todos</option>
            {statuses.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="task-view-switch"
        role="group"
        aria-label="Vista de tareas"
      >
        {(["list", "board", "calendar"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => setView(option)}
          >
            {
              { list: "Lista", board: "Tablero", calendar: "Calendario" }[
                option
              ]
            }
          </button>
        ))}
      </div>
      {loading ? <p role="status">Cargando tareas…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && view === "list" ? (
        tasks.length ? (
          <ul className="task-list">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onEditDate={editDate}
                readOnly={readOnly}
              />
            ))}
          </ul>
        ) : (
          <p className="muted">No hay tareas con este filtro.</p>
        )
      ) : null}
      {!loading && !error && view === "board" ? (
        <div className="task-board">
          {statuses
            .filter((column) => column.value !== "cancelled")
            .map((column) => {
              const columnTasks = tasks
                .filter((task) => task.workflowStatus === column.value)
                .sort((a, b) => a.position - b.position);
              return (
                <section
                  key={column.value}
                  className="task-column"
                  aria-label={column.label}
                >
                  <h3>
                    {column.label} ({columnTasks.length})
                  </h3>
                  {columnTasks.length ? (
                    <ul className="task-list">
                      {columnTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onEditDate={editDate}
                          readOnly={readOnly}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">Sin tareas.</p>
                  )}
                </section>
              );
            })}
        </div>
      ) : null}
      {!loading &&
      !error &&
      view === "board" &&
      tasks.some((task) => task.workflowStatus === "cancelled") ? (
        <section className="task-undated" aria-label="Tareas canceladas">
          <h3>Canceladas</h3>
          <ul className="task-list">
            {tasks
              .filter((task) => task.workflowStatus === "cancelled")
              .map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onEditDate={editDate}
                  readOnly={readOnly}
                />
              ))}
          </ul>
        </section>
      ) : null}
      {!loading && !error && view === "calendar" ? (
        <>
          <label className="ui-field task-month">
            Mes
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <div className="task-calendar" aria-label={`Calendario ${month}`}>
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
              <strong key={day} className="task-weekday">
                {day}
              </strong>
            ))}
            {Array.from({ length: firstWeekday }, (_, index) => (
              <span key={`blank-${index}`} aria-hidden="true" />
            ))}
            {Array.from({ length: dayCount }, (_, index) => {
              const date = `${month}-${String(index + 1).padStart(2, "0")}`;
              const dayTasks = tasksByDay.get(date) ?? [];
              return (
                <section key={date} className="task-day" aria-label={date}>
                  <strong>{index + 1}</strong>
                  {dayTasks.length ? (
                    <ul className="task-list">
                      {dayTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onEditDate={editDate}
                          readOnly={readOnly}
                        />
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
          <section className="task-undated" aria-label="Sin fecha">
            <h3>Sin fecha ({calendar.undated.length})</h3>
            {calendar.undated.length ? (
              <ul className="task-list">
                {calendar.undated.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onEditDate={editDate}
                    readOnly={readOnly}
                  />
                ))}
              </ul>
            ) : (
              <p className="muted">No hay tareas sin fecha.</p>
            )}
          </section>
        </>
      ) : null}
      {!readOnly && selectedTask && dateEdit ? (
        <section
          className="task-date-editor"
          aria-label="Cambiar fecha de tarea"
        >
          <h3>Fecha de {selectedTask.description}</h3>
          <p className="muted">
            Fecha actual: {selectedTask.dueOn ?? "Sin fecha"}
          </p>
          <form
            className="nested-form"
            onSubmit={(event) => {
              event.preventDefault();
              void previewDate();
            }}
          >
            <label className="ui-field task-month">
              Nueva fecha (vacía = sin fecha)
              <input
                type="date"
                value={dateEdit.proposedDueOn}
                disabled={dateBusy}
                onChange={(event) => {
                  setDateEdit({
                    ...dateEdit,
                    proposedDueOn: event.target.value,
                  });
                  setDateImpact(null);
                }}
              />
            </label>
            <div className="form-actions">
              <button className="ui-button" type="submit" disabled={dateBusy}>
                Revisar impacto
              </button>
              <button
                className="task-link-button"
                type="button"
                disabled={dateBusy}
                onClick={() => {
                  setDateEdit(null);
                  setDateImpact(null);
                  setDateError("");
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
          {dateError ? <p role="alert">{dateError}</p> : null}
          {dateImpact ? (
            <div className="task-date-impact">
              <h3>Impacto antes de confirmar</h3>
              <p>
                {dateImpact.currentDueOn ?? "Sin fecha"} →{" "}
                {dateImpact.proposedDueOn ?? "Sin fecha"}
              </p>
              <p>
                Predecesoras:{" "}
                {dateImpact.predecessors.length
                  ? dateImpact.predecessors
                      .map(
                        (item) =>
                          `${item.actionId} (${item.dueOn ?? "sin fecha"})`,
                      )
                      .join(", ")
                  : "ninguna"}
                .
              </p>
              <p>
                Sucesoras:{" "}
                {dateImpact.successors.length
                  ? dateImpact.successors
                      .map(
                        (item) =>
                          `${item.actionId} (${item.dueOn ?? "sin fecha"})`,
                      )
                      .join(", ")
                  : "ninguna"}
                .
              </p>
              <p>
                Hitos pendientes:{" "}
                {dateImpact.pendingMilestones.length
                  ? dateImpact.pendingMilestones
                      .map(
                        (item) =>
                          `${item.title} (${item.dueOn ?? "sin fecha"})`,
                      )
                      .join(", ")
                  : "ninguno"}
                .
              </p>
              <p className="muted">
                Las fechas relacionadas no cambian automáticamente.
              </p>
              <button
                className="ui-button"
                type="button"
                disabled={dateBusy}
                onClick={() => void confirmDate()}
              >
                Confirmar cambio de fecha
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
