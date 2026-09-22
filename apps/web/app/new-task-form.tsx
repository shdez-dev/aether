"use client";

import { FormEvent, useEffect, useState } from "react";

import type { TeamResponse } from "@aether/contracts";

type OwnerMode = "self" | "other" | "team";
type Priority = "low" | "medium" | "high";
type EffortUnit = "hours" | "days" | "points";

export function NewTaskForm({
  projectId,
  organizationId,
  workspaceId,
  actorId,
  request,
  onCreated,
  readOnly,
}: {
  projectId: string;
  organizationId: string;
  workspaceId: string;
  actorId: string;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  onCreated: () => void;
  readOnly: boolean;
}) {
  const [teams, setTeams] = useState<TeamResponse[]>([]);
  const [teamsError, setTeamsError] = useState("");
  const [description, setDescription] = useState("");
  const [ownerMode, setOwnerMode] = useState<OwnerMode>("self");
  const [otherOwner, setOtherOwner] = useState("");
  const [executorTeamId, setExecutorTeamId] = useState("");
  const [reviewerActorId, setReviewerActorId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [estimatedEffort, setEstimatedEffort] = useState("");
  const [effortUnit, setEffortUnit] = useState<EffortUnit>("hours");
  const [periodStartOn, setPeriodStartOn] = useState("");
  const [periodEndOn, setPeriodEndOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (readOnly) return;
    let active = true;
    setTeamsError("");
    void request(
      `organizations/${organizationId}/workspaces/${workspaceId}/teams`,
    )
      .then(async (response) => {
        const data = (await response.json()) as TeamResponse[];
        if (active) setTeams(data);
      })
      .catch((caught: unknown) => {
        if (active) {
          setTeams([]);
          setTeamsError(
            caught instanceof Error
              ? caught.message
              : "No se pudieron cargar los equipos.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [organizationId, workspaceId, request, readOnly]);

  const periodPaired = Boolean(periodStartOn) === Boolean(periodEndOn);
  const periodOrdered =
    !periodStartOn || !periodEndOn || periodStartOn <= periodEndOn;
  const teamRequired = ownerMode === "team" && !executorTeamId;
  const otherRequired = ownerMode === "other" && !otherOwner.trim();
  const effort = estimatedEffort ? Number(estimatedEffort) : null;
  const effortInvalid =
    effort !== null &&
    (!Number.isFinite(effort) || effort <= 0 || effort > 1_000_000);
  const invalid =
    !description.trim() ||
    teamRequired ||
    otherRequired ||
    effortInvalid ||
    !periodPaired ||
    !periodOrdered;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || invalid || readOnly) return;
    setBusy(true);
    setError("");
    try {
      await request(`projects/${projectId}/next-actions`, {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          description: description.trim(),
          ownerActorId:
            ownerMode === "team"
              ? null
              : ownerMode === "self"
                ? actorId
                : otherOwner.trim(),
          executorTeamId: executorTeamId || null,
          reviewerActorId: reviewerActorId.trim() || null,
          dueOn: dueOn || null,
          priority,
          estimatedEffort: effort,
          effortUnit: estimatedEffort ? effortUnit : null,
          periodStartOn: periodStartOn || null,
          periodEndOn: periodEndOn || null,
        }),
      });
      setDescription("");
      setOtherOwner("");
      setReviewerActorId("");
      setDueOn("");
      setEstimatedEffort("");
      setPeriodStartOn("");
      setPeriodEndOn("");
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible crear la tarea.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) return null;
  return (
    <form className="nested-form" onSubmit={(event) => void submit(event)}>
      <h3>Nueva tarea</h3>
      <label className="ui-field">
        Descripción
        <textarea
          required
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="form-grid">
        <label className="ui-field">
          Equipo ejecutor
          <select
            value={executorTeamId}
            onChange={(event) => setExecutorTeamId(event.target.value)}
          >
            <option value="">Sin equipo</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-field">
          Responsable
          <select
            value={ownerMode}
            onChange={(event) => setOwnerMode(event.target.value as OwnerMode)}
          >
            <option value="self">Yo</option>
            <option value="other">Otra persona</option>
            <option value="team">Sin responsable, en bandeja de equipo</option>
          </select>
        </label>
      </div>
      {ownerMode === "other" ? (
        <label className="ui-field">
          ID del responsable
          <input
            required
            maxLength={255}
            value={otherOwner}
            onChange={(event) => setOtherOwner(event.target.value)}
          />
        </label>
      ) : null}
      <div className="form-grid">
        <label className="ui-field">
          Revisor (ID; opcional)
          <input
            maxLength={255}
            value={reviewerActorId}
            onChange={(event) => setReviewerActorId(event.target.value)}
          />
        </label>
        <label className="ui-field">
          Fecha límite
          <input
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </label>
        <label className="ui-field">
          Prioridad
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
          >
            <option value="low">Baja</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
          </select>
        </label>
        <label className="ui-field">
          Estimación (opcional)
          <input
            type="number"
            min="0.001"
            max="1000000"
            step="any"
            value={estimatedEffort}
            onChange={(event) => setEstimatedEffort(event.target.value)}
          />
        </label>
        {estimatedEffort ? (
          <label className="ui-field">
            Unidad de estimación
            <select
              value={effortUnit}
              onChange={(event) =>
                setEffortUnit(event.target.value as EffortUnit)
              }
            >
              <option value="hours">Horas</option>
              <option value="days">Días</option>
              <option value="points">Puntos</option>
            </select>
          </label>
        ) : null}
        <label className="ui-field">
          Inicio del período (opcional)
          <input
            type="date"
            value={periodStartOn}
            onChange={(event) => setPeriodStartOn(event.target.value)}
          />
        </label>
        <label className="ui-field">
          Fin del período (opcional)
          <input
            type="date"
            value={periodEndOn}
            onChange={(event) => setPeriodEndOn(event.target.value)}
          />
        </label>
      </div>
      {teamsError ? <p role="alert">{teamsError}</p> : null}
      {teamRequired ? (
        <p role="alert">Elige un equipo para dejar la tarea sin responsable.</p>
      ) : null}
      {!periodPaired ? (
        <p role="alert">El período necesita inicio y fin.</p>
      ) : null}
      {!periodOrdered ? (
        <p role="alert">El fin del período debe ser posterior al inicio.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <button className="ui-button" type="submit" disabled={busy || invalid}>
        {busy ? "Creando…" : "Añadir tarea"}
      </button>
    </form>
  );
}
