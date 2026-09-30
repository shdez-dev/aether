"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Layers3, ShieldCheck, X } from "lucide-react";
import type {
  OrganizationResponse,
  OrganizationRoleProfileResponse,
} from "@aether/contracts";

type OrganizationKind = NonNullable<OrganizationResponse["organizationType"]>;
type Request = (url: string, init?: RequestInit) => Promise<Response>;

const implementationLabels: Record<
  OrganizationRoleProfileResponse["initiativeResponsibilities"][number]["implementationStatus"],
  string
> = {
  implemented: "Disponible",
  restricted: "Alcance limitado",
  planned: "Próximamente",
};

function responsibilityLabel(
  status: OrganizationRoleProfileResponse["initiativeResponsibilities"][number]["implementationStatus"],
) {
  return implementationLabels[status];
}

export function OrganizationRoleProfilePreview({
  organizationType,
  request,
  compact = false,
}: {
  organizationType: OrganizationKind;
  request: Request;
  compact?: boolean;
}) {
  const [profile, setProfile] =
    useState<OrganizationRoleProfileResponse | null>(null);
  const [loadedType, setLoadedType] = useState<OrganizationKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailsTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void request("organization-role-profiles/" + organizationType)
      .then(async (response) => {
        if (!response.ok)
          throw new Error("No se pudo cargar el perfil de roles.");
        const nextProfile =
          (await response.json()) as OrganizationRoleProfileResponse;
        if (!active) return;
        setProfile(nextProfile);
        setLoadedType(organizationType);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar el perfil de roles.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationType, request, retryKey]);

  const currentProfile = loadedType === organizationType ? profile : null;

  function openDetails() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDetails() {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    detailsTriggerRef.current?.focus();
  }

  return (
    <section
      className={`organization-role-profile-preview${compact ? " organization-role-profile-preview--compact" : ""}`}
      aria-labelledby="organization-role-profile-heading"
      aria-busy={loading}
    >
      <div className="organization-role-profile-preview__heading">
        <div>
          <p className="organization-role-profile-preview__eyebrow">
            {compact ? "SEGÚN EL TIPO ELEGIDO" : "PERFIL DEL TIPO"}
          </p>
          <h3 id="organization-role-profile-heading">
            {compact ? "Accesos y funciones" : "Responsabilidades disponibles"}
          </h3>
          <p>
            {compact
              ? "Estos accesos y funciones estarán disponibles después de crear la organización."
              : `${currentProfile?.profileLabel ?? "Según el tipo que elijas"}. El tipo define qué roles se pueden asignar; cada asignación requiere acceso al espacio correspondiente.`}
          </p>
        </div>
        {!compact ? (
          <span className="organization-role-profile-preview__version">
            Catálogo base
          </span>
        ) : null}
      </div>

      {loading && !currentProfile ? (
        <div
          className="organization-role-profile-preview__loading"
          role="status"
        >
          Consultando roles para este tipo de organización…
        </div>
      ) : null}

      {error && !currentProfile ? (
        <div className="organization-role-profile-preview__error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRetryKey((current) => current + 1)}
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {currentProfile ? (
        compact ? (
          <>
            <div className="organization-role-profile-preview__overview">
              <div className="organization-role-profile-preview__overview-item">
                <span className="organization-role-profile-preview__overview-icon">
                  <ShieldCheck size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>Acceso</strong>
                  <p>Organización y espacios con permisos independientes.</p>
                </div>
              </div>
              <div className="organization-role-profile-preview__overview-item">
                <span className="organization-role-profile-preview__overview-icon">
                  <Layers3 size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>Funciones</strong>
                  <p>
                    {currentProfile.initiativeResponsibilities.length
                      ? "Responsabilidades en iniciativas y proyectos."
                      : "Proyectos; sin funciones de iniciativas."}
                  </p>
                </div>
              </div>
            </div>
            <button
              ref={detailsTriggerRef}
              className="organization-role-profile-preview__details-trigger"
              type="button"
              onClick={openDetails}
            >
              Ver permisos y funciones
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <dialog
              ref={dialogRef}
              className="organization-role-profile-preview__dialog"
              aria-labelledby="organization-role-profile-dialog-heading"
              aria-modal="true"
              onClose={() => detailsTriggerRef.current?.focus()}
            >
              <div className="organization-role-profile-preview__dialog-shell">
                <div className="organization-role-profile-preview__dialog-header">
                  <div>
                    <p className="organization-role-profile-preview__eyebrow">
                      {currentProfile.profileLabel.toLocaleUpperCase("es-CL")}
                    </p>
                    <h3 id="organization-role-profile-dialog-heading">
                      Roles y permisos
                    </h3>
                    <p>
                      Consulta qué acceso y responsabilidades podrás asignar.
                    </p>
                  </div>
                  <button
                    className="organization-role-profile-preview__dialog-close"
                    type="button"
                    onClick={closeDetails}
                    aria-label="Cerrar roles y permisos"
                  >
                    <X size={20} aria-hidden="true" />
                  </button>
                </div>
                <div className="organization-role-profile-preview__dialog-body">
                  <div className="organization-role-profile-preview__access-groups">
                    <AccessRoleGroup
                      title="Acceso a la organización"
                      roles={currentProfile.organizationAccessRoles}
                    />
                    <AccessRoleGroup
                      title="Acceso al espacio"
                      roles={currentProfile.workspaceAccessRoles}
                    />
                  </div>
                  <div className="organization-role-profile-preview__dialog-responsibilities">
                    <RoleGroup
                      title="Iniciativas"
                      roles={currentProfile.initiativeResponsibilities}
                      emptyMessage="Este tipo no agrega responsabilidades de iniciativas."
                    />
                    <RoleGroup
                      title="Proyectos"
                      roles={currentProfile.projectResponsibilities}
                    />
                  </div>
                </div>
              </div>
            </dialog>
          </>
        ) : (
          <>
            <div className="organization-role-profile-preview__access">
              <strong>Permisos de acceso comunes</strong>
              <span>
                {currentProfile.organizationAccessRoles
                  .map((role) => role.label.toLocaleLowerCase("es-CL"))
                  .join(" · ")}{" "}
                <span aria-hidden="true">/</span>{" "}
                {currentProfile.workspaceAccessRoles
                  .map((role) => role.label.toLocaleLowerCase("es-CL"))
                  .join(" · ")}
              </span>
              <small>Se mantienen iguales para todos los tipos.</small>
            </div>

            <div className="organization-role-profile-preview__groups">
              <RoleGroup
                title="Iniciativas"
                roles={currentProfile.initiativeResponsibilities}
                emptyMessage="Este tipo no agrega responsabilidades de revisión de iniciativas."
              />
              <RoleGroup
                title="Proyectos"
                roles={currentProfile.projectResponsibilities}
              />
            </div>
          </>
        )
      ) : null}
    </section>
  );
}

function AccessRoleGroup({
  title,
  roles,
}: {
  title: string;
  roles: readonly { key: string; label: string; description: string }[];
}) {
  return (
    <section className="organization-role-profile-preview__access-group">
      <h4>{title}</h4>
      <ul>
        {roles.map((role) => (
          <li key={role.key}>
            <strong>{role.label}</strong>
            <span>{role.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleGroup({
  title,
  roles,
  emptyMessage,
}: {
  title: string;
  roles: OrganizationRoleProfileResponse["initiativeResponsibilities"];
  emptyMessage?: string;
}) {
  return (
    <section className="organization-role-profile-preview__group">
      <h4>
        {title}
        <span>{roles.length}</span>
      </h4>
      {roles.length ? (
        <ul>
          {roles.map((role) => (
            <li key={role.key}>
              <span className="organization-role-profile-preview__role-copy">
                <strong>{role.label}</strong>
                <span>{role.description}</span>
              </span>
              <span
                className="organization-role-profile-preview__status"
                data-status={role.implementationStatus}
              >
                {responsibilityLabel(role.implementationStatus)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="organization-role-profile-preview__empty">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}
