"use client";

import { useEffect, useState } from "react";
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
}: {
  organizationType: OrganizationKind;
  request: Request;
}) {
  const [profile, setProfile] =
    useState<OrganizationRoleProfileResponse | null>(null);
  const [loadedType, setLoadedType] = useState<OrganizationKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

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

  return (
    <section
      className="organization-role-profile-preview"
      aria-labelledby="organization-role-profile-heading"
      aria-busy={loading}
    >
      <div className="organization-role-profile-preview__heading">
        <div>
          <p className="organization-role-profile-preview__eyebrow">
            PERFIL DEL TIPO
          </p>
          <h3 id="organization-role-profile-heading">
            Responsabilidades disponibles
          </h3>
          <p>
            {currentProfile?.profileLabel ?? "Según el tipo que elijas"}. El
            tipo define qué roles se pueden asignar; cada asignación requiere
            acceso al espacio correspondiente.
          </p>
        </div>
        <span className="organization-role-profile-preview__version">
          Catálogo base
        </span>
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
      ) : null}
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
