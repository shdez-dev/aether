"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import type {
  AccessCapabilitiesResponse,
  EvaluationStandardResponse,
  InitiativeAuditEvent,
  InitiativeDecisionResponse,
  InitiativeEvaluationResponse,
  InitiativeResponse,
  OrganizationResponse,
  ProjectBaselineDifferenceResponse,
  ProjectResponse,
  WorkspaceResponse,
} from "@aether/contracts";
import { Button, Card, Field, Notice, Status } from "@aether/ui";

import {
  canRenderInitiativeAction,
  initiativeStatusLabel,
} from "../src/initiatives";
import { ProjectTasks } from "./project-tasks";

type Draft = Pick<
  InitiativeResponse,
  "title" | "problemStatement" | "expectedOutcome" | "classification"
>;
type Session = { actorId: string; expiresAt: string };
type ProjectAuditEvent = {
  id: string;
  eventType: string;
  actorId: string;
  occurredAt: string;
};
const baselineFieldLabels: Record<
  ProjectBaselineDifferenceResponse["differences"][number]["field"],
  string
> = {
  name: "Nombre",
  objective: "Objetivo",
  boundaries: "Límites",
  successCriteria: "Criterios de éxito",
  nextMilestone: "Próximo hito",
  sponsorActorId: "Patrocinador",
  leadActorId: "Líder",
  participants: "Participantes",
  status: "Estado",
};

const emptyDraft: Draft = {
  title: "",
  problemStatement: "",
  expectedOutcome: "",
  classification: "internal",
};
const emptyCapabilities: AccessCapabilitiesResponse = {
  accessLevels: [],
  canReadOrganization: false,
  canManageOrganization: false,
  canCreateWorkspace: false,
  canReadWorkspace: false,
  canManageWorkspace: false,
  canInviteMembers: false,
};

function messageFor(status: number, body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof body.detail === "string"
  )
    return body.detail;
  if (
    body &&
    typeof body === "object" &&
    "title" in body &&
    typeof body.title === "string"
  )
    return body.title;
  return `La solicitud no pudo completarse (${status}).`;
}

export default function AetherPage() {
  const [authState, setAuthState] = useState<"loading" | "anonymous" | "ready">(
    "loading",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationResponse[]>(
    [],
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [capabilities, setCapabilities] = useState(emptyCapabilities);
  const [initiatives, setInitiatives] = useState<InitiativeResponse[]>([]);
  const [selected, setSelected] = useState<InitiativeResponse | null>(null);
  const [standards, setStandards] = useState<EvaluationStandardResponse[]>([]);
  const [evaluation, setEvaluation] =
    useState<InitiativeEvaluationResponse | null>(null);
  const [decision, setDecision] = useState<InitiativeDecisionResponse | null>(
    null,
  );
  const [audit, setAudit] = useState<InitiativeAuditEvent[]>([]);
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [selectedProject, setSelectedProject] =
    useState<ProjectResponse | null>(null);
  const [projectAudit, setProjectAudit] = useState<ProjectAuditEvent[]>([]);
  const [baselineDifference, setBaselineDifference] =
    useState<ProjectBaselineDifferenceResponse | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceMode, setWorkspaceMode] =
    useState<WorkspaceResponse["mode"]>("institutional");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(
    "Inicia sesión para consultar Aether.",
  );
  const [error, setError] = useState("");
  const [assessments, setAssessments] = useState<
    Record<
      string,
      {
        assessment: "met" | "not_met" | "not_applicable" | "";
        evidence: string;
      }
    >
  >({});
  const [outcome, setOutcome] = useState<
    "approved" | "rejected" | "returned" | "cancelled"
  >("approved");
  const [rationale, setRationale] = useState("");
  const [decisionEvidence, setDecisionEvidence] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [projectStatus, setProjectStatus] =
    useState<ProjectResponse["status"]>("planned");
  const [milestone, setMilestone] = useState({ title: "", dueOn: "" });
  const [nextAction, setNextAction] = useState({
    description: "",
    ownerActorId: "",
    dueOn: "",
    priority: "medium" as "low" | "medium" | "high",
  });
  const [projectDraft, setProjectDraft] = useState({
    name: "",
    sponsorActorId: "",
    leadActorId: "",
  });
  const ready = Boolean(session && organizationId && workspaceId);
  const activeStandard =
    standards.find((standard) => standard.isActive) ?? null;

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const csrf = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("aether_csrf="))
      ?.split("=")[1];
    const response = await fetch(`/api/aether/${url}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.body ? { "idempotency-key": crypto.randomUUID() } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      throw new Error(messageFor(response.status, body));
    }
    return response;
  }, []);

  const loadOrganizations = useCallback(async () => {
    const response = await request("organizations");
    const data = (await response.json()) as OrganizationResponse[];
    setOrganizations(data);
    setOrganizationId((current) =>
      data.some((organization) => organization.id === current)
        ? current
        : (data[0]?.id ?? ""),
    );
  }, [request]);

  const loadInitiatives = useCallback(async () => {
    if (!organizationId || !workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [initiativeResponse, projectResponse] = await Promise.all([
        request(
          `initiatives?organizationId=${organizationId}&workspaceId=${workspaceId}`,
        ),
        request(
          `projects?organizationId=${organizationId}&workspaceId=${workspaceId}`,
        ),
      ]);
      const data = (await initiativeResponse.json()) as InitiativeResponse[];
      const loadedProjects =
        (await projectResponse.json()) as ProjectResponse[];
      setInitiatives(data);
      setProjects(loadedProjects);
      setSelectedProject(
        (current) =>
          loadedProjects.find((project) => project.id === current?.id) ??
          loadedProjects[0] ??
          null,
      );
      setSelected(
        (current) =>
          data.find((initiative) => initiative.id === current?.id) ??
          data[0] ??
          null,
      );
      setMessage(
        data.length
          ? "Contexto cargado."
          : "Aún no hay iniciativas en este workspace.",
      );
      try {
        const standardsResponse = await request(
          `evaluation-standards?organizationId=${organizationId}`,
        );
        setStandards(
          (await standardsResponse.json()) as EvaluationStandardResponse[],
        );
      } catch {
        setStandards([]);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible cargar las iniciativas.",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId, request, workspaceId]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/session");
        if (!response.ok) {
          setAuthState("anonymous");
          return;
        }
        setSession((await response.json()) as Session);
        setAuthState("ready");
        await loadOrganizations();
      } catch {
        setAuthState("anonymous");
      }
    })();
  }, [loadOrganizations]);

  useEffect(() => {
    if (!organizationId || !session) {
      setWorkspaces([]);
      setWorkspaceId("");
      return;
    }
    void (async () => {
      try {
        const response = await request(
          `organizations/${organizationId}/workspaces`,
        );
        const data = (await response.json()) as WorkspaceResponse[];
        setWorkspaces(data);
        setWorkspaceId((current) =>
          data.some((workspace) => workspace.id === current)
            ? current
            : (data[0]?.id ?? ""),
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar los workspaces.",
        );
      }
    })();
  }, [organizationId, request, session]);

  useEffect(() => {
    if (!organizationId || !workspaceId || !session) {
      setCapabilities(emptyCapabilities);
      return;
    }
    void (async () => {
      try {
        const response = await request(
          `organizations/${organizationId}/capabilities?workspaceId=${workspaceId}`,
        );
        setCapabilities((await response.json()) as AccessCapabilitiesResponse);
        await loadInitiatives();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar el contexto.",
        );
      }
    })();
  }, [loadInitiatives, organizationId, request, session, workspaceId]);

  useEffect(() => {
    if (!selected || !organizationId) {
      setAudit([]);
      setEvaluation(null);
      setDecision(null);
      return;
    }
    void (async () => {
      try {
        const response = await request(
          `initiatives/${selected.id}/audit-events?organizationId=${organizationId}`,
        );
        const events = (await response.json()) as InitiativeAuditEvent[];
        setAudit(events);
        const evaluationId = [...events]
          .reverse()
          .find((event) => typeof event.payload.evaluationId === "string")
          ?.payload.evaluationId;
        const decisionId = [...events]
          .reverse()
          .find((event) => typeof event.payload.decisionId === "string")
          ?.payload.decisionId;
        if (typeof evaluationId === "string") {
          const detail = await request(
            `evaluations/${evaluationId}?organizationId=${organizationId}`,
          );
          setEvaluation((await detail.json()) as InitiativeEvaluationResponse);
        } else setEvaluation(null);
        if (typeof decisionId === "string") {
          const detail = await request(
            `decisions/${decisionId}?organizationId=${organizationId}`,
          );
          setDecision((await detail.json()) as InitiativeDecisionResponse);
        } else setDecision(null);
      } catch {
        setAudit([]);
      }
    })();
  }, [organizationId, request, selected]);

  useEffect(() => {
    if (!selectedProject || !organizationId) {
      setProjectAudit([]);
      setBaselineDifference(null);
      return;
    }
    void (async () => {
      try {
        const response = await request(
          `projects/${selectedProject.id}/audit-events?organizationId=${organizationId}`,
        );
        setProjectAudit((await response.json()) as ProjectAuditEvent[]);
      } catch {
        setProjectAudit([]);
      }
      try {
        const response = await request(
          `projects/${selectedProject.id}/baseline-difference?organizationId=${organizationId}`,
        );
        setBaselineDifference(
          (await response.json()) as ProjectBaselineDifferenceResponse,
        );
      } catch {
        setBaselineDifference(null);
      }
    })();
  }, [organizationId, request, selectedProject]);

  function replaceInitiative(initiative: InitiativeResponse) {
    setInitiatives((items) =>
      items.map((item) => (item.id === initiative.id ? initiative : item)),
    );
    setSelected(initiative);
  }

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await request("organizations", {
        method: "POST",
        body: JSON.stringify({
          name: organizationName,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          locale: navigator.language || "es-CL",
        }),
      });
      const organization = (await response.json()) as OrganizationResponse;
      setOrganizations((items) => [...items, organization]);
      setOrganizationId(organization.id);
      setOrganizationName("");
      setMessage("Organización creada. Crea ahora su primer workspace.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible crear la organización.",
      );
    }
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await request("workspaces", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name: workspaceName,
          mode: workspaceMode,
        }),
      });
      const workspace = (await response.json()) as WorkspaceResponse;
      setWorkspaces((items) => [...items, workspace]);
      setWorkspaceId(workspace.id);
      setWorkspaceName("");
      setMessage("Workspace creado y seleccionado.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible crear el workspace.",
      );
    }
  }

  async function createInitiative(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await request("initiatives", {
        method: "POST",
        body: JSON.stringify({ organizationId, workspaceId, ...draft }),
      });
      const initiative = (await response.json()) as InitiativeResponse;
      setInitiatives((items) => [...items, initiative]);
      setSelected(initiative);
      setDraft(emptyDraft);
      setMessage("Borrador creado correctamente.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible crear el borrador.",
      );
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      const response = await request(
        `initiatives/${selected.id}?organizationId=${organizationId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion: selected.version, ...draft }),
        },
      );
      replaceInitiative((await response.json()) as InitiativeResponse);
      setEditing(false);
      setMessage("Borrador actualizado.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible editar la iniciativa.",
      );
    }
  }

  async function present(initiative: InitiativeResponse) {
    try {
      const response = await request(
        `initiatives/${initiative.id}/submit?organizationId=${organizationId}`,
        {
          method: "POST",
          body: JSON.stringify({ expectedVersion: initiative.version }),
        },
      );
      replaceInitiative((await response.json()) as InitiativeResponse);
      setMessage("Iniciativa presentada para revisión.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible presentar la iniciativa.",
      );
    }
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    if (!selected || !activeStandard) return;
    try {
      const response = await request(
        `initiatives/${selected.id}/review?organizationId=${organizationId}`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: selected.version,
            standardId: activeStandard.id,
            results: activeStandard.criteria.map((criterion) => ({
              criterionId: criterion.id,
              assessment: assessments[criterion.id]?.assessment || null,
              evidence: (assessments[criterion.id]?.evidence ?? "")
                .split("\n")
                .map((entry) => entry.trim())
                .filter(Boolean),
            })),
          }),
        },
      );
      const result = (await response.json()) as {
        evaluation: InitiativeEvaluationResponse;
        initiative: InitiativeResponse;
      };
      setEvaluation(result.evaluation);
      replaceInitiative(result.initiative);
      setMessage("Evaluación registrada y enviada a decisión.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible registrar la evaluación.",
      );
    }
  }

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (!selected || !evaluation) return;
    try {
      const response = await request(
        `initiatives/${selected.id}/decide?organizationId=${organizationId}`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: selected.version,
            evaluationId: evaluation.id,
            outcome,
            rationale,
            evidence: decisionEvidence
              .split("\n")
              .map((entry) => entry.trim())
              .filter(Boolean),
          }),
        },
      );
      const result = (await response.json()) as {
        decision: InitiativeDecisionResponse;
        initiative: InitiativeResponse;
      };
      setDecision(result.decision);
      replaceInitiative(result.initiative);
      setMessage("Decisión institucional registrada.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible registrar la decisión.",
      );
    }
  }

  async function sendInvitation(event: FormEvent) {
    event.preventDefault();
    try {
      await request(`organizations/${organizationId}/invitations`, {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          organizationRole: "member",
          workspaceIds: workspaceId ? [workspaceId] : [],
          workspaceRole: "member",
          expiresInDays: 7,
        }),
      });
      setInviteEmail("");
      setMessage(
        "Invitación creada. El canal de entrega configurado la enviará.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible crear la invitación.",
      );
    }
  }

  async function changeProjectStatus(event: FormEvent) {
    event.preventDefault();
    if (!selectedProject) return;
    try {
      const response = await request(`projects/${selectedProject.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          organizationId,
          expectedVersion: selectedProject.version,
          status: projectStatus,
        }),
      });
      const project = (await response.json()) as ProjectResponse;
      setProjects((items) =>
        items.map((item) => (item.id === project.id ? project : item)),
      );
      setSelectedProject(project);
      setMessage("Estado de proyecto actualizado.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible actualizar el proyecto.",
      );
    }
  }

  async function addMilestone(event: FormEvent) {
    event.preventDefault();
    if (!selectedProject) return;
    try {
      await request(`projects/${selectedProject.id}/milestones`, {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          title: milestone.title,
          dueOn: milestone.dueOn || null,
        }),
      });
      setMilestone({ title: "", dueOn: "" });
      setSelectedProject({ ...selectedProject });
      setMessage("Hito añadido al proyecto.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible añadir el hito.",
      );
    }
  }

  async function addNextAction(event: FormEvent) {
    event.preventDefault();
    if (!selectedProject) return;
    setError("");
    try {
      await request(`projects/${selectedProject.id}/next-actions`, {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          description: nextAction.description,
          ownerActorId: nextAction.ownerActorId || session?.actorId || null,
          dueOn: nextAction.dueOn || null,
          priority: nextAction.priority,
          estimatedEffort: null,
          effortUnit: null,
          periodStartOn: null,
          periodEndOn: null,
        }),
      });
      setNextAction({
        description: "",
        ownerActorId: "",
        dueOn: "",
        priority: "medium",
      });
      setSelectedProject({ ...selectedProject });
      setMessage("Próxima acción añadida al proyecto.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible añadir la acción.",
      );
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!selected || !decision) return;
    try {
      const response = await request("projects", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          initiativeId: selected.id,
          decisionId: decision.id,
          name: projectDraft.name,
          sponsorActorId: projectDraft.sponsorActorId,
          leadActorId: projectDraft.leadActorId,
          participants: [
            { actorId: projectDraft.sponsorActorId, role: "sponsor" },
            { actorId: projectDraft.leadActorId, role: "lead" },
          ],
        }),
      });
      const project = (await response.json()) as ProjectResponse;
      setProjects((items) => [...items, project]);
      setSelectedProject(project);
      setProjectStatus(project.status);
      setProjectDraft({ name: "", sponsorActorId: "", leadActorId: "" });
      setMessage("Proyecto creado desde la iniciativa aprobada.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible crear el proyecto.",
      );
    }
  }

  async function logout() {
    const csrf = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("aether_csrf="))
      ?.split("=")[1];
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: csrf ? { "x-csrf-token": csrf } : {},
    });
    setSession(null);
    setAuthState("anonymous");
    setOrganizations([]);
    setWorkspaces([]);
    setOrganizationId("");
    setWorkspaceId("");
  }

  if (authState === "loading")
    return (
      <main>
        <p aria-busy="true">Comprobando sesión…</p>
      </main>
    );
  if (authState === "anonymous")
    return (
      <main className="auth-shell">
        <Card title="Bienvenido a Aether">
          <p>Gestiona iniciativas institucionales con trazabilidad completa.</p>
          <a className="login-link" href="/auth/login">
            Iniciar sesión
          </a>
        </Card>
      </main>
    );

  return (
    <main>
      <a className="skip-link" href="#content">
        Saltar al contenido
      </a>
      <header className="app-header">
        <div>
          <p className="eyebrow">Aether · gobernanza institucional</p>
          <h1>Espacio de iniciativas</h1>
          <p className="muted">Sesión activa: {session?.actorId}</p>
        </div>
        <div className="header-actions">
          <Status tone={ready ? "success" : "warning"}>
            {ready ? "Contexto activo" : "Selecciona un contexto"}
          </Status>
          <Button tone="quiet" type="button" onClick={() => void logout()}>
            Cerrar sesión
          </Button>
        </div>
      </header>
      <nav aria-label="Navegación principal" className="app-nav">
        <a href="#initiatives">Iniciativas</a>
        <a href="#detail">Detalle</a>
        <a href="#new">Nueva iniciativa</a>
        <a href="#projects">Proyectos</a>
        <a href="#governance">Organización</a>
      </nav>
      <Card title="Contexto de trabajo">
        <div className="context-grid">
          <label className="ui-field">
            Organización
            <select
              aria-label="Organización"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              <option value="">Selecciona una organización</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            Workspace
            <select
              aria-label="Workspace"
              disabled={!organizationId || !workspaces.length}
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              <option value="">Selecciona un workspace</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            onClick={() => void loadInitiatives()}
            disabled={!ready || loading}
          >
            {loading ? "Cargando…" : "Actualizar"}
          </Button>
        </div>
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="info">{message}</Notice> : null}
      <div id="content" className="workspace-layout">
        <section id="initiatives">
          <h2>Iniciativas</h2>
          {loading ? (
            <Card>
              <p aria-busy="true">Cargando iniciativas…</p>
            </Card>
          ) : null}
          {!loading && initiatives.length === 0 ? (
            <Card>
              <p>No hay iniciativas. Crea el primer borrador.</p>
            </Card>
          ) : null}
          <div className="initiative-list">
            {initiatives.map((initiative) => (
              <button
                type="button"
                className="initiative-row"
                key={initiative.id}
                onClick={() => setSelected(initiative)}
                aria-pressed={selected?.id === initiative.id}
              >
                <span>
                  <strong>{initiative.title}</strong>
                  <small>{initiative.problemStatement}</small>
                </span>
                <Status>{initiativeStatusLabel(initiative.status)}</Status>
              </button>
            ))}
          </div>
        </section>
        <aside id="detail">
          <Card title="Detalle y flujo institucional">
            {selected ? (
              <>
                <h2>{selected.title}</h2>
                <Status>{initiativeStatusLabel(selected.status)}</Status>
                <p>{selected.problemStatement}</p>
                <p>
                  <strong>Resultado:</strong> {selected.expectedOutcome}
                </p>
                {canRenderInitiativeAction(selected, "edit") ? (
                  <Button
                    type="button"
                    tone="quiet"
                    onClick={() => {
                      setDraft(selected);
                      setEditing(true);
                    }}
                  >
                    Editar borrador
                  </Button>
                ) : null}
                {canRenderInitiativeAction(selected, "present") ? (
                  <Button type="button" onClick={() => void present(selected)}>
                    Presentar iniciativa
                  </Button>
                ) : null}
                {editing ? (
                  <form className="nested-form" onSubmit={saveEdit}>
                    <h3>Editar iniciativa</h3>
                    <InitiativeFields draft={draft} onChange={setDraft} />
                    <div className="form-actions">
                      <Button type="submit">Guardar</Button>
                      <Button
                        type="button"
                        tone="quiet"
                        onClick={() => setEditing(false)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </form>
                ) : null}
                {canRenderInitiativeAction(selected, "review") ? (
                  <ReviewForm
                    standard={activeStandard}
                    assessments={assessments}
                    onChange={setAssessments}
                    onSubmit={review}
                  />
                ) : null}
                {canRenderInitiativeAction(selected, "decide") ? (
                  <DecisionForm
                    outcome={outcome}
                    rationale={rationale}
                    evidence={decisionEvidence}
                    onOutcome={setOutcome}
                    onRationale={setRationale}
                    onEvidence={setDecisionEvidence}
                    onSubmit={decide}
                  />
                ) : null}
                {evaluation ? (
                  <section className="evidence-card">
                    <h3>Evaluación registrada</h3>
                    <p>
                      Cobertura: {evaluation.coverage.percentage}% (
                      {evaluation.coverage.assessedCriteria}/
                      {evaluation.coverage.applicableCriteria} aplicables;{" "}
                      {evaluation.coverage.notApplicableCriteria} no aplicables)
                    </p>
                    {evaluation.quality ? (
                      <p>
                        Calidad ponderada: {evaluation.quality.percentage}% (
                        {evaluation.quality.metWeight}/
                        {evaluation.quality.assessedWeight} de peso evaluado)
                      </p>
                    ) : null}
                  </section>
                ) : null}
                {decision ? (
                  <section className="evidence-card">
                    <h3>Decisión: {decision.outcome}</h3>
                    <p>{decision.rationale}</p>
                  </section>
                ) : null}
                {selected.status === "approved" && decision ? (
                  <form className="nested-form" onSubmit={createProject}>
                    <h3>Convertir en proyecto</h3>
                    <Field
                      label="Nombre del proyecto"
                      value={projectDraft.name}
                      onChange={(event) =>
                        setProjectDraft({
                          ...projectDraft,
                          name: event.target.value,
                        })
                      }
                      required
                    />
                    <Field
                      label="ID de patrocinador"
                      value={projectDraft.sponsorActorId}
                      onChange={(event) =>
                        setProjectDraft({
                          ...projectDraft,
                          sponsorActorId: event.target.value,
                        })
                      }
                      required
                    />
                    <Field
                      label="ID de responsable"
                      value={projectDraft.leadActorId}
                      onChange={(event) =>
                        setProjectDraft({
                          ...projectDraft,
                          leadActorId: event.target.value,
                        })
                      }
                      required
                    />
                    <p className="muted">
                      Deben ser miembros distintos de la organización.
                    </p>
                    <Button type="submit">Crear proyecto</Button>
                  </form>
                ) : null}
                <AuditTimeline events={audit} />
              </>
            ) : (
              <p>Selecciona una iniciativa para revisar su detalle.</p>
            )}
          </Card>
        </aside>
      </div>
      <form id="new" className="ui-card" onSubmit={createInitiative}>
        <h2>Nueva iniciativa</h2>
        <InitiativeFields draft={draft} onChange={setDraft} />
        <Button type="submit" disabled={!ready}>
          Crear borrador
        </Button>
      </form>
      <section
        id="projects"
        className="workspace-layout"
        aria-label="Proyectos"
      >
        <section>
          <h2>Proyectos</h2>
          {projects.length ? (
            <div className="initiative-list">
              {projects.map((project) => (
                <button
                  type="button"
                  className="initiative-row"
                  key={project.id}
                  aria-pressed={selectedProject?.id === project.id}
                  onClick={() => {
                    setSelectedProject(project);
                    setProjectStatus(project.status);
                  }}
                >
                  <strong>{project.name}</strong>
                  <Status>{project.status}</Status>
                </button>
              ))}
            </div>
          ) : (
            <Card>
              <p>No existen proyectos en este workspace.</p>
              <p className="muted">
                Los proyectos nacen de una iniciativa aprobada y una decisión
                trazable.
              </p>
            </Card>
          )}
        </section>
        <aside>
          <Card title="Ejecución de proyecto">
            {selectedProject ? (
              <>
                <h2>{selectedProject.name}</h2>
                <section
                  className="audit"
                  aria-label="Diferencia de línea base"
                >
                  <h3>Línea base</h3>
                  {baselineDifference?.baseline ? (
                    <>
                      <p className="muted">
                        Versión {baselineDifference.baseline.version} aprobada
                        el{" "}
                        {new Date(
                          baselineDifference.baseline.approvedAt,
                        ).toLocaleString("es-CL")}
                        .
                      </p>
                      {baselineDifference.differences.length ? (
                        <ol>
                          {baselineDifference.differences.map((difference) => (
                            <li key={difference.field}>
                              <strong>
                                {baselineFieldLabels[difference.field]}
                              </strong>
                              <br />
                              <small>
                                Línea base:{" "}
                                {difference.baselineValue ?? "Sin valor"}
                                <br />
                                Actual: {difference.currentValue ?? "Sin valor"}
                              </small>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="muted">
                          El proyecto coincide con su línea base.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="muted">
                      Aún no hay una línea base aprobada para este proyecto.
                    </p>
                  )}
                </section>
                <form className="nested-form" onSubmit={changeProjectStatus}>
                  <label className="ui-field">
                    Estado
                    <select
                      value={projectStatus}
                      onChange={(event) =>
                        setProjectStatus(
                          event.target.value as ProjectResponse["status"],
                        )
                      }
                    >
                      {[
                        "planned",
                        "active",
                        "blocked",
                        "completed",
                        "cancelled",
                      ].map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit">Actualizar estado</Button>
                </form>
                <form className="nested-form" onSubmit={addMilestone}>
                  <h3>Nuevo hito</h3>
                  <Field
                    label="Título"
                    value={milestone.title}
                    onChange={(event) =>
                      setMilestone({ ...milestone, title: event.target.value })
                    }
                    required
                  />
                  <Field
                    label="Fecha límite"
                    type="date"
                    value={milestone.dueOn}
                    onChange={(event) =>
                      setMilestone({ ...milestone, dueOn: event.target.value })
                    }
                  />
                  <Button type="submit">Añadir hito</Button>
                </form>
                <form className="nested-form" onSubmit={addNextAction}>
                  <h3>Próxima acción</h3>
                  <label className="ui-field">
                    Descripción
                    <textarea
                      required
                      value={nextAction.description}
                      onChange={(event) =>
                        setNextAction({
                          ...nextAction,
                          description: event.target.value,
                        })
                      }
                    />
                  </label>
                  <Field
                    label="Responsable (ID; vacío = tú)"
                    value={nextAction.ownerActorId}
                    onChange={(event) =>
                      setNextAction({
                        ...nextAction,
                        ownerActorId: event.target.value,
                      })
                    }
                  />
                  <Field
                    label="Fecha límite"
                    type="date"
                    value={nextAction.dueOn}
                    onChange={(event) =>
                      setNextAction({
                        ...nextAction,
                        dueOn: event.target.value,
                      })
                    }
                  />
                  <label className="ui-field">
                    Prioridad
                    <select
                      value={nextAction.priority}
                      onChange={(event) =>
                        setNextAction({
                          ...nextAction,
                          priority: event.target
                            .value as typeof nextAction.priority,
                        })
                      }
                    >
                      <option value="low">Baja</option>
                      <option value="medium">Media</option>
                      <option value="high">Alta</option>
                    </select>
                  </label>
                  <Button type="submit">Añadir acción</Button>
                </form>
                <section className="audit">
                  <h3>Historial del proyecto</h3>
                  {projectAudit.length ? (
                    <ol>
                      {projectAudit.map((event) => (
                        <li key={event.id}>
                          <strong>{event.eventType}</strong>
                          <br />
                          <small>
                            {new Date(event.occurredAt).toLocaleString("es-CL")}{" "}
                            · {event.actorId}
                          </small>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">No hay eventos aún.</p>
                  )}
                </section>
              </>
            ) : (
              <p>Selecciona un proyecto para gestionar su ejecución.</p>
            )}
          </Card>
        </aside>
      </section>
      {selectedProject && organizationId ? (
        <ProjectTasks
          projectId={selectedProject.id}
          organizationId={organizationId}
          refreshKey={selectedProject}
          request={request}
        />
      ) : null}
      <section
        id="governance"
        className="governance-grid"
        aria-label="Administración de organización"
      >
        <form className="ui-card" onSubmit={createOrganization}>
          <h2>Nueva organización</h2>
          <Field
            label="Nombre"
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
            required
          />
          <Button type="submit">Crear organización</Button>
        </form>
        <form className="ui-card" onSubmit={createWorkspace}>
          <h2>Nuevo workspace</h2>
          <Field
            label="Nombre"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            required
          />
          <label className="ui-field">
            Modo
            <select
              value={workspaceMode}
              onChange={(event) =>
                setWorkspaceMode(
                  event.target.value as WorkspaceResponse["mode"],
                )
              }
            >
              <option value="institutional">Institucional</option>
              <option value="team">Equipo</option>
              <option value="personal">Personal</option>
            </select>
          </label>
          <Button
            type="submit"
            disabled={!organizationId || !capabilities.canCreateWorkspace}
          >
            Crear workspace
          </Button>
        </form>
        <form className="ui-card" onSubmit={sendInvitation}>
          <h2>Invitar persona</h2>
          <Field
            label="Correo"
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            required
          />
          <Button
            type="submit"
            disabled={!organizationId || !capabilities.canInviteMembers}
          >
            Crear invitación
          </Button>
        </form>
      </section>
    </main>
  );
}

function InitiativeFields({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  return (
    <div className="form-grid">
      <Field
        label="Título"
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        required
      />
      <label className="ui-field">
        Problema
        <textarea
          required
          value={draft.problemStatement}
          onChange={(event) =>
            onChange({ ...draft, problemStatement: event.target.value })
          }
        />
      </label>
      <label className="ui-field">
        Resultado esperado
        <textarea
          required
          value={draft.expectedOutcome}
          onChange={(event) =>
            onChange({ ...draft, expectedOutcome: event.target.value })
          }
        />
      </label>
      <label className="ui-field">
        Clasificación
        <select
          value={draft.classification}
          onChange={(event) =>
            onChange({
              ...draft,
              classification: event.target.value as Draft["classification"],
            })
          }
        >
          <option value="internal">Interna</option>
          <option value="confidential">Confidencial</option>
        </select>
      </label>
    </div>
  );
}

function ReviewForm({
  standard,
  assessments,
  onChange,
  onSubmit,
}: {
  standard: EvaluationStandardResponse | null;
  assessments: Record<
    string,
    { assessment: "met" | "not_met" | "not_applicable" | ""; evidence: string }
  >;
  onChange: (
    assessments: Record<
      string,
      {
        assessment: "met" | "not_met" | "not_applicable" | "";
        evidence: string;
      }
    >,
  ) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  if (!standard)
    return (
      <Notice tone="error">No existe un estándar de evaluación activo.</Notice>
    );
  return (
    <form className="nested-form" onSubmit={onSubmit}>
      <h3>Evaluar con “{standard.name}”</h3>
      {standard.criteria.map((criterion) => (
        <fieldset key={criterion.id}>
          <legend>{criterion.name}</legend>
          <p className="muted">{criterion.description}</p>
          <label className="ui-field">
            Resultado
            <select
              value={assessments[criterion.id]?.assessment ?? ""}
              onChange={(event) =>
                onChange({
                  ...assessments,
                  [criterion.id]: {
                    assessment: event.target.value as
                      "met" | "not_met" | "not_applicable" | "",
                    evidence: assessments[criterion.id]?.evidence ?? "",
                  },
                })
              }
            >
              <option value="">Sin evaluar</option>
              <option value="met">Cumple</option>
              <option value="not_met">No cumple</option>
              <option value="not_applicable">No aplica</option>
            </select>
          </label>
          <label className="ui-field">
            Evidencia (una por línea)
            <textarea
              value={assessments[criterion.id]?.evidence ?? ""}
              onChange={(event) =>
                onChange({
                  ...assessments,
                  [criterion.id]: {
                    assessment: assessments[criterion.id]?.assessment ?? "",
                    evidence: event.target.value,
                  },
                })
              }
            />
          </label>
        </fieldset>
      ))}
      <Button type="submit">Registrar evaluación</Button>
    </form>
  );
}

function DecisionForm({
  outcome,
  rationale,
  evidence,
  onOutcome,
  onRationale,
  onEvidence,
  onSubmit,
}: {
  outcome: "approved" | "rejected" | "returned" | "cancelled";
  rationale: string;
  evidence: string;
  onOutcome: (
    value: "approved" | "rejected" | "returned" | "cancelled",
  ) => void;
  onRationale: (value: string) => void;
  onEvidence: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="nested-form" onSubmit={onSubmit}>
      <h3>Tomar decisión</h3>
      <label className="ui-field">
        Resultado
        <select
          value={outcome}
          onChange={(event) => onOutcome(event.target.value as typeof outcome)}
        >
          <option value="approved">Aprobar</option>
          <option value="rejected">Rechazar</option>
          <option value="returned">Devolver</option>
          <option value="cancelled">Cancelar</option>
        </select>
      </label>
      <label className="ui-field">
        Fundamento
        <textarea
          required
          value={rationale}
          onChange={(event) => onRationale(event.target.value)}
        />
      </label>
      <label className="ui-field">
        Evidencia (una por línea)
        <textarea
          value={evidence}
          onChange={(event) => onEvidence(event.target.value)}
        />
      </label>
      <Button type="submit">Registrar decisión</Button>
    </form>
  );
}

function AuditTimeline({ events }: { events: InitiativeAuditEvent[] }) {
  return (
    <section className="audit">
      <h3>Historial</h3>
      {events.length ? (
        <ol>
          {events.map((event) => (
            <li key={event.id}>
              <strong>{event.eventType}</strong>
              <br />
              <small>
                {new Date(event.occurredAt).toLocaleString("es-CL")} ·{" "}
                {event.actorId}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No hay eventos aún.</p>
      )}
    </section>
  );
}
