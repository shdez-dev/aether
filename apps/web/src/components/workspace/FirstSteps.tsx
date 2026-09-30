"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  KeyRound,
  Layers3,
  LogOut,
} from "lucide-react";
import type {
  AccessCapabilitiesResponse,
  OrganizationResponse,
  WorkspaceResponse,
} from "@aether/contracts";
import { Brand } from "../layout/Brand";
import { OrganizationRoleProfilePreview } from "./OrganizationRoleProfilePreview";

type FirstStepsProps = {
  organization: OrganizationResponse | null;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  onOrganizationReady: (organizationId?: string) => Promise<void>;
  onWorkspaceReady: (workspace: WorkspaceResponse) => void;
  onLogout: () => void;
};

type OrganizationType = "personal" | "business" | "institutional";

const organizationTypes: {
  value: OrganizationType;
  label: string;
  description: string;
}[] = [
  {
    value: "business",
    label: "Equipo o empresa",
    description: "Coordina el trabajo y las decisiones de tu equipo.",
  },
  {
    value: "institutional",
    label: "Institución",
    description: "Da estructura a la colaboración institucional.",
  },
  {
    value: "personal",
    label: "Uso personal",
    description: "Organiza tus iniciativas en un espacio individual.",
  },
];

function OrganizationTypePicker({
  value,
  onChange,
}: {
  value: OrganizationType;
  onChange: (value: OrganizationType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    organizationTypes.findIndex((option) => option.value === value),
  );
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedIndex = organizationTypes.findIndex(
    (option) => option.value === value,
  );
  const selectedOption =
    organizationTypes[selectedIndex] ?? organizationTypes[0];

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = open
        ? (activeIndex + direction + organizationTypes.length) %
          organizationTypes.length
        : (selectedIndex + direction + organizationTypes.length) %
          organizationTypes.length;
      setActiveIndex(nextIndex);
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : organizationTypes.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const activeOption = organizationTypes[activeIndex];
      if (activeOption) onChange(activeOption.value);
      setOpen(false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  if (!selectedOption) return null;

  return (
    <div
      className={`first-steps__picker${open ? " is-open" : ""}`}
      ref={pickerRef}
    >
      <button
        id="first-steps-type"
        className="first-steps__picker-trigger"
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "first-steps-type-options" : undefined}
        aria-activedescendant={
          open ? `first-steps-type-option-${activeIndex}` : undefined
        }
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget))
            setOpen(false);
        }}
      >
        <span className="first-steps__picker-label" aria-live="polite">
          <AnimatePresence initial={false} mode="sync">
            <motion.span
              key={selectedOption.value}
              initial={{ opacity: 0, filter: "blur(2px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(1px)" }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {selectedOption.label}
            </motion.span>
          </AnimatePresence>
        </span>
        <ChevronDown
          size={17}
          strokeWidth={1.8}
          aria-hidden="true"
          className="first-steps__picker-chevron"
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="organization-type-options"
            id="first-steps-type-options"
            className="first-steps__picker-menu"
            role="listbox"
            aria-labelledby="first-steps-type"
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="first-steps__picker-caption">ELIGE TU ESPACIO</p>
            {organizationTypes.map((option, index) => {
              const selected = option.value === value;
              return (
                <div
                  key={option.value}
                  id={`first-steps-type-option-${index}`}
                  className="first-steps__picker-option"
                  role="option"
                  aria-selected={selected}
                  data-active={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option.value);
                    setActiveIndex(index);
                    setOpen(false);
                  }}
                >
                  <span className="first-steps__picker-option-copy">
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </span>
                  <Check
                    size={17}
                    aria-hidden="true"
                    className="first-steps__picker-check"
                  />
                </div>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function FirstSteps({
  organization,
  request,
  onOrganizationReady,
  onWorkspaceReady,
  onLogout,
}: FirstStepsProps) {
  const [choice, setChoice] = useState<"create" | "join" | null>(null);
  const [name, setName] = useState("");
  const [organizationType, setOrganizationType] =
    useState<OrganizationType>("business");
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

  const title = organization
    ? "Dale forma a tu primer espacio."
    : choice === "create"
      ? "Crea tu organización."
      : choice === "join"
        ? "Tu equipo ya te espera."
        : "Empecemos por lo que te une.";
  const intro = organization
    ? `Ya estás en ${organization.name}. Prepara un espacio para organizar el trabajo de tu equipo.`
    : choice === "create"
      ? "Elige un nombre y un tipo de colaboración. Podrás invitar a tu equipo después."
      : choice === "join"
        ? "Ingresa el código de invitación que recibiste para conectar tu cuenta con el equipo."
        : "Tu cuenta ya está lista. Elige cómo quieres comenzar; tu identidad seguirá siendo la misma en cada equipo.";

  const isCreatingOrganization = choice === "create" && !organization;
  const submitButton = (
    <button className="first-steps__submit" type="submit" disabled={busy}>
      {busy
        ? "Preparando tu espacio…"
        : choice === "join"
          ? "Aceptar invitación"
          : organization
            ? "Crear espacio"
            : "Crear organización"}
      <ArrowRight size={19} aria-hidden="true" />
    </button>
  );
  const form = (
    <form
      className={`first-steps__form${isCreatingOrganization ? " first-steps__form--organization" : ""}`}
      onSubmit={submit}
    >
      {isCreatingOrganization ? (
        <>
          <div className="first-steps__organization-fields">
            <div className="first-steps__field">
              <label htmlFor="first-steps-field">
                Nombre de la organización
              </label>
              <input
                id="first-steps-field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Por ejemplo, Equipo Aurora"
                autoComplete="organization"
                autoFocus
                minLength={2}
                required
              />
            </div>
            <div className="first-steps__field">
              <label htmlFor="first-steps-type">Tipo de organización</label>
              <OrganizationTypePicker
                value={organizationType}
                onChange={setOrganizationType}
              />
            </div>
          </div>
          <OrganizationRoleProfilePreview
            organizationType={organizationType}
            request={request}
            compact
          />
        </>
      ) : (
        <>
          <label htmlFor="first-steps-field">
            {choice === "join"
              ? "Código de invitación"
              : "Nombre del espacio de trabajo"}
          </label>
          <input
            id="first-steps-field"
            value={choice === "join" ? token : workspaceName}
            onChange={(event) =>
              choice === "join"
                ? setToken(event.target.value)
                : setWorkspaceName(event.target.value)
            }
            placeholder={
              choice === "join"
                ? "Pega el código recibido"
                : "Por ejemplo, Equipo central"
            }
            autoComplete="off"
            autoFocus={!organization}
            minLength={choice === "join" ? 10 : 2}
            required
          />
          {choice === "join" ? (
            <p>
              La invitación debe corresponder al correo con el que creaste tu
              cuenta.
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p className="first-steps__error" role="alert">
          {error}
        </p>
      ) : null}
      {isCreatingOrganization ? (
        <div className="first-steps__organization-footer">
          <p className="first-steps__organization-note">
            Los datos permanecerán en esta instalación de desarrollo.
          </p>
          {submitButton}
        </div>
      ) : (
        submitButton
      )}
    </form>
  );

  return (
    <MotionConfig reducedMotion="user">
      <main
        className={`first-steps${isCreatingOrganization ? " first-steps--organization-create" : ""}`}
      >
        <header className="first-steps__header">
          <Brand />
          <button type="button" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" /> Cerrar sesión
          </button>
        </header>
        <section
          className="first-steps__content"
          aria-labelledby="first-steps-title"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${organization?.id ?? "new"}-${choice ?? "start"}`}
              className="first-steps__heading"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
            >
              <p className="first-steps__eyebrow">
                TU ESPACIO EN AETHER / {choice ? "02" : "01"}
              </p>
              <h1 id="first-steps-title">{title}</h1>
              <p className="first-steps__intro">{intro}</p>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            {!organization && !choice ? (
              <motion.div
                key="choices"
                className="first-steps__stage"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10, scale: 0.99 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
              >
                <div className="first-steps__options">
                  <button
                    type="button"
                    className="first-steps__option"
                    onClick={() => {
                      setChoice("create");
                      setError("");
                    }}
                  >
                    <Building2 size={25} strokeWidth={1.6} aria-hidden="true" />
                    <strong>Crear organización</strong>
                    <span>
                      Comienza un nuevo espacio y define cómo colaborará tu
                      equipo.
                    </span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="first-steps__option"
                    onClick={() => {
                      setChoice("join");
                      setError("");
                    }}
                  >
                    <KeyRound size={25} strokeWidth={1.6} aria-hidden="true" />
                    <strong>Unirme con invitación</strong>
                    <span>
                      Accede a una organización que ya trabaja con AETHER.
                    </span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </motion.div>
            ) : null}

            {!organization && choice ? (
              <motion.div
                key={`selected-${choice}`}
                className={`first-steps__stage first-steps__stage--selected${isCreatingOrganization ? " first-steps__stage--organization" : ""}`}
                initial={{ opacity: 0, y: 16, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="first-steps__stage-toolbar">
                  <div className="first-steps__selected-label">
                    {choice === "create" ? (
                      <Building2 size={18} aria-hidden="true" />
                    ) : (
                      <KeyRound size={18} aria-hidden="true" />
                    )}
                    <span>
                      {choice === "create"
                        ? "NUEVA ORGANIZACIÓN"
                        : "ACCESO POR INVITACIÓN"}
                    </span>
                  </div>
                  <button
                    className="first-steps__back"
                    type="button"
                    onClick={() => {
                      setChoice(null);
                      setError("");
                    }}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    Volver a las opciones
                  </button>
                </div>
                {form}
              </motion.div>
            ) : null}

            {organization &&
            (choice === "join" || canCreateWorkspace === true) ? (
              <motion.div
                key={choice === "join" ? "join-existing" : "new-workspace"}
                className="first-steps__stage"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.26, ease: "easeOut" }}
              >
                {form}
              </motion.div>
            ) : null}
          </AnimatePresence>

          {organization && canCreateWorkspace === false ? (
            <p className="first-steps__waiting" role="status">
              Tu cuenta ya pertenece a {organization.name}, pero todavía no
              tienes un espacio asignado. Pide a quien administra la
              organización que te dé acceso a uno.
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
        </section>
        <footer className="first-steps__footer">
          <Layers3 size={17} aria-hidden="true" />
          Tu cuenta es personal. El acceso a cada organización se gestiona por
          separado.
        </footer>
      </main>
    </MotionConfig>
  );
}
