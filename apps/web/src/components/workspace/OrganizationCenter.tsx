"use client";

import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Layers3,
  MailPlus,
  Plus,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  AccessCapabilitiesResponse,
  EffectiveTenancyPolicyResponse,
  InitiativeResponsibilityRole,
  OrganizationResponse,
  OrganizationResponsibilitiesResponse,
  OrganizationRoleProfileResponse,
  WorkspaceResponse,
} from "@aether/contracts";
import { InstitutionalStandards } from "./InstitutionalStandards";
import { OrganizationSelect } from "./OrganizationSelect";
import { OrganizationRoleProfilePreview } from "./OrganizationRoleProfilePreview";

type Request = (url: string, init?: RequestInit) => Promise<Response>;
type OrganizationKind = NonNullable<OrganizationResponse["organizationType"]>;
type WorkspaceMode = WorkspaceResponse["mode"];
type OrganizationSettingsTab = "people" | "policy" | "spaces";

const organizationKinds: Array<{ value: OrganizationKind; label: string }> = [
  { value: "business", label: "Equipo o empresa" },
  { value: "institutional", label: "Institución" },
  { value: "personal", label: "Uso personal" },
];

const workspaceModes: Array<{ value: WorkspaceMode; label: string }> = [
  { value: "team", label: "Equipo" },
  { value: "institutional", label: "Institucional" },
  { value: "personal", label: "Personal" },
];

function organizationTypeLabel(type: OrganizationResponse["organizationType"]) {
  return (
    organizationKinds.find((option) => option.value === type)?.label ??
    "Organización"
  );
}

function workspaceModeLabel(mode: WorkspaceMode) {
  return (
    workspaceModes.find((option) => option.value === mode)?.label ?? "Espacio"
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function OrganizationCenter({
  organization,
  workspaces,
  workspaceId,
  capabilities,
  request,
  onSelectWorkspace,
  onWorkspaceCreated,
  onStandardsActivated,
  section,
  onSectionChange,
}: {
  organization: OrganizationResponse;
  workspaces: WorkspaceResponse[];
  workspaceId: string;
  capabilities: AccessCapabilitiesResponse;
  request: Request;
  onSelectWorkspace: (id: string) => void;
  onWorkspaceCreated: (workspace: WorkspaceResponse) => void;
  onStandardsActivated: () => void;
  section: "overview" | "standards";
  onSectionChange: (section: "overview" | "standards") => void;
}) {
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<OrganizationSettingsTab>("people");
  const [policy, setPolicy] = useState<EffectiveTenancyPolicyResponse | null>(
    null,
  );
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState("");
  const [policySuccess, setPolicySuccess] = useState("");
  const [region, setRegion] = useState("");
  const [retentionDays, setRetentionDays] = useState(365);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const workspaceNameField = useRef<HTMLInputElement>(null);
  const workspaceFormScrollTop = useRef<number | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("team");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceSuccess, setWorkspaceSuccess] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteOrganizationRole, setInviteOrganizationRole] = useState<
    "admin" | "member"
  >("member");
  const [inviteWorkspaceRole, setInviteWorkspaceRole] = useState<
    "admin" | "member" | "viewer"
  >("member");
  const [inviteWorkspaceIds, setInviteWorkspaceIds] = useState<string[]>(
    workspaceId ? [workspaceId] : [],
  );
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteStatus, setInviteStatus] = useState("");
  const [inviteError, setInviteError] = useState("");
  const invitableWorkspaces = workspaces.filter(
    (workspace) => workspace.status === "active",
  );
  const invitableWorkspaceIds = invitableWorkspaces
    .map((workspace) => workspace.id)
    .join("|");

  useEffect(() => {
    setActiveSettingsTab("people");
  }, [organization.id]);

  useEffect(() => {
    setInviteWorkspaceIds(
      invitableWorkspaces.some((workspace) => workspace.id === workspaceId)
        ? [workspaceId]
        : [],
    );
    setInviteOrganizationRole("member");
    setInviteWorkspaceRole("member");
  }, [organization.id, workspaceId, invitableWorkspaceIds]);

  useEffect(() => {
    let active = true;
    setPolicy(null);
    setPolicyLoading(true);
    setPolicyError("");
    setPolicySuccess("");
    void request(`organizations/${organization.id}/policy`)
      .then(async (response) => {
        const value = (await response.json()) as EffectiveTenancyPolicyResponse;
        if (!active) return;
        setPolicy(value);
        setRegion(value.organizationPolicy.dataResidencyRegion);
        setRetentionDays(value.organizationPolicy.retentionDays);
      })
      .catch((error) => {
        if (active)
          setPolicyError(errorMessage(error, "No se pudo cargar la política."));
      })
      .finally(() => {
        if (active) setPolicyLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organization.id, request]);

  useLayoutEffect(() => {
    if (!showWorkspaceForm) return;
    const fitsViewport =
      window.matchMedia("(min-width: 1201px)").matches &&
      document.documentElement.scrollHeight <= window.innerHeight + 1;
    workspaceNameField.current?.focus({ preventScroll: fitsViewport });
    if (fitsViewport && workspaceFormScrollTop.current !== null)
      window.scrollTo(0, workspaceFormScrollTop.current);
    workspaceFormScrollTop.current = null;
  }, [showWorkspaceForm]);

  function toggleWorkspaceForm() {
    const shouldOpen = !showWorkspaceForm;
    if (shouldOpen) workspaceFormScrollTop.current = window.scrollY;
    setShowWorkspaceForm(shouldOpen);
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || !capabilities.canManageOrganization) return;
    setPolicyBusy(true);
    setPolicyError("");
    setPolicySuccess("");
    try {
      const response = await request(
        `organizations/${organization.id}/policy`,
        {
          method: "PUT",
          body: JSON.stringify({
            dataResidencyRegion: region.trim(),
            retentionDays,
            ...(policy.organizationPolicy.businessHours
              ? { businessHours: policy.organizationPolicy.businessHours }
              : {}),
          }),
        },
      );
      const saved =
        (await response.json()) as EffectiveTenancyPolicyResponse["organizationPolicy"];
      setPolicy((current) =>
        current ? { ...current, organizationPolicy: saved } : current,
      );
      setRegion(saved.dataResidencyRegion);
      setRetentionDays(saved.retentionDays);
      setPolicySuccess("Política de la organización actualizada.");
    } catch (error) {
      setPolicyError(errorMessage(error, "No se pudo guardar la política."));
    } finally {
      setPolicyBusy(false);
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capabilities.canCreateWorkspace) return;
    setWorkspaceBusy(true);
    setWorkspaceError("");
    setWorkspaceSuccess("");
    try {
      const response = await request("workspaces", {
        method: "POST",
        body: JSON.stringify({
          organizationId: organization.id,
          name: workspaceName.trim(),
          mode: workspaceMode,
        }),
      });
      const workspace = (await response.json()) as WorkspaceResponse;
      onWorkspaceCreated(workspace);
      setWorkspaceName("");
      setShowWorkspaceForm(false);
      setWorkspaceSuccess(`Se creó el espacio «${workspace.name}».`);
    } catch (error) {
      setWorkspaceError(errorMessage(error, "No se pudo crear el espacio."));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capabilities.canInviteMembers) return;
    setInviteBusy(true);
    setInviteError("");
    setInviteStatus("");
    try {
      await request(`organizations/${organization.id}/invitations`, {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail.trim(),
          organizationRole: inviteOrganizationRole,
          workspaceIds: inviteWorkspaceIds,
          workspaceRole: inviteWorkspaceRole,
          expiresInDays: 7,
        }),
      });
      setInviteEmail("");
      setInviteStatus("Invitación creada. El canal configurado la enviará.");
    } catch (error) {
      setInviteError(errorMessage(error, "No se pudo crear la invitación."));
    } finally {
      setInviteBusy(false);
    }
  }

  const policyUnchanged =
    policy?.organizationPolicy.dataResidencyRegion === region.trim() &&
    policy.organizationPolicy.retentionDays === retentionDays;

  if (section === "standards")
    return (
      <div className="organization-page organization-page--standards">
        <button
          type="button"
          className="organization-page__back"
          onClick={() => onSectionChange("overview")}
        >
          <ArrowLeft size={17} aria-hidden="true" /> Volver a organización y
          espacios
        </button>
        <header className="organization-page__heading">
          <div>
            <p className="organization-page__eyebrow">
              GOBIERNO DE INICIATIVAS
            </p>
            <h1>Evaluación de iniciativas</h1>
            <p>
              Configura los criterios que se aplicarán en {organization.name}.
            </p>
          </div>
        </header>
        <InstitutionalStandards
          organizationId={organization.id}
          capabilities={capabilities}
          request={request}
          onActivated={onStandardsActivated}
        />
      </div>
    );

  return (
    <div className="organization-page organization-page--center">
      <header className="organization-page__heading">
        <div>
          <p className="organization-page__eyebrow">TU ORGANIZACIÓN</p>
          <h1>Organización y espacios</h1>
          <p>
            Gestiona el contexto compartido, sus espacios y las personas que
            colaboran contigo.
          </p>
        </div>
      </header>

      <section
        className="organization-page__identity"
        aria-label="Organización actual"
      >
        <span className="organization-page__identity-icon">
          <Building2 size={25} aria-hidden="true" />
        </span>
        <div className="organization-page__identity-name">
          <span>ORGANIZACIÓN ACTUAL</span>
          <h2>{organization.name}</h2>
          <p>{organizationTypeLabel(organization.organizationType)}</p>
        </div>
        <dl className="organization-page__facts">
          <div>
            <dt>Espacios</dt>
            <dd>{workspaces.length}</dd>
          </div>
          <div>
            <dt>Zona horaria</dt>
            <dd>{organization.timezone}</dd>
          </div>
          <div>
            <dt>Idioma</dt>
            <dd>{organization.locale}</dd>
          </div>
        </dl>
      </section>

      <div
        className="organization-settings-tabs"
        role="group"
        aria-label="Configuración de la organización"
      >
        <button
          type="button"
          className="organization-settings-tabs__button"
          aria-pressed={activeSettingsTab === "people"}
          onClick={() => setActiveSettingsTab("people")}
        >
          <UsersRound size={18} aria-hidden="true" />
          <span>
            <strong>Usuarios</strong>
            <small>Acceso y responsabilidades</small>
          </span>
        </button>
        <button
          type="button"
          className="organization-settings-tabs__button"
          aria-pressed={activeSettingsTab === "policy"}
          onClick={() => setActiveSettingsTab("policy")}
        >
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            <strong>Política</strong>
            <small>Políticas y evaluación</small>
          </span>
        </button>
        <button
          type="button"
          className="organization-settings-tabs__button"
          aria-pressed={activeSettingsTab === "spaces"}
          onClick={() => setActiveSettingsTab("spaces")}
        >
          <Layers3 size={18} aria-hidden="true" />
          <span>
            <strong>Espacios</strong>
            <small>Áreas de trabajo</small>
          </span>
        </button>
      </div>

      <div className="organization-page__layout organization-page__layout--tab">
        {activeSettingsTab === "policy" ? (
          <section
            className="organization-page__card"
            id="organization-policy"
            aria-labelledby="organization-policy-title"
          >
            <div className="organization-page__card-heading organization-page__card-heading--action">
              <span className="organization-page__card-icon">
                <ShieldCheck size={20} aria-hidden="true" />
              </span>
              <div>
                <p className="organization-page__eyebrow">
                  CONFIGURACIÓN EXISTENTE
                </p>
                <h2 id="organization-policy-title">Política de datos</h2>
                <p>
                  Parámetros compartidos por la organización. Los espacios
                  pueden tener excepciones propias.
                </p>
              </div>
              {capabilities.canManageOrganization ? (
                <button
                  type="button"
                  className="organization-page__secondary"
                  onClick={() => onSectionChange("standards")}
                >
                  Estándar de evaluación
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {policyLoading ? (
              <p className="organization-page__hint" role="status">
                Cargando política…
              </p>
            ) : null}
            {policyError ? (
              <p className="organization-page__feedback is-error" role="alert">
                {policyError}
              </p>
            ) : null}
            {policy ? (
              <form className="organization-page__form" onSubmit={savePolicy}>
                <div className="organization-page__form-grid">
                  <label className="organization-page__field">
                    <span>Región de datos</span>
                    <input
                      value={region}
                      onChange={(event) => setRegion(event.target.value)}
                      maxLength={64}
                      minLength={2}
                      required
                      disabled={
                        !capabilities.canManageOrganization || policyBusy
                      }
                    />
                    <small>
                      Código de región configurado para tu despliegue.
                    </small>
                  </label>
                  <label className="organization-page__field">
                    <span>Retención de datos</span>
                    <span className="organization-page__number-field">
                      <input
                        type="number"
                        value={retentionDays}
                        onChange={(event) =>
                          setRetentionDays(Number(event.target.value))
                        }
                        min={1}
                        max={3650}
                        required
                        disabled={
                          !capabilities.canManageOrganization || policyBusy
                        }
                      />
                      <span>días</span>
                    </span>
                    <small>Entre 1 y 3650 días.</small>
                  </label>
                </div>
                <div className="organization-page__form-footer">
                  <p>
                    {capabilities.canManageOrganization
                      ? "Los cambios se aplican a la política de la organización."
                      : "Solo quienes administran la organización pueden editar esta política."}
                  </p>
                  {capabilities.canManageOrganization ? (
                    <button
                      type="submit"
                      className="organization-page__primary"
                      disabled={
                        policyBusy ||
                        policyUnchanged ||
                        !region.trim() ||
                        retentionDays < 1 ||
                        retentionDays > 3650
                      }
                    >
                      {policyBusy ? "Guardando…" : "Guardar cambios"}
                    </button>
                  ) : null}
                </div>
                {policySuccess ? (
                  <p
                    className="organization-page__feedback is-success"
                    role="status"
                  >
                    <Check size={16} aria-hidden="true" />
                    {policySuccess}
                  </p>
                ) : null}
              </form>
            ) : null}
          </section>
        ) : null}

        {activeSettingsTab === "spaces" ? (
          <section
            className="organization-page__card"
            id="organization-workspaces"
            aria-labelledby="organization-workspaces-title"
          >
            <div className="organization-page__card-heading organization-page__card-heading--action">
              <span className="organization-page__card-icon">
                <Layers3 size={20} aria-hidden="true" />
              </span>
              <div>
                <p className="organization-page__eyebrow">TRABAJO COMPARTIDO</p>
                <h2 id="organization-workspaces-title">Espacios de trabajo</h2>
                <p>
                  Entra a un espacio o crea uno para un equipo o propósito
                  distinto.
                </p>
              </div>
              {capabilities.canCreateWorkspace ? (
                <button
                  type="button"
                  className="organization-page__secondary"
                  aria-expanded={showWorkspaceForm}
                  aria-controls="organization-create-workspace"
                  onClick={toggleWorkspaceForm}
                >
                  <Plus size={17} aria-hidden="true" />
                  Nuevo espacio
                </button>
              ) : null}
            </div>
            <div
              className="organization-page__workspace-list"
              tabIndex={0}
              aria-label="Espacios de trabajo"
            >
              {workspaces.length ? (
                workspaces.map((workspace) => (
                  <div
                    className="organization-page__workspace"
                    key={workspace.id}
                  >
                    <span className="organization-page__workspace-icon">
                      <Layers3 size={19} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>{workspace.name}</strong>
                      <small>
                        {workspaceModeLabel(workspace.mode)}
                        {workspace.status === "archived" ? " · Archivado" : ""}
                      </small>
                    </div>
                    {workspace.id === workspaceId ? (
                      <span className="organization-page__current">
                        <Check size={14} aria-hidden="true" />
                        Actual
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="organization-page__text-button"
                        onClick={() => onSelectWorkspace(workspace.id)}
                      >
                        Abrir <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="organization-page__hint">
                  Todavía no hay espacios en esta organización.
                </p>
              )}
            </div>
            {workspaceSuccess ? (
              <p
                className="organization-page__feedback is-success"
                role="status"
              >
                <Check size={16} aria-hidden="true" />
                {workspaceSuccess}
              </p>
            ) : null}
            {showWorkspaceForm ? (
              <form
                className="organization-page__form organization-page__inline-form"
                id="organization-create-workspace"
                onSubmit={createWorkspace}
              >
                <h3>Nuevo espacio</h3>
                <div className="organization-page__form-grid">
                  <label className="organization-page__field">
                    <span>Nombre del espacio</span>
                    <input
                      ref={workspaceNameField}
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                      maxLength={255}
                      required
                      placeholder="Ej. Producto"
                    />
                  </label>
                  <OrganizationSelect
                    label="Modo de trabajo"
                    value={workspaceMode}
                    onChange={(value) =>
                      setWorkspaceMode(value as WorkspaceMode)
                    }
                    options={workspaceModes.map((option) => ({
                      ...option,
                      description:
                        option.value === "team"
                          ? "Coordina el trabajo compartido de un equipo."
                          : option.value === "institutional"
                            ? "Organiza el trabajo de una institución."
                            : "Mantén el trabajo en un espacio individual.",
                    }))}
                  />
                </div>
                {workspaceError ? (
                  <p
                    className="organization-page__feedback is-error"
                    role="alert"
                  >
                    {workspaceError}
                  </p>
                ) : null}
                <div className="organization-page__form-footer">
                  <p>El nuevo espacio pertenecerá a {organization.name}.</p>
                  <button
                    type="submit"
                    className="organization-page__primary"
                    disabled={workspaceBusy || !workspaceName.trim()}
                  >
                    {workspaceBusy ? "Creando…" : "Crear espacio"}
                  </button>
                </div>
              </form>
            ) : null}
            {!capabilities.canCreateWorkspace ? (
              <p className="organization-page__hint">
                No tienes permiso para crear espacios en esta organización.
              </p>
            ) : null}
          </section>
        ) : null}

        {activeSettingsTab === "people" ? (
          <section
            className="organization-page__card"
            id="organization-people"
            aria-labelledby="organization-people-title"
          >
            <div className="organization-page__card-heading">
              <span className="organization-page__card-icon">
                <UsersRound size={20} aria-hidden="true" />
              </span>
              <div>
                <p className="organization-page__eyebrow">COLABORACIÓN</p>
                <h2 id="organization-people-title">Personas y acceso</h2>
                <p>
                  Invita a personas para que colaboren en esta organización.
                </p>
              </div>
            </div>
            <div className="organization-page__people-grid">
              <form
                className="organization-page__form"
                onSubmit={sendInvitation}
              >
                <div className="organization-page__subheading">
                  <MailPlus size={18} aria-hidden="true" />
                  <h3>Invitar persona</h3>
                </div>
                <p>
                  Elige el acceso organizacional y los espacios. Las
                  responsabilidades en iniciativas y proyectos se asignan por
                  separado.
                </p>
                <div className="organization-page__invite-fields">
                  <label className="organization-page__field">
                    <span>Correo electrónico</span>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      required
                      placeholder="persona@equipo.com"
                      disabled={!capabilities.canInviteMembers || inviteBusy}
                    />
                  </label>
                  <OrganizationSelect
                    label="Rol en la organización"
                    value={inviteOrganizationRole}
                    onChange={(value) =>
                      setInviteOrganizationRole(value as "admin" | "member")
                    }
                    disabled={!capabilities.canInviteMembers || inviteBusy}
                    options={[
                      {
                        value: "member",
                        label: "Miembro",
                        description:
                          "Pertenece a la organización; el acceso a espacios se elige aparte.",
                      },
                      {
                        value: "admin",
                        label: "Administrador",
                        description:
                          "Puede gestionar la organización y sus espacios.",
                      },
                    ]}
                  />
                  <fieldset className="organization-page__invite-workspaces">
                    <legend>Espacios iniciales</legend>
                    <div>
                      {invitableWorkspaces.length ? (
                        invitableWorkspaces.map((workspace) => (
                          <label key={workspace.id}>
                            <input
                              type="checkbox"
                              checked={inviteWorkspaceIds.includes(
                                workspace.id,
                              )}
                              onChange={(event) =>
                                setInviteWorkspaceIds((current) =>
                                  event.target.checked
                                    ? [...current, workspace.id]
                                    : current.filter(
                                        (id) => id !== workspace.id,
                                      ),
                                )
                              }
                              disabled={
                                !capabilities.canInviteMembers || inviteBusy
                              }
                            />
                            <span>{workspace.name}</span>
                          </label>
                        ))
                      ) : (
                        <span>
                          Esta organización todavía no tiene espacios.
                        </span>
                      )}
                    </div>
                  </fieldset>
                  <OrganizationSelect
                    label="Rol en los espacios elegidos"
                    value={inviteWorkspaceRole}
                    onChange={(value) =>
                      setInviteWorkspaceRole(
                        value as "admin" | "member" | "viewer",
                      )
                    }
                    disabled={
                      !capabilities.canInviteMembers ||
                      inviteBusy ||
                      inviteWorkspaceIds.length === 0
                    }
                    options={[
                      {
                        value: "viewer",
                        label: "Lector",
                        description:
                          "Consulta los recursos autorizados del espacio.",
                      },
                      {
                        value: "member",
                        label: "Miembro",
                        description: "Colabora en el trabajo del espacio.",
                      },
                      {
                        value: "admin",
                        label: "Administrador",
                        description: "Gestiona el espacio y sus equipos.",
                      },
                    ]}
                  />
                </div>
                <p className="organization-page__invite-preview">
                  {inviteOrganizationRole === "admin"
                    ? "Administrará la organización y sus espacios."
                    : `Será miembro de la organización${inviteWorkspaceIds.length ? ` y tendrá acceso a ${inviteWorkspaceIds.length} ${inviteWorkspaceIds.length === 1 ? "espacio" : "espacios"}` : ", sin acceso inicial a espacios"}.`}
                  {inviteWorkspaceIds.length > 0 &&
                  inviteOrganizationRole === "member"
                    ? ` En ellos actuará como ${inviteWorkspaceRole === "admin" ? "administrador" : inviteWorkspaceRole === "viewer" ? "lector" : "miembro"}.`
                    : ""}
                </p>
                {inviteError ? (
                  <p
                    className="organization-page__feedback is-error"
                    role="alert"
                  >
                    {inviteError}
                  </p>
                ) : null}
                {inviteStatus ? (
                  <p
                    className="organization-page__feedback is-success"
                    role="status"
                  >
                    <Check size={16} aria-hidden="true" />
                    {inviteStatus}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className="organization-page__secondary"
                  disabled={
                    !capabilities.canInviteMembers ||
                    inviteBusy ||
                    !inviteEmail.trim()
                  }
                >
                  {inviteBusy ? "Creando…" : "Crear invitación"}
                </button>
                {!capabilities.canInviteMembers ? (
                  <small>No tienes permiso para invitar personas.</small>
                ) : null}
              </form>
              {capabilities.canManageOrganization ? (
                <OrganizationResponsibilitiesPanel
                  organization={organization}
                  workspaces={invitableWorkspaces}
                  initialWorkspaceId={workspaceId}
                  request={request}
                />
              ) : (
                <p className="organization-page__responsibility-access-note">
                  Las responsabilidades de iniciativas las asigna una persona
                  administradora de la organización.
                </p>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function OrganizationResponsibilitiesPanel({
  organization,
  workspaces,
  initialWorkspaceId,
  request,
}: {
  organization: OrganizationResponse;
  workspaces: WorkspaceResponse[];
  initialWorkspaceId: string;
  request: Request;
}) {
  const [profile, setProfile] =
    useState<OrganizationRoleProfileResponse | null>(null);
  const [data, setData] = useState<OrganizationResponsibilitiesResponse | null>(
    null,
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] =
    useState(initialWorkspaceId);
  const [selectedRole, setSelectedRole] = useState<
    InitiativeResponsibilityRole | ""
  >("");
  const [selectedActorId, setSelectedActorId] = useState("");
  const [selectedInitiativeId, setSelectedInitiativeId] = useState("");
  const [mentorValidUntil, setMentorValidUntil] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setSelectedWorkspaceId(initialWorkspaceId);
  }, [initialWorkspaceId, organization.id]);

  useEffect(() => {
    let active = true;
    setProfile(null);
    void request(`organizations/${organization.id}/role-profile`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error("No se pudo cargar el catálogo de roles.");
        const result =
          (await response.json()) as OrganizationRoleProfileResponse;
        if (active) {
          setProfile(result);
          const firstRole = result.initiativeResponsibilities.find(
            (role) => role.implementationStatus === "implemented",
          );
          setSelectedRole(
            (firstRole?.key as InitiativeResponsibilityRole | undefined) ?? "",
          );
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar el catálogo de roles.",
          );
      });
    return () => {
      active = false;
    };
  }, [organization.id, request]);

  useEffect(() => {
    let active = true;
    if (!selectedWorkspaceId) {
      setData({ members: [], initiatives: [], assignments: [] });
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setError("");
    void request(
      `organizations/${organization.id}/responsibilities?workspaceId=${selectedWorkspaceId}`,
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error("No se pudieron cargar las responsabilidades.");
        const result =
          (await response.json()) as OrganizationResponsibilitiesResponse;
        if (!active) return;
        setData(result);
        setSelectedInitiativeId((current) =>
          result.initiatives.some((initiative) => initiative.id === current)
            ? current
            : (result.initiatives[0]?.id ?? ""),
        );
        setSelectedActorId((current) =>
          result.members.some((member) => member.actorId === current)
            ? current
            : (result.members[0]?.actorId ?? ""),
        );
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudieron cargar las responsabilidades.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organization.id, request, selectedWorkspaceId, reloadKey]);

  const roles =
    profile?.initiativeResponsibilities.filter(
      (role) => role.implementationStatus === "implemented",
    ) ?? [];
  const roleNames = new Map(roles.map((role) => [role.key, role.label]));

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedWorkspaceId ||
      !selectedActorId ||
      !selectedRole ||
      (selectedRole === "initiative_mentor" &&
        (!selectedInitiativeId || !mentorValidUntil))
    )
      return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await request(`organizations/${organization.id}/responsibilities`, {
        method: "POST",
        body: JSON.stringify({
          workspaceId: selectedWorkspaceId,
          actorId: selectedActorId,
          roleKey: selectedRole,
          ...(selectedRole === "initiative_mentor"
            ? {
                initiativeId: selectedInitiativeId,
                validUntil: mentorValidUntil,
              }
            : {}),
        }),
      });
      setFeedback("Responsabilidad asignada en este espacio.");
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo asignar la responsabilidad.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(assignmentId: string) {
    setRemovingId(assignmentId);
    setError("");
    setFeedback("");
    try {
      await request(
        `organizations/${organization.id}/responsibilities/${assignmentId}`,
        { method: "DELETE" },
      );
      setFeedback("Responsabilidad revocada.");
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo revocar la responsabilidad.",
      );
    } finally {
      setRemovingId("");
    }
  }

  return (
    <section
      className="organization-page__responsibility-panel"
      aria-labelledby="organization-responsibilities-title"
      aria-busy={loading}
    >
      <div className="organization-page__responsibility-heading">
        <span className="organization-page__card-icon">
          <ShieldCheck size={19} aria-hidden="true" />
        </span>
        <div>
          <p className="organization-page__eyebrow">ROLES FUNCIONALES</p>
          <h3 id="organization-responsibilities-title">
            Responsabilidades de iniciativas
          </h3>
          <p>
            Los roles se asignan por espacio a personas con acceso activo. La
            mentoría además se limita a una iniciativa y a un plazo.
          </p>
        </div>
      </div>

      {!workspaces.length ? (
        <p className="organization-page__hint">
          Crea un espacio de trabajo para poder asignar responsabilidades.
        </p>
      ) : (
        <>
          <div className="organization-page__responsibility-grid">
            <OrganizationSelect
              label="Espacio de trabajo"
              value={selectedWorkspaceId}
              onChange={setSelectedWorkspaceId}
              options={workspaces.map((workspace) => ({
                value: workspace.id,
                label: workspace.name,
                description: `${workspaceModeLabel(workspace.mode)} · Espacio activo`,
              }))}
            />
            {roles.length ? (
              <form
                className="organization-page__responsibility-form"
                onSubmit={assign}
              >
                <OrganizationSelect
                  label="Persona"
                  value={selectedActorId}
                  onChange={setSelectedActorId}
                  disabled={loading || !data?.members.length || busy}
                  required
                  placeholder="No hay personas con acceso al espacio"
                  options={
                    data?.members.map((member) => ({
                      value: member.actorId,
                      label: member.actorName,
                      description:
                        member.actorEmail ?? "Miembro de la organización",
                    })) ?? []
                  }
                />
                <OrganizationSelect
                  label="Responsabilidad"
                  value={selectedRole}
                  onChange={(value) =>
                    setSelectedRole(value as InitiativeResponsibilityRole)
                  }
                  disabled={busy}
                  required
                  helperText={
                    roles.find((role) => role.key === selectedRole)
                      ?.description ?? ""
                  }
                  options={roles.map((role) => ({
                    value: role.key,
                    label: role.label,
                    description: role.description,
                  }))}
                />
                {selectedRole === "initiative_mentor" ? (
                  <>
                    <OrganizationSelect
                      label="Iniciativa asignada"
                      value={selectedInitiativeId}
                      onChange={setSelectedInitiativeId}
                      disabled={loading || !data?.initiatives.length || busy}
                      required
                      placeholder="No hay iniciativas disponibles para mentoría"
                      options={
                        data?.initiatives.map((initiative) => ({
                          value: initiative.id,
                          label: initiative.title,
                          description: initiative.status,
                        })) ?? []
                      }
                    />
                    <label className="organization-page__field">
                      <span>Vigente hasta</span>
                      <input
                        type="date"
                        value={mentorValidUntil}
                        min={new Date(Date.now() + 86_400_000)
                          .toISOString()
                          .slice(0, 10)}
                        onChange={(event) =>
                          setMentorValidUntil(event.target.value)
                        }
                        required
                      />
                      <small>La mentoría vence como máximo en un año.</small>
                    </label>
                  </>
                ) : null}
                <button
                  type="submit"
                  className="organization-page__primary"
                  disabled={
                    busy ||
                    loading ||
                    !data?.members.length ||
                    !selectedActorId ||
                    (selectedRole === "initiative_mentor" &&
                      (!data?.initiatives.length || !mentorValidUntil))
                  }
                >
                  {busy ? "Asignando…" : "Asignar rol"}
                </button>
              </form>
            ) : (
              <p className="organization-page__responsibility-empty">
                {profile
                  ? "Este tipo de organización no contempla roles funcionales de iniciativa para asignar."
                  : "Cargando roles disponibles…"}
              </p>
            )}
          </div>

          {error ? (
            <p className="organization-page__feedback is-error" role="alert">
              {error}
            </p>
          ) : null}
          {feedback ? (
            <p className="organization-page__feedback is-success" role="status">
              <Check size={16} aria-hidden="true" /> {feedback}
            </p>
          ) : null}

          <div className="organization-page__responsibility-list">
            <div className="organization-page__responsibility-list-heading">
              <h4>
                Asignaciones en{" "}
                {
                  workspaces.find((item) => item.id === selectedWorkspaceId)
                    ?.name
                }
              </h4>
              <span>{data?.assignments.length ?? 0}</span>
            </div>
            {loading ? (
              <p className="organization-page__hint" role="status">
                Cargando asignaciones…
              </p>
            ) : data?.assignments.length ? (
              <ul>
                {data.assignments.map((assignment) => (
                  <li key={assignment.id}>
                    <div
                      className="organization-page__responsibility-avatar"
                      aria-hidden="true"
                    >
                      {assignment.actorName
                        .slice(0, 1)
                        .toLocaleUpperCase("es-CL")}
                    </div>
                    <div className="organization-page__responsibility-person">
                      <strong>{assignment.actorName}</strong>
                      <small>
                        {assignment.actorEmail ?? "Miembro de la organización"}
                      </small>
                    </div>
                    <span className="organization-page__responsibility-badge">
                      {roleNames.get(assignment.roleKey) ?? assignment.roleKey}
                      {assignment.initiativeTitle
                        ? ` · ${assignment.initiativeTitle}`
                        : ""}
                      {assignment.validUntil
                        ? ` · hasta ${new Date(assignment.validUntil).toLocaleDateString("es-CL")}`
                        : ""}
                    </span>
                    <button
                      type="button"
                      className="organization-page__responsibility-remove"
                      onClick={() => void revoke(assignment.id)}
                      disabled={Boolean(removingId)}
                      aria-label={`Revocar ${roleNames.get(assignment.roleKey) ?? "rol"} de ${assignment.actorName}`}
                    >
                      {removingId === assignment.id ? "Revocando…" : "Revocar"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="organization-page__responsibility-empty">
                Todavía no hay responsabilidades asignadas en este espacio.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function NewOrganization({
  request,
  onCancel,
  onCreated,
}: {
  request: Request;
  onCancel: () => void;
  onCreated: (
    organization: OrganizationResponse,
    workspace: WorkspaceResponse,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<OrganizationKind>("business");
  const [workspaceName, setWorkspaceName] = useState("");
  const [mode, setMode] = useState<WorkspaceMode>("team");
  const [createdOrganization, setCreatedOrganization] =
    useState<OrganizationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    let organization = createdOrganization;
    try {
      if (!organization) {
        const response = await request("organizations", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            organizationType: kind,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            locale: navigator.language || "es-CL",
            policy: { dataResidencyRegion: "local", retentionDays: 365 },
          }),
        });
        organization = (await response.json()) as OrganizationResponse;
        setCreatedOrganization(organization);
      }
      const response = await request("workspaces", {
        method: "POST",
        body: JSON.stringify({
          organizationId: organization.id,
          name: workspaceName.trim(),
          mode,
        }),
      });
      onCreated(organization, (await response.json()) as WorkspaceResponse);
    } catch (caught) {
      setError(
        errorMessage(
          caught,
          organization
            ? "La organización ya existe; no se pudo crear su primer espacio. Inténtalo de nuevo."
            : "No se pudo crear la organización.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="organization-page organization-page--new">
      <button
        type="button"
        className="organization-page__back"
        onClick={onCancel}
      >
        <ArrowLeft size={17} aria-hidden="true" /> Volver a organización y
        espacios
      </button>
      <header className="organization-page__heading">
        <div>
          <p className="organization-page__eyebrow">UN NUEVO COMIENZO</p>
          <h1>Nueva organización</h1>
          <p>
            Define el equipo y su primer espacio. Luego podrás invitar personas
            y ajustar su política de datos.
          </p>
        </div>
      </header>
      <form
        className="organization-page__card organization-page__form"
        onSubmit={submit}
      >
        <div className="organization-page__card-heading">
          <span className="organization-page__card-icon">
            <Building2 size={20} aria-hidden="true" />
          </span>
          <div>
            <p className="organization-page__eyebrow">01 · IDENTIDAD</p>
            <h2>Tu organización</h2>
            <p>
              Este nombre identificará al equipo al cambiar de lugar de trabajo.
            </p>
          </div>
        </div>
        <div className="organization-page__form-grid">
          <label className="organization-page__field">
            <span>Nombre de la organización</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={255}
              placeholder="Ej. Equipo Atlas"
              required
              autoFocus
              disabled={busy || Boolean(createdOrganization)}
            />
          </label>
          <OrganizationSelect
            label="Tipo de organización"
            value={kind}
            onChange={(value) => setKind(value as OrganizationKind)}
            disabled={busy || Boolean(createdOrganization)}
            options={organizationKinds.map((option) => ({
              ...option,
              description:
                option.value === "institutional"
                  ? "Configura roles y decisiones de colaboración institucional."
                  : option.value === "personal"
                    ? "Organiza ideas y proyectos en un espacio individual."
                    : "Coordina el trabajo y las decisiones de un equipo.",
            }))}
          />
        </div>
        <OrganizationRoleProfilePreview
          organizationType={kind}
          request={request}
        />
        <div className="organization-page__card-heading organization-page__card-heading--divider">
          <span className="organization-page__card-icon">
            <Layers3 size={20} aria-hidden="true" />
          </span>
          <div>
            <p className="organization-page__eyebrow">02 · PRIMER ESPACIO</p>
            <h2>Donde comenzará el trabajo</h2>
            <p>
              Podrás crear más espacios dentro de esta organización después.
            </p>
          </div>
        </div>
        <div className="organization-page__form-grid">
          <label className="organization-page__field">
            <span>Nombre del espacio</span>
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              maxLength={255}
              placeholder="Ej. Producto"
              required
              disabled={busy}
            />
          </label>
          <OrganizationSelect
            label="Modo de trabajo"
            value={mode}
            onChange={(value) => setMode(value as WorkspaceMode)}
            disabled={busy}
            options={workspaceModes.map((option) => ({
              ...option,
              description:
                option.value === "team"
                  ? "Coordina el trabajo compartido de un equipo."
                  : option.value === "institutional"
                    ? "Organiza el trabajo de una institución."
                    : "Mantén el trabajo en un espacio individual.",
            }))}
          />
        </div>
        <div className="organization-page__default-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <p>
            La organización comenzará con región <strong>local</strong> y
            retención de <strong>365 días</strong>. Podrás ajustar ambos valores
            en su configuración.
          </p>
        </div>
        {error ? (
          <p className="organization-page__feedback is-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="organization-page__form-footer">
          <p>
            {createdOrganization
              ? "La organización ya se creó; solo falta preparar su primer espacio."
              : "Crearás una organización nueva, separada de la que usas ahora."}
          </p>
          <button
            className="organization-page__primary"
            type="submit"
            disabled={busy || !name.trim() || !workspaceName.trim()}
          >
            {busy
              ? "Creando…"
              : createdOrganization
                ? "Reintentar crear espacio"
                : "Crear organización y espacio"}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}
