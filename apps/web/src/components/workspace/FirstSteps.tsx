"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Building2, KeyRound, Layers3, LogOut } from "lucide-react";
import type {
  AccessCapabilitiesResponse,
  OrganizationResponse,
  WorkspaceResponse,
} from "@aether/contracts";
import { Brand } from "../layout/Brand";

type FirstStepsProps = {
  organization: OrganizationResponse | null;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  onOrganizationReady: (organizationId?: string) => Promise<void>;
  onWorkspaceReady: (workspace: WorkspaceResponse) => void;
  onLogout: () => Promise<void>;
};

export function FirstSteps({
  organization,
  request,
  onOrganizationReady,
  onWorkspaceReady,
  onLogout,
}: FirstStepsProps) {
  const [choice, setChoice] = useState<"create" | "join" | null>(null);
  const [name, setName] = useState("");
  const [organizationType, setOrganizationType] = useState<
    "personal" | "business" | "institutional"
  >("business");
  const [token, setToken] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canCreateWorkspace, setCanCreateWorkspace] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    if (!organization) return;
    setCanCreateWorkspace(null);
    let active = true;
    void request(`organizations/${organization.id}/capabilities`)
      .then(
        (response) => response.json() as Promise<AccessCapabilitiesResponse>,
      )
      .then((capabilities) => {
        if (active) setCanCreateWorkspace(capabilities.canCreateWorkspace);
      })
      .catch(() => {
        if (active) setCanCreateWorkspace(false);
      });
    return () => {
      active = false;
    };
  }, [organization, request]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (choice === "join") {
        const response = await request("invitations/accept", {
          method: "POST",
          body: JSON.stringify({ token: token.trim() }),
        });
        const invitation = (await response.json()) as {
          organizationId: string;
        };
        await onOrganizationReady(invitation.organizationId);
      } else if (organization) {
        const response = await request("workspaces", {
          method: "POST",
          body: JSON.stringify({
            organizationId: organization.id,
            name: workspaceName.trim(),
            mode: "team",
          }),
        });
        onWorkspaceReady((await response.json()) as WorkspaceResponse);
      } else {
        await request("organizations", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            organizationType,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            locale: navigator.language || "es-CL",
            policy: { dataResidencyRegion: "local", retentionDays: 365 },
          }),
        });
        await onOrganizationReady();
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo continuar. Inténtalo de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="first-steps">
      <header className="first-steps__header">
        <Brand />
        <button type="button" onClick={() => void onLogout()}>
          <LogOut size={16} aria-hidden="true" /> Cerrar sesión
        </button>
      </header>
      <section
        className="first-steps__content"
        aria-labelledby="first-steps-title"
      >
        <p className="first-steps__eyebrow">TU ESPACIO EN AETHER / 01</p>
        <h1 id="first-steps-title">
          {organization
            ? "Dale forma a tu primer espacio."
            : "Empecemos por lo que te une."}
        </h1>
        <p className="first-steps__intro">
          {organization
            ? `Ya estás en ${organization.name}. Prepara un espacio para organizar el trabajo de tu equipo.`
            : "Tu cuenta ya está lista. Elige cómo quieres comenzar; tu identidad seguirá siendo la misma en cada equipo."}
        </p>

        {!organization ? (
          <div className="first-steps__options">
            <button
              type="button"
              className={
                choice === "create"
                  ? "first-steps__option is-selected"
                  : "first-steps__option"
              }
              aria-pressed={choice === "create"}
              onClick={() => {
                setChoice("create");
                setError("");
              }}
            >
              <Building2 size={25} strokeWidth={1.6} aria-hidden="true" />
              <strong>Crear organización</strong>
              <span>
                Comienza un nuevo espacio y define cómo colaborará tu equipo.
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={
                choice === "join"
                  ? "first-steps__option is-selected"
                  : "first-steps__option"
              }
              aria-pressed={choice === "join"}
              onClick={() => {
                setChoice("join");
                setError("");
              }}
            >
              <KeyRound size={25} strokeWidth={1.6} aria-hidden="true" />
              <strong>Unirme con invitación</strong>
              <span>Accede a una organización que ya trabaja con AETHER.</span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {organization && canCreateWorkspace === false ? (
          <p className="first-steps__waiting" role="status">
            Tu cuenta ya pertenece a {organization.name}, pero todavía no tienes
            un espacio asignado. Pide a quien administra la organización que te
            dé acceso a uno.
          </p>
        ) : null}

        {organization ? (
          <button
            className="first-steps__alternate"
            type="button"
            onClick={() => {
              setChoice(choice === "join" ? null : "join");
              setError("");
            }}
          >
            {choice === "join"
              ? "Volver a mi organización"
              : "Tengo una invitación para otro equipo"}
          </button>
        ) : null}

        {choice === "join" ||
        (organization && canCreateWorkspace === true) ||
        (!organization && choice === "create") ? (
          <form className="first-steps__form" onSubmit={submit}>
            <label htmlFor="first-steps-field">
              {choice === "join"
                ? "Código de invitación"
                : organization
                  ? "Nombre del espacio de trabajo"
                  : "Nombre de la organización"}
            </label>
            <input
              id="first-steps-field"
              value={
                choice === "join" ? token : organization ? workspaceName : name
              }
              onChange={(event) =>
                choice === "join"
                  ? setToken(event.target.value)
                  : organization
                    ? setWorkspaceName(event.target.value)
                    : setName(event.target.value)
              }
              placeholder={
                choice === "join"
                  ? "Pega el código recibido"
                  : organization
                    ? "Por ejemplo, Equipo central"
                    : "Por ejemplo, Equipo Aurora"
              }
              autoComplete="off"
              minLength={choice === "join" ? 10 : 2}
              required
            />
            {choice === "create" && !organization ? (
              <>
                <label htmlFor="first-steps-type">Tipo de organización</label>
                <select
                  id="first-steps-type"
                  value={organizationType}
                  onChange={(event) =>
                    setOrganizationType(
                      event.target.value as typeof organizationType,
                    )
                  }
                >
                  <option value="business">Equipo o empresa</option>
                  <option value="institutional">Institución</option>
                  <option value="personal">Uso personal</option>
                </select>
                <p>
                  En esta instalación local, los datos permanecen en el entorno
                  de desarrollo.
                </p>
              </>
            ) : null}
            {choice === "join" ? (
              <p>
                La invitación debe corresponder al correo con el que creaste tu
                cuenta.
              </p>
            ) : null}
            {error ? (
              <p className="first-steps__error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="first-steps__submit"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "Preparando tu espacio…"
                : choice === "join"
                  ? "Aceptar invitación"
                  : organization
                    ? "Crear espacio"
                    : "Crear organización"}
              <ArrowRight size={19} aria-hidden="true" />
            </button>
          </form>
        ) : null}
      </section>
      <footer className="first-steps__footer">
        <Layers3 size={17} aria-hidden="true" />
        Tu cuenta es personal. El acceso a cada organización se gestiona por
        separado.
      </footer>
    </main>
  );
}
