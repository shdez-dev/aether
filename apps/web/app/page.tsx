"use client";

import { FormEvent, useCallback, useState } from "react";

import type { InitiativeResponse } from "@aether/contracts";
import {
  canRenderInitiativeAction,
  initiativeStatusLabel,
} from "../src/initiatives";

type DraftInput = Pick<
  InitiativeResponse,
  "title" | "problemStatement" | "expectedOutcome" | "classification"
>;

const emptyDraft: DraftInput = {
  title: "",
  problemStatement: "",
  expectedOutcome: "",
  classification: "internal",
};

export default function InitiativePage() {
  const [organizationId, setOrganizationId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [draft, setDraft] = useState<DraftInput>(emptyDraft);
  const [initiatives, setInitiatives] = useState<InitiativeResponse[]>([]);
  const [message, setMessage] = useState(
    "Indica una organización y un workspace para empezar.",
  );

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const csrf = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("aether_csrf="))
      ?.split("=")[1];
    const response = await fetch(`/api/aether/${url}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok)
      throw new Error(`La solicitud no pudo completarse (${response.status}).`);
    return response;
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await request(
        `initiatives?organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      setInitiatives((await response.json()) as InitiativeResponse[]);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No fue posible cargar las iniciativas.",
      );
    }
  }, [organizationId, request, workspaceId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await request("initiatives", {
        method: "POST",
        body: JSON.stringify({ organizationId, workspaceId, ...draft }),
      });
      const created = (await response.json()) as InitiativeResponse;
      setInitiatives((current) => [...current, created]);
      setDraft(emptyDraft);
      setMessage("Borrador creado.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No fue posible crear el borrador.",
      );
    }
  }

  async function transition(
    initiative: InitiativeResponse,
    action: "present" | "review" | "decide",
    decision?: "approved" | "rejected",
  ) {
    const endpoint = action === "present" ? "submit" : action;
    try {
      const response = await request(
        `initiatives/${initiative.id}/${endpoint}?organizationId=${encodeURIComponent(organizationId)}`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: initiative.version,
            ...(decision ? { decision } : {}),
          }),
        },
      );
      const updated = (await response.json()) as InitiativeResponse;
      setInitiatives((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setMessage("Estado actualizado.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No fue posible actualizar el estado.",
      );
    }
  }

  return (
    <main>
      <h1>Iniciativas institucionales</h1>
      <p>
        Los botones aparecen solo cuando el servidor autoriza la acción en el
        contexto actual.
      </p>
      <section className="context">
        <label>
          Organización
          <input
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          />
        </label>
        <label>
          Workspace
          <input
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          />
        </label>
        <button type="button" onClick={load}>
          Cargar iniciativas
        </button>
      </section>
      <form onSubmit={create}>
        <h2>Nueva iniciativa</h2>
        <label>
          Título
          <input
            required
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </label>
        <label>
          Problema
          <textarea
            required
            value={draft.problemStatement}
            onChange={(event) =>
              setDraft({ ...draft, problemStatement: event.target.value })
            }
          />
        </label>
        <label>
          Resultado esperado
          <textarea
            required
            value={draft.expectedOutcome}
            onChange={(event) =>
              setDraft({ ...draft, expectedOutcome: event.target.value })
            }
          />
        </label>
        <label>
          Clasificación
          <select
            value={draft.classification}
            onChange={(event) =>
              setDraft({
                ...draft,
                classification: event.target
                  .value as DraftInput["classification"],
              })
            }
          >
            <option value="internal">Interna</option>
            <option value="confidential">Confidencial</option>
          </select>
        </label>
        <button type="submit">Crear borrador</button>
      </form>
      {message && <p role="status">{message}</p>}
      <section className="list" aria-live="polite">
        {initiatives.map((initiative) => (
          <article key={initiative.id}>
            <div>
              <h2>{initiative.title}</h2>
              <span data-status={initiative.status}>
                {initiativeStatusLabel(initiative.status)}
              </span>
            </div>
            <p>{initiative.problemStatement}</p>
            <p>
              <strong>Resultado:</strong> {initiative.expectedOutcome}
            </p>
            <div className="actions">
              {canRenderInitiativeAction(initiative, "present") && (
                <button onClick={() => transition(initiative, "present")}>
                  Presentar
                </button>
              )}
              {canRenderInitiativeAction(initiative, "review") && (
                <button onClick={() => transition(initiative, "review")}>
                  Iniciar revisión
                </button>
              )}
              {canRenderInitiativeAction(initiative, "decide") && (
                <>
                  <button
                    onClick={() => transition(initiative, "decide", "approved")}
                  >
                    Aprobar
                  </button>
                  <button
                    onClick={() => transition(initiative, "decide", "rejected")}
                  >
                    Rechazar
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
