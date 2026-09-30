"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus, Search } from "lucide-react";

import type {
  AccessCapabilitiesResponse,
  EvaluationStandardResponse,
  InitiativeAuditEvent,
  InitiativeDecisionResponse,
  InitiativeEvaluationResponse,
  InitiativeResponse,
  InvitationResponse,
  OrganizationResponse,
  ProjectBaselineDifferenceResponse,
  ProjectResponse,
  WorkspaceResponse,
} from "@aether/contracts";
import { Button, Card, Field, Notice, Status } from "@aether/ui";

import {
  canRenderInitiativeAction,
  initiativeStatusLabel,
} from "../../initiatives";
import { projectStatusLabel } from "../../lib/constants/project-status";
import { MyWork } from "./my-work";
import { NewTaskForm } from "./new-task-form";
import { ProjectTasks } from "./project-tasks";
import { FirstSteps } from "./FirstSteps";
import { LogoutConfirmDialog } from "./LogoutConfirmDialog";
import {
  WorkspaceNavigation,
  type WorkspaceView,
} from "./workspace-navigation";
import { WorkspaceOverview } from "./workspace-overview";
import { WorkspaceContextSwitcher } from "./WorkspaceContextSwitcher";
import { WorkspaceSessionLoading } from "./WorkspaceSessionLoading";
import { WorkspaceSignedOut } from "./WorkspaceSignedOut";
import { UserSettings } from "./UserSettings";
import { UserProfile } from "./UserProfile";
import { NewOrganization, OrganizationCenter } from "./OrganizationCenter";
import { useDayTheme } from "./use-day-theme";
import { useRecentWork } from "./use-recent-work";
import {
  InitiativeProposalWizard,
  type InitiativeProposalDraft,
} from "./initiative-proposal-wizard";

type Draft = InitiativeProposalDraft;
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
  requestedPriority: "medium",
  proposalDetails: {
    summary: "",
    impactedPeople: "",
    impactedCount: null,
    problemImpact: "",
    solution: "",
    differentiation: "",
    projectStage: "idea",
    stageRationale: "",
    pilotPlan: "",
    pilotResources: "",
  },
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
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");
  const [organizationSection, setOrganizationSection] = useState<
    "overview" | "standards"
  >("overview");
  const [transitioningView, setTransitioningView] =
    useState<WorkspaceView | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const dayTheme = useDayTheme();
  const [authState, setAuthState] = useState<"loading" | "anonymous" | "ready">(
    "loading",
  );
  const [session, setSession] = useState<Session | null>(null);
  const recentWork = useRecentWork(session?.actorId);
  const [signedOut, setSignedOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationResponse[]>(
    [],
  );
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0);
  const invitedWorkspaceId = useRef<string | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [capabilities, setCapabilities] = useState(emptyCapabilities);
  const [initiatives, setInitiatives] = useState<InitiativeResponse[]>([]);
  const [selected, setSelected] = useState<InitiativeResponse | null>(null);
  const [standards, setStandards] = useState<EvaluationStandardResponse[]>([]);
  const [standardsError, setStandardsError] = useState("");
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
  const [workRevision, setWorkRevision] = useState(0);
  const [activeTaskCount, setActiveTaskCount] = useState(0);
  const loadGeneration = useRef(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [initiativeWizardStep, setInitiativeWizardStep] = useState(0);
  const [initiativeWizardMaxStep, setInitiativeWizardMaxStep] = useState(0);
  const [initiativeWizardError, setInitiativeWizardError] = useState("");
  const [initiativeSaving, setInitiativeSaving] = useState(false);
  const [initiativeQuery, setInitiativeQuery] = useState("");
  const [initiativeFilter, setInitiativeFilter] = useState<
    "all" | "draft" | "returned" | "presented" | "under_review" | "closed"
  >("all");
  const [initiativeOwnership, setInitiativeOwnership] = useState<
    "workspace" | "mine"
  >("workspace");
  const initiativeDetailSelection = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
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
  const [decisionNextReviewOn, setDecisionNextReviewOn] = useState("");
  const [projectStatus, setProjectStatus] =
    useState<ProjectResponse["status"]>("planned");
  const [milestone, setMilestone] = useState({ title: "", dueOn: "" });
  const [projectDraft, setProjectDraft] = useState({
    name: "",
    sponsorActorId: "",
    leadActorId: "",
  });
  const ready = Boolean(session && organizationId && workspaceId);
  const activeStandard =
    standards.find((standard) => standard.isActive) ?? null;

  useEffect(() => {
    const syncView = (animate = false) => {
      const hash = window.location.hash.slice(1);
      const view: WorkspaceView =
        hash === "new"
          ? "initiative-new"
          : hash === "detail"
            ? "initiatives"
            : hash === "governance"
              ? "organization"
              : (
                    [
                      "overview",
                      "my-work",
                      "initiatives",
                      "initiative-new",
                      "projects",
                      "recent",
                      "settings",
                      "profile",
                      "organization",
                      "organization-new",
                    ] as string[]
                  ).includes(hash)
                ? (hash as WorkspaceView)
                : "overview";
      setActiveView(view);
      setTransitioningView(
        animate &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? view
          : null,
      );
    };
    syncView();
    const handleHashChange = () => syncView(true);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [message]);

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
    setOrganizationsLoaded(true);
    setOrganizationId((current) =>
      data.some((organization) => organization.id === current)
        ? current
        : (data[0]?.id ?? ""),
    );
  }, [request]);

  const loadInitiatives = useCallback(async () => {
    if (!organizationId || !workspaceId) return;
    const generation = ++loadGeneration.current;
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
      if (generation !== loadGeneration.current) return;
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
      setMessage("");
      setStandardsError("");
      try {
        const standardsResponse = await request(
          `evaluation-standards?organizationId=${organizationId}`,
        );
        const loadedStandards =
          (await standardsResponse.json()) as EvaluationStandardResponse[];
        if (generation === loadGeneration.current)
          setStandards(loadedStandards);
      } catch (caught) {
        if (generation === loadGeneration.current) {
          setStandards([]);
          setStandardsError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar el estándar de evaluación.",
          );
        }
      }
    } catch (caught) {
      if (generation === loadGeneration.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar las iniciativas.",
        );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [organizationId, request, workspaceId]);

  useEffect(() => {
    setSignedOut(
      new URLSearchParams(window.location.search).get("logged_out") === "1",
    );
    void (async () => {
      try {
        const response = await fetch("/api/auth/session");
        if (!response.ok) {
          setAuthState("anonymous");
          return;
        }
        setSession((await response.json()) as Session);
        await loadOrganizations();
        setAuthState("ready");
      } catch {
        setAuthState("anonymous");
      }
    })();
  }, [loadOrganizations]);

  useEffect(() => {
    let active = true;
    setWorkspacesLoaded(false);
    setWorkspaces([]);
    setWorkspaceId("");
    if (!organizationId || !session) {
      setWorkspacesLoaded(true);
      return;
    }
    void (async () => {
      try {
        const response = await request(
          `organizations/${organizationId}/workspaces`,
        );
        const data = (await response.json()) as WorkspaceResponse[];
        if (!active) return;
        setWorkspaces(data);
        setWorkspacesLoaded(true);
        const preferredWorkspace = data.find(
          (workspace) => workspace.id === invitedWorkspaceId.current,
        );
        setWorkspaceId(preferredWorkspace?.id ?? data[0]?.id ?? "");
        invitedWorkspaceId.current = null;
      } catch (caught) {
        if (!active) return;
        setLoading(false);
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar los workspaces.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [organizationId, request, session, workspaceReloadKey]);

  useEffect(() => {
    if (!organizationId || !workspaceId || !session) {
      setCapabilities(emptyCapabilities);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const response = await request(
          `organizations/${organizationId}/capabilities?workspaceId=${workspaceId}`,
        );
        if (!active) return;
        setCapabilities((await response.json()) as AccessCapabilitiesResponse);
        if (!active) return;
        await loadInitiatives();
      } catch (caught) {
        if (!active) return;
        setLoading(false);
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar el contexto.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [loadInitiatives, organizationId, request, session, workspaceId]);

  useEffect(() => {
    if (!selected || !organizationId) {
      setAudit([]);
      setEvaluation(null);
      setDecision(null);
      return;
    }
    let cancelled = false;
    setAudit([]);
    setEvaluation(null);
    setDecision(null);
    void (async () => {
      try {
        const response = await request(
          `initiatives/${selected.id}/audit-events?organizationId=${organizationId}`,
        );
        const events = (await response.json()) as InitiativeAuditEvent[];
        if (cancelled) return;
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
          const loaded = (await detail.json()) as InitiativeEvaluationResponse;
          if (cancelled) return;
          setEvaluation(loaded);
        }
        if (typeof decisionId === "string") {
          const detail = await request(
            `decisions/${decisionId}?organizationId=${organizationId}`,
          );
          const loaded = (await detail.json()) as InitiativeDecisionResponse;
          if (cancelled) return;
          setDecision(loaded);
        }
      } catch {
        if (!cancelled) {
          setAudit([]);
          setEvaluation(null);
          setDecision(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
      items.map((item) =>
        item.id === initiative.id
          ? {
              ...initiative,
              createdByDisplayName:
                initiative.createdByDisplayName ?? item.createdByDisplayName,
              intakeAssignment: initiative.intakeAssignment
                ? {
                    ...initiative.intakeAssignment,
                    responsibleDisplayName:
                      initiative.intakeAssignment.responsibleDisplayName ??
                      (initiative.intakeAssignment.responsibleActorId ===
                      item.intakeAssignment?.responsibleActorId
                        ? item.intakeAssignment.responsibleDisplayName
                        : null),
                  }
                : null,
            }
          : item,
      ),
    );
    setSelected((current) => ({
      ...initiative,
      createdByDisplayName:
        initiative.createdByDisplayName ?? current?.createdByDisplayName,
      intakeAssignment: initiative.intakeAssignment
        ? {
            ...initiative.intakeAssignment,
            responsibleDisplayName:
              initiative.intakeAssignment.responsibleDisplayName ??
              (initiative.intakeAssignment.responsibleActorId ===
              current?.intakeAssignment?.responsibleActorId
                ? current.intakeAssignment.responsibleDisplayName
                : null),
          }
        : null,
    }));
  }

  async function createInitiative(event: FormEvent) {
    event.preventDefault();
    setInitiativeSaving(true);
    setInitiativeWizardError("");
    try {
      const response = await request("initiatives", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          workspaceId,
          ...draft,
          requestedPriority: draft.requestedPriority ?? "medium",
        }),
      });
      const initiative = (await response.json()) as InitiativeResponse;
      setInitiatives((items) => [...items, initiative]);
      setSelected(initiative);
      setDraft(emptyDraft);
      setInitiativeWizardStep(0);
      setInitiativeWizardMaxStep(0);
      navigate("initiatives");
      setMessage("Borrador creado correctamente.");
    } catch (caught) {
      setInitiativeWizardError(
        caught instanceof Error
          ? caught.message
          : "No fue posible crear el borrador.",
      );
    } finally {
      setInitiativeSaving(false);
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setInitiativeSaving(true);
    setInitiativeWizardError("");
    try {
      const response = await request(
        `initiatives/${selected.id}?organizationId=${organizationId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: selected.version,
            title: draft.title,
            problemStatement: draft.problemStatement,
            expectedOutcome: draft.expectedOutcome,
            classification: draft.classification,
            requestedPriority: draft.requestedPriority,
            proposalDetails: draft.proposalDetails,
          }),
        },
      );
      replaceInitiative((await response.json()) as InitiativeResponse);
      navigate("initiatives");
      setMessage("Borrador actualizado.");
    } catch (caught) {
      setInitiativeWizardError(
        caught instanceof Error
          ? caught.message
          : "No fue posible editar la iniciativa.",
      );
    } finally {
      setInitiativeSaving(false);
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
            ...(outcome === "returned"
              ? { nextReviewOn: decisionNextReviewOn }
              : {}),
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
      setWorkRevision((current) => current + 1);
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

  function navigate(
    view: WorkspaceView,
    section: "overview" | "standards" = "overview",
  ) {
    if (view === "organization") setOrganizationSection(section);
    setActiveView(view);
    setTransitioningView(
      view !== activeView && !prefersReducedMotion ? view : null,
    );
    window.history.replaceState(
      null,
      "",
      `#${view === "initiative-edit" ? "initiatives" : view}`,
    );
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  function createFromOverview() {
    beginNewInitiative();
  }

  function openInitiativeForm() {
    beginNewInitiative();
  }

  function beginNewInitiative() {
    setDraft({
      ...emptyDraft,
      proposalDetails: { ...emptyDraft.proposalDetails },
    });
    setInitiativeWizardStep(0);
    setInitiativeWizardMaxStep(0);
    setInitiativeWizardError("");
    setError("");
    navigate("initiative-new");
  }

  function beginEditInitiative(initiative: InitiativeResponse) {
    setDraft({
      title: initiative.title,
      problemStatement: initiative.problemStatement,
      expectedOutcome: initiative.expectedOutcome,
      classification: initiative.classification,
      requestedPriority: initiative.requestedPriority,
      proposalDetails: { ...initiative.proposalDetails },
    });
    setInitiativeWizardStep(0);
    setInitiativeWizardMaxStep(3);
    setInitiativeWizardError("");
    setError("");
    navigate("initiative-edit");
  }

  function isInitiativeStepValid(step: number) {
    if (step === 0)
      return Boolean(
        draft.title.trim() &&
        draft.proposalDetails.summary.trim() &&
        draft.problemStatement.trim(),
      );
    if (step === 1)
      return Boolean(
        draft.proposalDetails.impactedPeople.trim() &&
        draft.proposalDetails.impactedCount &&
        draft.proposalDetails.problemImpact.trim(),
      );
    if (step === 2)
      return Boolean(
        draft.expectedOutcome.trim() &&
        draft.proposalDetails.solution.trim() &&
        draft.proposalDetails.differentiation.trim(),
      );
    return Boolean(
      draft.proposalDetails.pilotPlan.trim() &&
      draft.proposalDetails.pilotResources.trim() &&
      draft.proposalDetails.stageRationale.trim(),
    );
  }

  function advanceInitiativeStep() {
    if (!isInitiativeStepValid(initiativeWizardStep)) {
      setInitiativeWizardError(
        "Completa los campos obligatorios de este paso para continuar.",
      );
      return;
    }
    setInitiativeWizardError("");
    const nextStep = Math.min(initiativeWizardStep + 1, 3);
    setInitiativeWizardStep(nextStep);
    setInitiativeWizardMaxStep((current) => Math.max(current, nextStep));
  }

  function openInitiative(initiative: InitiativeResponse) {
    setSelected(initiative);
    recentWork.remember({
      kind: "initiative",
      id: initiative.id,
      organizationId: initiative.organizationId,
      workspaceId: initiative.workspaceId,
    });
    if (activeView !== "initiatives") navigate("initiatives");
  }

  function openRelatedInitiative(initiativeId: string) {
    const related = initiatives.find((item) => item.id === initiativeId);
    if (!related) return;
    setInitiativeOwnership("workspace");
    setInitiativeFilter("all");
    setInitiativeQuery("");
    openInitiative(related);
  }

  function openProject(project: ProjectResponse) {
    setSelectedProject(project);
    setProjectStatus(project.status);
    recentWork.remember({
      kind: "project",
      id: project.id,
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
    });
    if (activeView !== "projects") navigate("projects");
  }

  async function openWorkProject(projectId: string) {
    const response = await request(
      `projects/${projectId}?organizationId=${organizationId}`,
    );
    const project = (await response.json()) as ProjectResponse;
    setWorkspaceId(project.workspaceId);
    openProject(project);
  }

  async function logout() {
    if (logoutBusy) return;
    const csrf = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("aether_csrf="))
      ?.split("=")[1];
    try {
      setLogoutBusy(true);
      setLogoutError("");
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: csrf ? { "x-csrf-token": csrf } : {},
      });
      if (!response.ok) throw new Error("No se pudo cerrar la sesión.");
      const { logoutUrl } = (await response.json()) as { logoutUrl: string };
      const destination = new URL(logoutUrl);
      if (!["http:", "https:"].includes(destination.protocol))
        throw new Error("La URL de cierre de sesión no es válida.");
      window.location.assign(destination.href);
    } catch {
      const explanation =
        "No fue posible cerrar la sesión. Comprueba tu conexión e inténtalo de nuevo.";
      setLogoutError(explanation);
      setLogoutBusy(false);
    }
  }

  function askToLogout() {
    setLogoutError("");
    setLogoutOpen(true);
  }

  const logoutDialog = (
    <LogoutConfirmDialog
      open={logoutOpen}
      busy={logoutBusy}
      error={logoutError}
      onCancel={() => setLogoutOpen(false)}
      onConfirm={() => void logout()}
    />
  );

  async function refreshOrganizations(selectedOrganizationId?: string) {
    await loadOrganizations();
    if (selectedOrganizationId) setOrganizationId(selectedOrganizationId);
  }

  function resetContextData() {
    loadGeneration.current += 1;
    setLoading(true);
    setError("");
    setInitiatives([]);
    setProjects([]);
    setSelected(null);
    setSelectedProject(null);
    setStandards([]);
    setStandardsError("");
    setActiveTaskCount(0);
  }

  function changeOrganization(id: string) {
    if (id === organizationId) return;
    resetContextData();
    setWorkspaceId("");
    setWorkspaces([]);
    setWorkspacesLoaded(false);
    setOrganizationId(id);
  }

  function changeWorkspace(id: string) {
    if (id === workspaceId) return;
    resetContextData();
    setWorkspaceId(id);
  }

  const activeWorkspaceName =
    workspaces.find((item) => item.id === workspaceId)?.name ?? "Tu espacio";
  const filteredInitiatives = initiatives.filter((initiative) => {
    if (
      initiativeOwnership === "mine" &&
      initiative.createdByActorId !== session?.actorId
    )
      return false;
    const query = initiativeQuery.trim().toLocaleLowerCase("es-CL");
    if (
      query &&
      ![
        initiative.title,
        initiative.problemStatement,
        initiative.expectedOutcome,
        initiative.proposalDetails.summary,
      ].some((value) => value.toLocaleLowerCase("es-CL").includes(query))
    )
      return false;
    return (
      initiativeFilter === "all" ||
      (initiativeFilter === "closed"
        ? ["approved", "rejected", "cancelled"].includes(initiative.status)
        : initiative.status === initiativeFilter)
    );
  });
  useEffect(() => {
    if (activeView !== "initiatives" || loading) return;
    const next =
      filteredInitiatives.find((item) => item.id === selected?.id) ??
      filteredInitiatives[0] ??
      null;
    if (next?.id !== selected?.id) setSelected(next);
  }, [activeView, filteredInitiatives, loading, selected?.id]);
  useEffect(() => {
    if (activeView !== "initiatives") return;
    const nextId = selected?.id ?? null;
    const previousId = initiativeDetailSelection.current;
    if (previousId !== null && nextId !== previousId) {
      window.requestAnimationFrame(() => {
        document.getElementById("detail")?.scrollIntoView({
          behavior: prefersReducedMotion ? "auto" : "smooth",
          block: "start",
        });
      });
    }
    initiativeDetailSelection.current = nextId;
  }, [activeView, prefersReducedMotion, selected?.id]);
  const selectedInitiativeProject = projects.find(
    (project) => project.sourceInitiativeId === selected?.id,
  );
  const recentItems = recentWork.entries
    .filter(
      (entry) =>
        entry.organizationId === organizationId &&
        entry.workspaceId === workspaceId,
    )
    .flatMap((entry) => {
      const item =
        entry.kind === "initiative"
          ? initiatives.find((initiative) => initiative.id === entry.id)
          : projects.find((project) => project.id === entry.id);
      return item
        ? [{ ...entry, title: "title" in item ? item.title : item.name }]
        : [];
    });

  if (authState === "loading") return <WorkspaceSessionLoading />;
  if (authState === "anonymous")
    return <WorkspaceSignedOut signedOut={signedOut} />;

  if (organizationsLoaded && organizations.length === 0)
    return (
      <>
        <FirstSteps
          organization={null}
          request={request}
          onOrganizationReady={refreshOrganizations}
          onWorkspaceReady={(workspace) => {
            setWorkspaces([workspace]);
            setWorkspaceId(workspace.id);
            setWorkspacesLoaded(true);
          }}
          onLogout={askToLogout}
        />
        {logoutDialog}
      </>
    );

  if (organizationId && workspacesLoaded && workspaces.length === 0)
    return (
      <>
        <FirstSteps
          organization={
            organizations.find((item) => item.id === organizationId) ?? null
          }
          request={request}
          onOrganizationReady={refreshOrganizations}
          onWorkspaceReady={(workspace) => {
            setWorkspaces([workspace]);
            setWorkspaceId(workspace.id);
            setWorkspacesLoaded(true);
          }}
          onLogout={askToLogout}
        />
        {logoutDialog}
      </>
    );

  return (
    <div className="workspace-app" data-day-theme={dayTheme.resolved}>
      <a className="skip-link" href="#content">
        Saltar al contenido
      </a>
      <WorkspaceNavigation
        activeView={activeView}
        onNavigate={navigate}
        onLogout={askToLogout}
        contextSwitcher={
          <WorkspaceContextSwitcher
            organizations={organizations}
            workspaces={workspaces}
            workspacesLoaded={workspacesLoaded}
            organizationId={organizationId}
            workspaceId={workspaceId}
            refreshing={loading}
            canRefresh={ready}
            onOrganizationChange={changeOrganization}
            onWorkspaceChange={changeWorkspace}
            onNewOrganization={() => navigate("organization-new")}
            onAcceptInvitation={async (token) => {
              const response = await request("invitations/accept", {
                method: "POST",
                body: JSON.stringify({ token }),
              });
              const invitation = (await response.json()) as InvitationResponse;
              invitedWorkspaceId.current = invitation.workspaceIds[0] ?? null;
              await refreshOrganizations(invitation.organizationId);
              setWorkspaceReloadKey((current) => current + 1);
              setMessage("Te uniste a una organización.");
            }}
            onRefresh={() => void loadInitiatives()}
            onOpenSettings={() => navigate("organization")}
          />
        }
      />
      <main className="workspace-main" id="content">
        <div
          className={`workspace-main__content${activeView === "organization" ? " workspace-main__content--organization" : ""}`}
          data-view-transition={
            transitioningView === activeView ? "running" : "settled"
          }
        >
          {error ? <Notice tone="error">{error}</Notice> : null}
          {message ? <Notice tone="info">{message}</Notice> : null}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeView}
              className="workspace-view-transition"
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: prefersReducedMotion ? 0 : 0.22,
                ease: [0.22, 1, 0.36, 1],
              }}
              onAnimationComplete={() => {
                if (transitioningView === activeView)
                  setTransitioningView(null);
              }}
            >
              {activeView === "overview" ? (
                <>
                  <WorkspaceOverview
                    organizationName={
                      organizations.find((item) => item.id === organizationId)
                        ?.name ?? "Tu organización"
                    }
                    workspaceName={activeWorkspaceName}
                    initiatives={initiatives}
                    projects={projects}
                    taskCount={activeTaskCount}
                    loading={loading}
                    onNavigate={navigate}
                    onCreateInitiative={createFromOverview}
                    onOpenInitiative={openInitiative}
                    onOpenProject={openProject}
                  >
                    {organizationId ? (
                      <MyWork
                        variant="summary"
                        key={organizationId}
                        organizationId={organizationId}
                        refreshKey={workRevision}
                        request={request}
                        onOpenProject={openWorkProject}
                        onSummaryChange={setActiveTaskCount}
                        onViewAll={() => navigate("my-work")}
                      />
                    ) : null}
                  </WorkspaceOverview>
                </>
              ) : null}
              {activeView === "my-work" ? (
                <div className="daily-desk day-work-page">
                  <div className="workspace-section-heading">
                    <div>
                      <p className="workspace-kicker">TU TRABAJO</p>
                      <h1>Mis tareas</h1>
                      <p>
                        Todo lo que requiere tu participación en los espacios de
                        esta organización.
                      </p>
                    </div>
                  </div>
                  {organizationId ? (
                    <MyWork
                      key={organizationId}
                      organizationId={organizationId}
                      refreshKey={workRevision}
                      request={request}
                      onOpenProject={openWorkProject}
                      onSummaryChange={setActiveTaskCount}
                    />
                  ) : null}
                </div>
              ) : null}
              {activeView === "recent" ? (
                <div className="daily-desk day-recent-page">
                  <div className="workspace-section-heading">
                    <div>
                      <p className="workspace-kicker">
                        ESPACIO · {activeWorkspaceName.toUpperCase()}
                      </p>
                      <h1>Recientes</h1>
                      <p>
                        Vuelve a las iniciativas y proyectos que abriste en este
                        espacio.
                      </p>
                    </div>
                  </div>
                  <section
                    className="day-panel day-visited-panel"
                    aria-label="Trabajo reciente"
                  >
                    {loading ? (
                      <p className="day-visited-status" role="status">
                        Cargando trabajo reciente…
                      </p>
                    ) : recentItems.length ? (
                      <ul className="day-visited-list">
                        {recentItems.map((item) => (
                          <li key={`${item.kind}:${item.id}`}>
                            <button
                              type="button"
                              onClick={() => {
                                if (item.kind === "initiative") {
                                  const initiative = initiatives.find(
                                    (entry) => entry.id === item.id,
                                  );
                                  if (initiative) openInitiative(initiative);
                                } else {
                                  const project = projects.find(
                                    (entry) => entry.id === item.id,
                                  );
                                  if (project) openProject(project);
                                }
                              }}
                            >
                              <span className="day-visited-kind">
                                {item.kind === "initiative"
                                  ? "Iniciativa"
                                  : "Proyecto"}
                              </span>
                              <strong>{item.title}</strong>
                              <span
                                className="day-visited-open"
                                aria-hidden="true"
                              >
                                ↗
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="day-visited-empty">
                        <h2>Aún no has abierto trabajo en este espacio</h2>
                        <p>
                          Cuando abras una iniciativa o proyecto, tendrás aquí
                          un acceso rápido para retomarlo.
                        </p>
                        <div>
                          <button
                            type="button"
                            className="day-button day-button--secondary"
                            onClick={() => navigate("initiatives")}
                          >
                            Ver iniciativas
                          </button>
                          <button
                            type="button"
                            className="day-button day-button--secondary"
                            onClick={() => navigate("projects")}
                          >
                            Ver proyectos
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              ) : null}
              {activeView === "settings" ? (
                <UserSettings
                  themePreference={dayTheme.preference}
                  onThemeChange={dayTheme.selectTheme}
                  onLogout={askToLogout}
                />
              ) : null}
              {activeView === "profile" ? (
                <UserProfile request={request} />
              ) : null}
              {activeView === "initiatives" ? (
                <div className="initiative-page">
                  <header className="initiative-page__heading">
                    <div>
                      <p className="workspace-kicker">{activeWorkspaceName}</p>
                      <h1>Iniciativas</h1>
                      <p>
                        Propuestas del espacio, desde su presentación hasta la
                        decisión.
                      </p>
                    </div>
                    <button
                      className="initiative-page__create"
                      type="button"
                      onClick={openInitiativeForm}
                    >
                      <Plus size={16} aria-hidden="true" />
                      Nueva iniciativa
                    </button>
                  </header>
                  <section
                    className="initiative-journey"
                    aria-label="Estado de las iniciativas visibles"
                  >
                    <div className="initiative-journey__intro">
                      <span className="workspace-kicker">
                        ESTADO DEL ESPACIO
                      </span>
                      <p>Propuestas a las que tienes acceso en este espacio.</p>
                    </div>
                    <div className="initiative-journey__steps">
                      <JourneyStep
                        label="Borradores"
                        count={
                          initiatives.filter((item) => item.status === "draft")
                            .length
                        }
                        detail="Sin presentar"
                      />
                      <JourneyStep
                        label="Devueltas"
                        count={
                          initiatives.filter(
                            (item) => item.status === "returned",
                          ).length
                        }
                        detail="Por corregir"
                      />
                      <JourneyStep
                        label="Presentadas"
                        count={
                          initiatives.filter(
                            (item) => item.status === "presented",
                          ).length
                        }
                        detail="Esperan revisión"
                      />
                      <JourneyStep
                        label="Evaluadas"
                        count={
                          initiatives.filter(
                            (item) => item.status === "under_review",
                          ).length
                        }
                        detail="Esperan decisión"
                      />
                      <JourneyStep
                        label="Cerradas"
                        count={
                          initiatives.filter((item) =>
                            ["approved", "rejected", "cancelled"].includes(
                              item.status,
                            ),
                          ).length
                        }
                        detail="Aprobadas, rechazadas o canceladas"
                      />
                    </div>
                  </section>
                  <div className="workspace-layout workspace-layout--initiatives">
                    <section id="initiatives" className="initiative-inbox">
                      <div className="initiative-inbox__heading">
                        <div>
                          <p className="workspace-kicker">BANDEJA DEL EQUIPO</p>
                          <h2>Propuestas del equipo</h2>
                          <p>
                            Ideas compartidas y su avance hasta una decisión.
                          </p>
                        </div>
                        <span className="initiative-total">
                          {initiatives.length}{" "}
                          {initiatives.length === 1
                            ? "iniciativa"
                            : "iniciativas"}
                        </span>
                      </div>
                      {loading ? (
                        <div className="initiative-loading" aria-busy="true">
                          <span className="initiative-loading__dot" /> Cargando
                          iniciativas…
                        </div>
                      ) : null}
                      <div className="initiative-tools">
                        <div
                          className="initiative-filters initiative-filters--ownership"
                          role="group"
                          aria-label="Alcance de las iniciativas"
                        >
                          <button
                            type="button"
                            aria-pressed={initiativeOwnership === "workspace"}
                            onClick={() => setInitiativeOwnership("workspace")}
                          >
                            Del espacio
                          </button>
                          <button
                            type="button"
                            aria-pressed={initiativeOwnership === "mine"}
                            onClick={() => setInitiativeOwnership("mine")}
                          >
                            De mi autoría
                          </button>
                        </div>
                        <label className="initiative-search">
                          <span
                            className="initiative-search__icon"
                            aria-hidden="true"
                          >
                            <Search size={16} />
                          </span>
                          <span className="sr-only">Buscar iniciativas</span>
                          <input
                            value={initiativeQuery}
                            onChange={(event) =>
                              setInitiativeQuery(event.target.value)
                            }
                            placeholder="Buscar por idea, problema o resultado"
                          />
                          {initiativeQuery ? (
                            <button
                              type="button"
                              aria-label="Limpiar búsqueda"
                              onClick={() => setInitiativeQuery("")}
                            >
                              ×
                            </button>
                          ) : null}
                        </label>
                        <div
                          className="initiative-filters initiative-filters--status"
                          role="group"
                          aria-label="Filtrar iniciativas"
                        >
                          {(
                            [
                              ["all", "Todas"],
                              ["draft", "Borradores"],
                              ["returned", "Devueltas"],
                              ["presented", "Presentadas"],
                              ["under_review", "Por decidir"],
                              ["closed", "Cerradas"],
                            ] as const
                          ).map(([key, label]) => (
                            <button
                              type="button"
                              key={key}
                              aria-pressed={initiativeFilter === key}
                              onClick={() => setInitiativeFilter(key)}
                            >
                              {label}
                              <span>
                                {key === "all"
                                  ? initiatives.length
                                  : key === "closed"
                                    ? initiatives.filter((item) =>
                                        [
                                          "approved",
                                          "rejected",
                                          "cancelled",
                                        ].includes(item.status),
                                      ).length
                                    : initiatives.filter(
                                        (item) => item.status === key,
                                      ).length}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                      {!loading && !error && initiatives.length === 0 ? (
                        <div className="initiative-empty">
                          <h3>Aún no hay propuestas en este espacio</h3>
                          <p>
                            Las iniciativas que propongan sus miembros
                            aparecerán aquí con su estado y avance.
                          </p>
                        </div>
                      ) : null}
                      {!loading && error && initiatives.length === 0 ? (
                        <div className="initiative-empty">
                          <h3>No se pudo cargar esta bandeja</h3>
                          <p>
                            Tus datos no se han reemplazado por una lista vacía.
                            Comprueba el acceso o vuelve a intentarlo.
                          </p>
                          <button
                            type="button"
                            className="initiative-inline-action"
                            onClick={() => void loadInitiatives()}
                          >
                            Reintentar carga <span aria-hidden="true">→</span>
                          </button>
                        </div>
                      ) : null}
                      {!loading &&
                      !error &&
                      initiatives.length > 0 &&
                      filteredInitiatives.length === 0 ? (
                        <p className="initiative-no-results">
                          No hay iniciativas que coincidan con este alcance y
                          filtros. Prueba otra búsqueda o selección.
                        </p>
                      ) : null}
                      <div
                        className={`initiative-list${filteredInitiatives.length > 5 ? " initiative-list--scrollable" : ""}`}
                        role={
                          filteredInitiatives.length > 5 ? "region" : undefined
                        }
                        aria-label={
                          filteredInitiatives.length > 5
                            ? "Lista de iniciativas, desplazable"
                            : undefined
                        }
                        tabIndex={
                          filteredInitiatives.length > 5 ? 0 : undefined
                        }
                      >
                        {filteredInitiatives.map((initiative) => (
                          <button
                            type="button"
                            className="initiative-row"
                            key={initiative.id}
                            onClick={() => openInitiative(initiative)}
                            aria-pressed={selected?.id === initiative.id}
                          >
                            <span
                              className="initiative-row__status"
                              data-status={initiative.status}
                              aria-hidden="true"
                            />
                            <span>
                              <strong>{initiative.title}</strong>
                              <small>
                                {initiative.proposalDetails.summary ||
                                  initiative.problemStatement}
                              </small>
                              <span className="initiative-row__context">
                                {initiative.createdByActorId ===
                                session?.actorId
                                  ? "Tu propuesta"
                                  : (initiative.createdByDisplayName ??
                                    "Integrante del espacio")}{" "}
                                · Actualizada{" "}
                                <time dateTime={initiative.updatedAt}>
                                  {formatInitiativeDate(initiative.updatedAt)}
                                </time>
                              </span>
                              <span className="initiative-row__meta">
                                <span>
                                  {initiativeStatusLabel(initiative.status)}
                                </span>
                                <span>
                                  {initiative.classification === "confidential"
                                    ? "Confidencial"
                                    : "Interna"}
                                </span>
                                {initiative.requestedPriority ? (
                                  <span>
                                    Solicitada:{" "}
                                    {initiative.requestedPriority === "high"
                                      ? "alta"
                                      : initiative.requestedPriority === "low"
                                        ? "baja"
                                        : "media"}
                                  </span>
                                ) : null}
                                {initiative.duplicateWarnings.length > 0 ? (
                                  <span>
                                    {initiative.duplicateWarnings.length}{" "}
                                    posible
                                    {initiative.duplicateWarnings.length === 1
                                      ? ""
                                      : "s"}{" "}
                                    coincidencia
                                    {initiative.duplicateWarnings.length === 1
                                      ? ""
                                      : "s"}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            <span
                              className="initiative-row__open"
                              aria-hidden="true"
                            >
                              →
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <aside id="detail" aria-label="Detalle de iniciativa">
                      <Card>
                        {selected ? (
                          <>
                            <header className="initiative-detail__hero">
                              <div className="initiative-detail__topline">
                                <span className="workspace-kicker">
                                  PROPUESTA DEL EQUIPO
                                </span>
                                <Status>
                                  {initiativeStatusLabel(selected.status)}
                                </Status>
                              </div>
                              <h2>{selected.title}</h2>
                              <p className="initiative-detail__summary">
                                {selected.proposalDetails.summary ||
                                  "Esta iniciativa todavía no tiene un resumen."}
                              </p>
                              <p className="initiative-detail__byline">
                                Propuesta por{" "}
                                <strong>
                                  {selected.createdByActorId ===
                                  session?.actorId
                                    ? "ti"
                                    : (selected.createdByDisplayName ??
                                      "un integrante del espacio")}
                                </strong>
                                {" · "}Creada{" "}
                                <time dateTime={selected.createdAt}>
                                  {formatInitiativeDate(selected.createdAt)}
                                </time>
                              </p>
                              <dl className="initiative-detail__facts">
                                <div>
                                  <dt>Clasificación</dt>
                                  <dd>
                                    {selected.classification === "confidential"
                                      ? "Confidencial"
                                      : "Interna"}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Prioridad solicitada</dt>
                                  <dd>
                                    {selected.requestedPriority
                                      ? selected.requestedPriority === "high"
                                        ? "Alta"
                                        : selected.requestedPriority === "low"
                                          ? "Baja"
                                          : "Media"
                                      : "Sin definir"}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Personas impactadas</dt>
                                  <dd>
                                    {selected.proposalDetails.impactedCount
                                      ? `${new Intl.NumberFormat("es-CL").format(selected.proposalDetails.impactedCount)} ${selected.proposalDetails.impactedCount === 1 ? "persona" : "personas"}`
                                      : "Por definir"}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Prioridad operativa</dt>
                                  <dd>
                                    {selected.operationalPriority === "high"
                                      ? "Alta"
                                      : selected.operationalPriority ===
                                          "medium"
                                        ? "Media"
                                        : selected.operationalPriority === "low"
                                          ? "Baja"
                                          : "Sin asignar"}
                                  </dd>
                                </div>
                              </dl>
                              <div className="initiative-detail__responsibility">
                                <span className="initiative-detail__responsibility-label">
                                  SIGUIENTE PASO
                                </span>
                                <strong>
                                  {initiativeNextStep(selected.status).replace(
                                    "Siguiente paso: ",
                                    "",
                                  )}
                                </strong>
                                {selected.intakeAssignment ? (
                                  <span>
                                    Responsable:{" "}
                                    {selected.intakeAssignment
                                      .responsibleActorId === session?.actorId
                                      ? "tú"
                                      : (selected.intakeAssignment
                                          .responsibleDisplayName ??
                                        "persona asignada")}
                                  </span>
                                ) : selected.status === "presented" ? (
                                  <span>Sin responsable asignado</span>
                                ) : null}
                                {selected.intakeAssignment ? (
                                  <span>
                                    Revisión:{" "}
                                    <time
                                      dateTime={
                                        selected.intakeAssignment.nextReviewOn
                                      }
                                    >
                                      {formatInitiativeDay(
                                        selected.intakeAssignment.nextReviewOn,
                                      )}
                                    </time>
                                  </span>
                                ) : null}
                              </div>
                            </header>
                            {canRenderInitiativeAction(selected, "edit") ||
                            canRenderInitiativeAction(selected, "present") ? (
                              <div className="initiative-detail__actions">
                                {canRenderInitiativeAction(selected, "edit") ? (
                                  <Button
                                    type="button"
                                    tone="quiet"
                                    onClick={() =>
                                      beginEditInitiative(selected)
                                    }
                                  >
                                    Editar iniciativa
                                  </Button>
                                ) : null}
                                {canRenderInitiativeAction(
                                  selected,
                                  "present",
                                ) ? (
                                  <Button
                                    type="button"
                                    onClick={() => void present(selected)}
                                  >
                                    Presentar iniciativa
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                            <section
                              className="initiative-detail__journey"
                              aria-labelledby="initiative-detail-journey-title"
                            >
                              <h3 id="initiative-detail-journey-title">
                                Flujo de la iniciativa
                              </h3>
                              <JourneyProgress status={selected.status} />
                            </section>
                            {selectedInitiativeProject ? (
                              <button
                                type="button"
                                className="initiative-detail__project-link"
                                onClick={() =>
                                  openProject(selectedInitiativeProject)
                                }
                              >
                                Proyecto vinculado:{" "}
                                {selectedInitiativeProject.name}
                                <span aria-hidden="true">→</span>
                              </button>
                            ) : null}
                            {selected.duplicateWarnings.length > 0 ? (
                              <Notice tone="info">
                                <strong>
                                  Posibles propuestas relacionadas
                                </strong>
                                <p>
                                  Revísalas antes de presentar para aprovechar
                                  el trabajo existente.
                                </p>
                                <ul className="initiative-related">
                                  {selected.duplicateWarnings.map((warning) => (
                                    <li key={warning.initiativeId}>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openRelatedInitiative(
                                            warning.initiativeId,
                                          )
                                        }
                                      >
                                        {warning.title}
                                        <span aria-hidden="true">→</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </Notice>
                            ) : null}
                            <nav
                              className="initiative-detail__nav"
                              aria-label="Secciones de la iniciativa"
                            >
                              <a href="#initiative-proposal-problem">
                                Problema e impacto
                              </a>
                              <a href="#initiative-proposal-response">
                                Respuesta
                              </a>
                              <a href="#initiative-proposal-pilotage">
                                Pilotaje
                              </a>
                              <a href="#initiative-history-title">Actividad</a>
                            </nav>
                            <section
                              className="initiative-proposal-detail"
                              aria-label="Contenido de la propuesta"
                            >
                              <div
                                id="initiative-proposal-problem"
                                className="initiative-proposal-detail__group"
                              >
                                <h3>Problema e impacto</h3>
                                <dl className="initiative-proposal-detail__grid">
                                  <ProposalDetail
                                    label="Problemática identificada"
                                    value={selected.problemStatement}
                                    wide
                                  />
                                  <ProposalDetail
                                    label="Personas impactadas"
                                    value={
                                      selected.proposalDetails.impactedPeople
                                    }
                                  />
                                  <ProposalDetail
                                    label="Impacto de la problemática"
                                    value={
                                      selected.proposalDetails.problemImpact
                                    }
                                  />
                                </dl>
                              </div>
                              <div
                                id="initiative-proposal-response"
                                className="initiative-proposal-detail__group"
                              >
                                <h3>Respuesta propuesta</h3>
                                <dl className="initiative-proposal-detail__grid">
                                  <ProposalDetail
                                    label="Propuesta de valor"
                                    value={selected.expectedOutcome}
                                    wide
                                  />
                                  <ProposalDetail
                                    label="Solución e innovación"
                                    value={selected.proposalDetails.solution}
                                  />
                                  <ProposalDetail
                                    label="Diferenciación"
                                    value={
                                      selected.proposalDetails.differentiation
                                    }
                                  />
                                </dl>
                              </div>
                              <div
                                id="initiative-proposal-pilotage"
                                className="initiative-proposal-detail__group"
                              >
                                <h3>Estado y pilotaje</h3>
                                <dl className="initiative-proposal-detail__grid">
                                  <ProposalDetail
                                    label="Estado del proyecto"
                                    value={projectStageLabel(
                                      selected.proposalDetails.projectStage,
                                    )}
                                  />
                                  <ProposalDetail
                                    label="Justificación de la etapa"
                                    value={
                                      selected.proposalDetails.stageRationale
                                    }
                                  />
                                  <ProposalDetail
                                    label="Plan de pilotaje"
                                    value={selected.proposalDetails.pilotPlan}
                                  />
                                  <ProposalDetail
                                    label="Recursos para el pilotaje"
                                    value={
                                      selected.proposalDetails.pilotResources
                                    }
                                  />
                                </dl>
                              </div>
                            </section>
                            {canRenderInitiativeAction(selected, "review") ? (
                              <ReviewForm
                                standard={activeStandard}
                                loadError={standardsError}
                                assessments={assessments}
                                onChange={setAssessments}
                                onSubmit={review}
                                onRetry={() => void loadInitiatives()}
                                onOpenConfiguration={() =>
                                  navigate("organization", "standards")
                                }
                              />
                            ) : null}
                            {canRenderInitiativeAction(selected, "decide") ? (
                              <DecisionForm
                                outcome={outcome}
                                rationale={rationale}
                                evidence={decisionEvidence}
                                nextReviewOn={decisionNextReviewOn}
                                onOutcome={setOutcome}
                                onRationale={setRationale}
                                onEvidence={setDecisionEvidence}
                                onNextReviewOn={setDecisionNextReviewOn}
                                onSubmit={decide}
                              />
                            ) : null}
                            {evaluation ? (
                              <section className="evidence-card initiative-review-result">
                                <h3>Evaluación registrada</h3>
                                <p>
                                  Estándar aplicado: versión{" "}
                                  {evaluation.standardVersion}. La evaluación
                                  conserva los criterios de esa versión.
                                </p>
                                <p>
                                  Cobertura: {evaluation.coverage.percentage}% (
                                  {evaluation.coverage.assessedCriteria}/
                                  {evaluation.coverage.applicableCriteria}{" "}
                                  aplicables;{" "}
                                  {evaluation.coverage.notApplicableCriteria} no
                                  aplicables)
                                </p>
                                {evaluation.quality ? (
                                  <p>
                                    Calidad ponderada:{" "}
                                    {evaluation.quality.percentage}% (
                                    {evaluation.quality.metWeight}/
                                    {evaluation.quality.assessedWeight} de peso
                                    evaluado)
                                  </p>
                                ) : null}
                                {evaluation.maturity ? (
                                  <p>
                                    Madurez: {evaluation.maturity.levelName}{" "}
                                    (desde{" "}
                                    {
                                      evaluation.maturity
                                        .minimumQualityPercentage
                                    }
                                    % de calidad)
                                  </p>
                                ) : null}
                                <details>
                                  <summary>
                                    Ver criterios y evidencias de la evaluación
                                  </summary>
                                  <ul>
                                    {evaluation.criteria.map((entry) => (
                                      <li key={entry.criterion.id}>
                                        <strong>{entry.criterion.name}</strong>
                                        <span>
                                          {entry.assessment === "met"
                                            ? "Cumple"
                                            : entry.assessment === "not_met"
                                              ? "No cumple"
                                              : entry.assessment ===
                                                  "not_applicable"
                                                ? "No aplica"
                                                : "Sin evaluar"}
                                        </span>
                                        {entry.evidence.length > 0 ? (
                                          <p>{entry.evidence.join(" · ")}</p>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              </section>
                            ) : null}
                            {decision ? (
                              <section className="evidence-card initiative-review-result">
                                <h3>
                                  Decisión:{" "}
                                  {initiativeDecisionLabel(decision.outcome)}
                                </h3>
                                <p>{decision.rationale}</p>
                                <p>
                                  Registrada el{" "}
                                  <time dateTime={decision.decidedAt}>
                                    {formatInitiativeDate(decision.decidedAt)}
                                  </time>
                                  {" · "}Estándar versión{" "}
                                  {decision.standardVersion}
                                </p>
                                {decision.nextReviewOn ? (
                                  <p>
                                    Próxima revisión:{" "}
                                    <time dateTime={decision.nextReviewOn}>
                                      {formatInitiativeDay(
                                        decision.nextReviewOn,
                                      )}
                                    </time>
                                  </p>
                                ) : null}
                                {decision.evidence.length > 0 ? (
                                  <details>
                                    <summary>
                                      Ver evidencia de la decisión
                                    </summary>
                                    <ul>
                                      {decision.evidence.map((item, index) => (
                                        <li key={`${index}-${item}`}>{item}</li>
                                      ))}
                                    </ul>
                                  </details>
                                ) : null}
                                {decision.conditions.length > 0 ? (
                                  <details>
                                    <summary>
                                      Condiciones de aprobación (
                                      {decision.conditions.length})
                                    </summary>
                                    <ul>
                                      {decision.conditions.map((condition) => (
                                        <li key={condition.id}>
                                          {condition.description} ·{" "}
                                          {condition.status === "pending"
                                            ? "Pendiente"
                                            : condition.status === "fulfilled"
                                              ? "Cumplida"
                                              : "Eximida"}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                ) : null}
                              </section>
                            ) : null}
                            {selected.status === "approved" &&
                            decision &&
                            !selectedInitiativeProject ? (
                              <form
                                className="nested-form"
                                onSubmit={createProject}
                              >
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
                                  Deben ser miembros distintos de la
                                  organización.
                                </p>
                                <Button type="submit">Crear proyecto</Button>
                              </form>
                            ) : null}
                            <AuditTimeline events={audit} />
                          </>
                        ) : (
                          <div className="initiative-detail__empty">
                            {loading ? (
                              <div
                                className="initiative-detail__empty-loading"
                                aria-busy="true"
                              >
                                <span className="initiative-loading__dot" />
                                Cargando iniciativas…
                              </div>
                            ) : (
                              <div className="initiative-detail__empty-copy">
                                <p className="workspace-kicker">
                                  DETALLE DE INICIATIVA
                                </p>
                                <h2>
                                  {error
                                    ? "No se pudo cargar la bandeja."
                                    : initiatives.length === 0
                                      ? "El detalle aparecerá aquí."
                                      : "No hay resultados para esta vista."}
                                </h2>
                                <p>
                                  {error
                                    ? "La información de las propuestas estará disponible cuando se restablezca la conexión."
                                    : initiatives.length === 0
                                      ? "Selecciona una propuesta para revisar su contexto, evaluación, decisión e historial."
                                      : "Prueba con otra búsqueda o ajusta los filtros de la bandeja."}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </Card>
                    </aside>
                  </div>
                </div>
              ) : null}
              {activeView === "initiative-new" ||
              (activeView === "initiative-edit" && selected) ? (
                <InitiativeProposalWizard
                  mode={activeView === "initiative-edit" ? "edit" : "create"}
                  draft={draft}
                  onChange={setDraft}
                  step={initiativeWizardStep}
                  maxStep={
                    activeView === "initiative-edit"
                      ? 3
                      : initiativeWizardMaxStep
                  }
                  error={initiativeWizardError}
                  busy={initiativeSaving || !ready}
                  onStepChange={(step) => {
                    setInitiativeWizardStep(step);
                    setInitiativeWizardError("");
                  }}
                  onContinue={advanceInitiativeStep}
                  onBack={() => {
                    setInitiativeWizardStep((current) =>
                      Math.max(0, current - 1),
                    );
                    setInitiativeWizardError("");
                  }}
                  onSubmit={
                    activeView === "initiative-edit"
                      ? saveEdit
                      : createInitiative
                  }
                  onCancel={() => navigate("initiatives")}
                />
              ) : null}
              {activeView === "projects" ? (
                <>
                  <div className="workspace-section-heading">
                    <div>
                      <p className="workspace-kicker">
                        DE LA DECISIÓN A LA ACCIÓN
                      </p>
                      <h1>Proyectos</h1>
                      <p>
                        Avanza con claridad sobre hitos, responsables y tareas.
                      </p>
                    </div>
                  </div>
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
                              onClick={() => openProject(project)}
                            >
                              <strong>{project.name}</strong>
                              <Status>
                                {projectStatusLabel(project.status)}
                              </Status>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Card>
                          <p>No existen proyectos en este workspace.</p>
                          <p className="muted">
                            Los proyectos nacen de una iniciativa aprobada y una
                            decisión trazable.
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
                                    Versión{" "}
                                    {baselineDifference.baseline.version}{" "}
                                    aprobada el{" "}
                                    {new Date(
                                      baselineDifference.baseline.approvedAt,
                                    ).toLocaleString("es-CL")}
                                    .
                                  </p>
                                  {baselineDifference.differences.length ? (
                                    <ol>
                                      {baselineDifference.differences.map(
                                        (difference) => (
                                          <li key={difference.field}>
                                            <strong>
                                              {
                                                baselineFieldLabels[
                                                  difference.field
                                                ]
                                              }
                                            </strong>
                                            <br />
                                            <small>
                                              Línea base:{" "}
                                              {difference.baselineValue ??
                                                "Sin valor"}
                                              <br />
                                              Actual:{" "}
                                              {difference.currentValue ??
                                                "Sin valor"}
                                            </small>
                                          </li>
                                        ),
                                      )}
                                    </ol>
                                  ) : (
                                    <p className="muted">
                                      El proyecto coincide con su línea base.
                                    </p>
                                  )}
                                </>
                              ) : (
                                <p className="muted">
                                  Aún no hay una línea base aprobada para este
                                  proyecto.
                                </p>
                              )}
                            </section>
                            <form
                              className="nested-form"
                              onSubmit={changeProjectStatus}
                            >
                              <label className="ui-field">
                                Estado
                                <select
                                  value={projectStatus}
                                  onChange={(event) =>
                                    setProjectStatus(
                                      event.target
                                        .value as ProjectResponse["status"],
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
                            <form
                              className="nested-form"
                              onSubmit={addMilestone}
                            >
                              <h3>Nuevo hito</h3>
                              <Field
                                label="Título"
                                value={milestone.title}
                                onChange={(event) =>
                                  setMilestone({
                                    ...milestone,
                                    title: event.target.value,
                                  })
                                }
                                required
                              />
                              <Field
                                label="Fecha límite"
                                type="date"
                                value={milestone.dueOn}
                                onChange={(event) =>
                                  setMilestone({
                                    ...milestone,
                                    dueOn: event.target.value,
                                  })
                                }
                              />
                              <Button type="submit">Añadir hito</Button>
                            </form>
                            {session ? (
                              <NewTaskForm
                                key={selectedProject.id}
                                projectId={selectedProject.id}
                                organizationId={organizationId}
                                workspaceId={selectedProject.workspaceId}
                                actorId={session.actorId}
                                request={request}
                                readOnly={[
                                  "completed",
                                  "cancelled",
                                  "archived",
                                ].includes(selectedProject.status)}
                                onCreated={() => {
                                  setSelectedProject({ ...selectedProject });
                                  setWorkRevision((current) => current + 1);
                                  setMessage("Tarea añadida al proyecto.");
                                }}
                              />
                            ) : null}
                            <section className="audit">
                              <h3>Historial del proyecto</h3>
                              {projectAudit.length ? (
                                <ol>
                                  {projectAudit.map((event) => (
                                    <li key={event.id}>
                                      <strong>{event.eventType}</strong>
                                      <br />
                                      <small>
                                        {new Date(
                                          event.occurredAt,
                                        ).toLocaleString("es-CL")}{" "}
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
                          <p>
                            Selecciona un proyecto para gestionar su ejecución.
                          </p>
                        )}
                      </Card>
                    </aside>
                  </section>
                  {selectedProject && organizationId ? (
                    <ProjectTasks
                      key={selectedProject.id}
                      projectId={selectedProject.id}
                      organizationId={organizationId}
                      workspaceId={selectedProject.workspaceId}
                      refreshKey={selectedProject}
                      request={request}
                      onChanged={() =>
                        setWorkRevision((current) => current + 1)
                      }
                      readOnly={["completed", "cancelled", "archived"].includes(
                        selectedProject.status,
                      )}
                    />
                  ) : null}
                </>
              ) : null}
              {activeView === "organization" ? (
                <OrganizationCenter
                  organization={organizations.find(
                    (item) => item.id === organizationId,
                  )!}
                  workspaces={workspaces}
                  workspaceId={workspaceId}
                  capabilities={capabilities}
                  request={request}
                  onSelectWorkspace={(id) => {
                    changeWorkspace(id);
                    navigate("overview");
                  }}
                  onWorkspaceCreated={(workspace) => {
                    setWorkspaces((items) => [...items, workspace]);
                    changeWorkspace(workspace.id);
                  }}
                  onStandardsActivated={() => void loadInitiatives()}
                  section={organizationSection}
                  onSectionChange={setOrganizationSection}
                />
              ) : null}
              {activeView === "organization-new" ? (
                <NewOrganization
                  request={request}
                  onCancel={() => navigate("organization")}
                  onCreated={(organization, workspace) => {
                    setOrganizations((items) => [...items, organization]);
                    resetContextData();
                    setOrganizationId(organization.id);
                    setWorkspaces([workspace]);
                    setWorkspaceId(workspace.id);
                    setWorkspacesLoaded(true);
                    navigate("organization");
                    setMessage("Organización y primer espacio creados.");
                  }}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      {logoutDialog}
    </div>
  );
}

function JourneyStep({
  label,
  count,
  detail,
}: {
  label: string;
  count: number;
  detail: string;
}) {
  return (
    <div className="initiative-journey__step">
      <span className="initiative-journey__count">{count}</span>
      <span className="initiative-journey__label">{label}</span>
      <span className="initiative-journey__detail">{detail}</span>
    </div>
  );
}

function JourneyProgress({ status }: { status: InitiativeResponse["status"] }) {
  if (status === "returned" || status === "cancelled")
    return (
      <p className="initiative-progress__exception">
        {status === "returned"
          ? "Devuelta para cambios. Tras corregirla podrás presentarla de nuevo."
          : "Esta iniciativa se canceló antes de completar el recorrido."}
      </p>
    );
  const currentStep = initiativeProgressStep(status);
  const labels = ["Borrador", "Presentada", "Evaluada", "Decisión"];
  return (
    <ol className="initiative-progress">
      {labels.map((label, index) => (
        <li
          key={label}
          aria-current={index === currentStep ? "step" : undefined}
          className={
            index < currentStep
              ? "is-complete"
              : index === currentStep
                ? "is-current"
                : ""
          }
        >
          <span>{index < currentStep ? "✓" : `0${index + 1}`}</span>
          <small>{label}</small>
        </li>
      ))}
    </ol>
  );
}

function initiativeProgressStep(status: InitiativeResponse["status"]) {
  return status === "draft"
    ? 0
    : status === "presented"
      ? 1
      : status === "under_review"
        ? 2
        : 3;
}

function formatInitiativeDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatInitiativeDay(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function initiativeNextStep(status: InitiativeResponse["status"]) {
  const labels: Record<InitiativeResponse["status"], string> = {
    draft: "Siguiente paso: presentar",
    returned: "Siguiente paso: corregir y presentar",
    presented: "Siguiente paso: revisión",
    under_review: "Siguiente paso: decisión",
    approved: "Decisión: aprobada",
    rejected: "Decisión: rechazada",
    cancelled: "Iniciativa cancelada",
  };
  return labels[status];
}

function initiativeDecisionLabel(
  outcome: InitiativeDecisionResponse["outcome"],
) {
  const labels: Record<InitiativeDecisionResponse["outcome"], string> = {
    approved: "Aprobada",
    rejected: "Rechazada",
    returned: "Devuelta para cambios",
    cancelled: "Cancelada",
  };
  return labels[outcome];
}

function ProposalDetail({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={[
        "initiative-proposal-detail__item",
        wide ? "is-wide" : "",
        !value.trim() ? "is-empty" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <dt>{label}</dt>
      <dd>{value.trim() || "Aún sin completar"}</dd>
    </div>
  );
}

function projectStageLabel(
  stage: InitiativeResponse["proposalDetails"]["projectStage"],
) {
  const labels: Record<
    InitiativeResponse["proposalDetails"]["projectStage"],
    string
  > = {
    idea: "Idea",
    prototype: "Prototipo",
    in_development: "En desarrollo",
    operating: "Funcionando",
    other: "Otra etapa",
  };
  return labels[stage];
}

function ReviewForm({
  standard,
  loadError,
  assessments,
  onChange,
  onSubmit,
  onRetry,
  onOpenConfiguration,
}: {
  standard: EvaluationStandardResponse | null;
  loadError: string;
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
  onRetry: () => void;
  onOpenConfiguration: () => void;
}) {
  if (!standard && loadError)
    return (
      <Notice tone="error">
        No se pudo consultar el estándar de evaluación: {loadError}
        <button
          type="button"
          className="initiative-inline-action"
          onClick={onRetry}
        >
          Reintentar
        </button>
      </Notice>
    );
  if (!standard)
    return (
      <Notice tone="info">
        Esta organización aún no tiene un estándar de evaluación activo.
        <button
          type="button"
          className="initiative-inline-action"
          onClick={onOpenConfiguration}
        >
          Abrir configuración institucional
        </button>
      </Notice>
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
  nextReviewOn,
  onOutcome,
  onRationale,
  onEvidence,
  onNextReviewOn,
  onSubmit,
}: {
  outcome: "approved" | "rejected" | "returned" | "cancelled";
  rationale: string;
  evidence: string;
  nextReviewOn: string;
  onOutcome: (
    value: "approved" | "rejected" | "returned" | "cancelled",
  ) => void;
  onRationale: (value: string) => void;
  onEvidence: (value: string) => void;
  onNextReviewOn: (value: string) => void;
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
      {outcome === "returned" ? (
        <label className="ui-field">
          Próxima fecha de revisión
          <input
            type="date"
            required
            value={nextReviewOn}
            onChange={(event) => onNextReviewOn(event.target.value)}
          />
        </label>
      ) : null}
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
    <section
      className="initiative-history"
      aria-labelledby="initiative-history-title"
    >
      <h3 id="initiative-history-title">Actividad</h3>
      {events.length ? (
        <ol>
          {events.map((event) => (
            <li key={event.id}>
              <span className="initiative-history__marker" aria-hidden="true" />
              <div>
                <strong>{initiativeEventLabel(event.eventType)}</strong>
                <time dateTime={event.occurredAt}>
                  {new Intl.DateTimeFormat("es-CL", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.occurredAt))}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Todavía no hay actividad registrada.</p>
      )}
    </section>
  );
}

function initiativeEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    "initiative.created.v1": "Iniciativa creada",
    "initiative.edited.v1": "Propuesta actualizada",
    "initiative.presented.v1": "Iniciativa presentada",
    "initiative.review_started.v1": "Revisión iniciada",
    "initiative.evaluated.v1": "Evaluación registrada",
    "initiative.decided.v1": "Decisión registrada",
    "initiative.decided.v2": "Decisión registrada",
    "initiative.operational_priority_set.v1": "Prioridad actualizada",
    "initiative.intake_assigned.v1": "Responsable asignado",
    "initiative.triaged.v1": "Clasificación actualizada",
    "initiative.diagnostic_saved.v1": "Diagnóstico guardado",
    "initiative.relationship_declared.v1": "Relación registrada",
    "initiative.evaluation_draft_saved.v1": "Borrador de evaluación guardado",
    "initiative.evaluation_draft_migrated.v1": "Evaluación actualizada",
    "initiative.evaluation_reviewer_assigned.v1": "Evaluador asignado",
    "initiative.evaluation_reviewer_reassigned.v1": "Evaluador reasignado",
    "initiative.evaluation_reviewer_abstained.v1": "Abstención registrada",
    "initiative.evaluation_reviewer_abstention_escalated.v1":
      "Abstención escalada",
    "initiative.evaluation_conflict_declared.v1": "Conflicto declarado",
    "initiative.evaluation_conflict_resolved.v1": "Conflicto resuelto",
    "initiative.evaluation_annulled.v1": "Evaluación anulada",
    "initiative.decision_condition_fulfilled.v1": "Condición cumplida",
    "initiative.decision_condition_exempted.v1": "Condición eximida",
  };
  return labels[eventType] ?? "Actividad registrada";
}
