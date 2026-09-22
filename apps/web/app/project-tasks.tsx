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
};
type Calendar = { dated: Task[]; undated: Task[] };
type View = "list" | "board" | "calendar";

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

function TaskCard({ task }: { task: Task }) {
  return (
    <li className="task-card" data-task-id={task.id}>
      <strong>{task.description}</strong>
      <small>
        {statuses.find((status) => status.value === task.workflowStatus)?.label}{" "}
        ·{task.ownerActorId ?? "Sin responsable"} · {task.dueOn ?? "Sin fecha"}·
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
    </li>
  );
}

export function ProjectTasks({
  projectId,
  organizationId,
  refreshKey,
  request,
}: {
  projectId: string;
  organizationId: string;
  refreshKey: unknown;
  request: (url: string, init?: RequestInit) => Promise<Response>;
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
  }, [projectId, organizationId, refreshKey, request, month, status]);

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
              <TaskCard key={task.id} task={task} />
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
                        <TaskCard key={task.id} task={task} />
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
                <TaskCard key={task.id} task={task} />
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
                        <TaskCard key={task.id} task={task} />
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
                  <TaskCard key={task.id} task={task} />
                ))}
              </ul>
            ) : (
              <p className="muted">No hay tareas sin fecha.</p>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
