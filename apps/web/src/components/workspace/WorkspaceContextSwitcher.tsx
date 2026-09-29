"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  KeyRound,
  Layers3,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type {
  OrganizationResponse,
  WorkspaceResponse,
} from "@aether/contracts";

type WorkspaceContextSwitcherProps = {
  organizations: OrganizationResponse[];
  workspaces: WorkspaceResponse[];
  workspacesLoaded: boolean;
  organizationId: string;
  workspaceId: string;
  refreshing: boolean;
  canRefresh: boolean;
  onOrganizationChange: (id: string) => void;
  onWorkspaceChange: (id: string) => void;
  onNewOrganization: () => void;
  onAcceptInvitation: (token: string) => Promise<void>;
  onRefresh: () => void;
  onOpenSettings: () => void;
};

type SwitcherStep = "workspaces" | "organizations" | "invitation";

export function WorkspaceContextSwitcher({
  organizations,
  workspaces,
  workspacesLoaded,
  organizationId,
  workspaceId,
  refreshing,
  canRefresh,
  onOrganizationChange,
  onWorkspaceChange,
  onNewOrganization,
  onAcceptInvitation,
  onRefresh,
  onOpenSettings,
}: WorkspaceContextSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<SwitcherStep>("workspaces");
  const [invitationToken, setInvitationToken] = useState("");
  const [invitationBusy, setInvitationBusy] = useState(false);
  const [invitationError, setInvitationError] = useState("");
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousPanelHeight = useRef<number | null>(null);
  const heightAnimation = useRef<Animation | null>(null);
  const organizationName =
    organizations.find((item) => item.id === organizationId)?.name ??
    "Seleccionar organización";
  const workspaceName =
    workspaces.find((item) => item.id === workspaceId)?.name ??
    "Seleccionar espacio";

  useEffect(() => {
    if (!open) return;
    stepHeadingRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, step]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const fromHeight = previousPanelHeight.current;
    previousPanelHeight.current = null;
    if (!open || !panel || fromHeight === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const toHeight = panel.offsetHeight;
    if (Math.abs(toHeight - fromHeight) < 1) return;
    const animation = panel.animate(
      [{ height: `${fromHeight}px` }, { height: `${toHeight}px` }],
      { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    heightAnimation.current = animation;
    return () => animation.cancel();
  }, [open, step]);

  function showStep(next: SwitcherStep) {
    if (next === step) return;
    previousPanelHeight.current = panelRef.current?.offsetHeight ?? null;
    heightAnimation.current?.cancel();
    setStep(next);
  }

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = invitationToken.trim();
    if (!token || invitationBusy) return;
    setInvitationBusy(true);
    setInvitationError("");
    try {
      await onAcceptInvitation(token);
      setInvitationToken("");
      close();
    } catch (error) {
      setInvitationError(
        error instanceof Error
          ? error.message
          : "No se pudo aceptar la invitación. Revisa el código e inténtalo de nuevo.",
      );
    } finally {
      setInvitationBusy(false);
    }
  }

  return (
    <div className="workspace-context" ref={rootRef}>
      <button
        ref={triggerRef}
        className="workspace-context__trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Cambiar organización y espacio de trabajo: ${organizationName}, ${workspaceName}`}
        onClick={() => {
          setStep("workspaces");
          setOpen((current) => !current);
        }}
      >
        <span className="workspace-context__icon" aria-hidden="true">
          <Building2 size={18} strokeWidth={1.8} />
        </span>
        <span className="workspace-context__path">
          <strong title={workspaceName}>{workspaceName}</strong>
          <span title={organizationName}>{organizationName}</span>
        </span>
        <ChevronDown
          className="workspace-context__chevron"
          size={17}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="workspace-context__panel"
          id={panelId}
          data-step={step}
        >
          <header className="workspace-context__panel-head">
            <div className="workspace-context__panel-title">
              <span>CAMBIAR DE LUGAR</span>
              <h2>Tu espacio de trabajo</h2>
            </div>
          </header>

          {step === "workspaces" ? (
            <section
              key="workspaces"
              className="workspace-context__step"
              aria-label="Espacios"
            >
              <div className="workspace-context__step-head">
                <div>
                  <span className="workspace-context__eyebrow">
                    ORGANIZACIÓN
                  </span>
                  <h3 ref={stepHeadingRef} tabIndex={-1}>
                    {organizationName}
                  </h3>
                </div>
                <button
                  type="button"
                  className="workspace-context__change-organization"
                  aria-label="Cambiar organización"
                  onClick={() => showStep("organizations")}
                >
                  Cambiar <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="workspace-context__options" aria-live="polite">
                {!workspacesLoaded ? (
                  <p className="workspace-context__empty">Cargando espacios…</p>
                ) : workspaces.length ? (
                  workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      aria-pressed={workspace.id === workspaceId}
                      onClick={() => {
                        onWorkspaceChange(workspace.id);
                        close();
                      }}
                    >
                      <span
                        className="workspace-context__option-icon"
                        aria-hidden="true"
                      >
                        <Layers3 size={18} />
                      </span>
                      <span className="workspace-context__option-copy">
                        <strong>{workspace.name}</strong>
                        {workspace.id === workspaceId ? (
                          <small>Espacio actual</small>
                        ) : null}
                      </span>
                      {workspace.id === workspaceId ? (
                        <Check size={17} aria-hidden="true" />
                      ) : (
                        <ArrowRight size={16} aria-hidden="true" />
                      )}
                    </button>
                  ))
                ) : (
                  <p className="workspace-context__empty">
                    Esta organización aún no tiene espacios.
                  </p>
                )}
              </div>
            </section>
          ) : step === "organizations" ? (
            <section
              key="organizations"
              className="workspace-context__step"
              aria-label="Organizaciones"
            >
              <div className="workspace-context__step-head">
                <button
                  type="button"
                  className="workspace-context__back"
                  aria-label="Volver a espacios"
                  onClick={() => showStep("workspaces")}
                >
                  <ArrowLeft size={16} aria-hidden="true" /> Volver
                </button>
                <h3 ref={stepHeadingRef} tabIndex={-1}>
                  Organizaciones
                </h3>
              </div>
              <div className="workspace-context__options">
                {organizations.length ? (
                  organizations.map((organization) => (
                    <button
                      key={organization.id}
                      type="button"
                      aria-pressed={organization.id === organizationId}
                      onClick={() => {
                        if (organization.id !== organizationId)
                          onOrganizationChange(organization.id);
                        showStep("workspaces");
                      }}
                    >
                      <span
                        className="workspace-context__option-icon"
                        aria-hidden="true"
                      >
                        <Building2 size={18} />
                      </span>
                      <span className="workspace-context__option-copy">
                        <strong>{organization.name}</strong>
                        {organization.id === organizationId ? (
                          <small>Organización actual</small>
                        ) : null}
                      </span>
                      {organization.id === organizationId ? (
                        <Check size={17} aria-hidden="true" />
                      ) : (
                        <ArrowRight size={16} aria-hidden="true" />
                      )}
                    </button>
                  ))
                ) : (
                  <p className="workspace-context__empty">
                    No hay organizaciones disponibles.
                  </p>
                )}
              </div>
              <div className="workspace-context__organization-actions">
                <button
                  type="button"
                  className="workspace-context__new-organization"
                  onClick={() => {
                    setOpen(false);
                    onNewOrganization();
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  Nueva organización
                </button>
                <button
                  type="button"
                  className="workspace-context__accept-invitation"
                  onClick={() => {
                    setInvitationError("");
                    showStep("invitation");
                  }}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  Aceptar invitación
                </button>
              </div>
            </section>
          ) : (
            <section
              key="invitation"
              className="workspace-context__step"
              aria-label="Aceptar invitación"
            >
              <div className="workspace-context__step-head">
                <button
                  type="button"
                  className="workspace-context__back"
                  aria-label="Volver a organizaciones"
                  onClick={() => showStep("organizations")}
                  disabled={invitationBusy}
                >
                  <ArrowLeft size={16} aria-hidden="true" /> Volver
                </button>
                <h3 ref={stepHeadingRef} tabIndex={-1}>
                  Aceptar invitación
                </h3>
              </div>
              <form
                className="workspace-context__invitation-form"
                onSubmit={acceptInvitation}
              >
                <p>
                  Pega el código para unirte a la organización y a los espacios
                  incluidos en la invitación.
                </p>
                <label>
                  <span>Código de invitación</span>
                  <input
                    value={invitationToken}
                    onChange={(event) => setInvitationToken(event.target.value)}
                    minLength={32}
                    maxLength={255}
                    required
                    autoFocus
                    disabled={invitationBusy}
                    placeholder="Pega aquí tu código"
                  />
                </label>
                {invitationError ? (
                  <p
                    className="workspace-context__invitation-error"
                    role="alert"
                  >
                    {invitationError}
                  </p>
                ) : null}
                <button
                  className="workspace-context__invitation-submit"
                  type="submit"
                  disabled={
                    invitationBusy || invitationToken.trim().length < 32
                  }
                >
                  {invitationBusy ? "Uniéndote…" : "Unirme a la organización"}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </form>
            </section>
          )}

          <footer className="workspace-context__panel-footer">
            <button
              className="workspace-context__settings"
              type="button"
              aria-label="Configuración del espacio"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Settings2 size={16} aria-hidden="true" /> Configuración
            </button>
            <button
              className="workspace-context__refresh"
              type="button"
              aria-label="Actualizar espacio"
              onClick={onRefresh}
              disabled={!canRefresh || refreshing}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "is-spinning" : ""}
                aria-hidden="true"
              />
              {refreshing ? "Actualizando…" : "Actualizar"}
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
