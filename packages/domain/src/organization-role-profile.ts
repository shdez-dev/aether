import {
  OrganizationRoles,
  WorkspaceRoles,
  type OrganizationRole,
  type WorkspaceRole,
} from "./access.js";

export const OrganizationTypes = [
  "personal",
  "business",
  "institutional",
] as const;
export type OrganizationType = (typeof OrganizationTypes)[number];

export type RoleImplementationStatus = "implemented" | "restricted" | "planned";

export type OrganizationAccessRoleDefinition = Readonly<{
  key: OrganizationRole;
  label: string;
  scope: "organization";
  description: string;
}>;

export type WorkspaceAccessRoleDefinition = Readonly<{
  key: WorkspaceRole;
  label: string;
  scope: "workspace";
  description: string;
}>;

export type ResponsibilityRoleKey =
  | "initiative_coordinator"
  | "initiative_evaluator"
  | "initiative_approver"
  | "initiative_mentor"
  | "project_sponsor"
  | "project_lead"
  | "project_contributor"
  | "project_observer";

export type ResponsibilityRoleDefinition = Readonly<{
  key: ResponsibilityRoleKey;
  label: string;
  scope: "initiative" | "project";
  description: string;
  implementationStatus: RoleImplementationStatus;
}>;

export type OrganizationRoleProfile = Readonly<{
  version: 1;
  organizationType: OrganizationType | null;
  profileKey: "personal" | "business" | "institutional" | "unclassified";
  profileLabel: string;
  organizationAccessRoles: readonly OrganizationAccessRoleDefinition[];
  workspaceAccessRoles: readonly WorkspaceAccessRoleDefinition[];
  initiativeResponsibilities: readonly ResponsibilityRoleDefinition[];
  projectResponsibilities: readonly ResponsibilityRoleDefinition[];
}>;

const organizationAccessRoleDefinitions = [
  {
    key: "owner",
    label: "Propietario",
    scope: "organization",
    description:
      "Gobierna la organización y conserva las acciones exclusivas de propiedad.",
  },
  {
    key: "admin",
    label: "Administrador",
    scope: "organization",
    description:
      "Gestiona políticas, espacios y membresías sin transferir la propiedad.",
  },
  {
    key: "member",
    label: "Miembro",
    scope: "organization",
    description:
      "Pertenece a la organización; el acceso a espacios se concede por separado.",
  },
] as const satisfies readonly OrganizationAccessRoleDefinition[];

const workspaceAccessRoleDefinitions = [
  {
    key: "admin",
    label: "Administrador del espacio",
    scope: "workspace",
    description: "Gestiona el espacio, sus equipos y su configuración.",
  },
  {
    key: "member",
    label: "Miembro del espacio",
    scope: "workspace",
    description: "Colabora en el espacio según el acceso de cada recurso.",
  },
  {
    key: "viewer",
    label: "Lector del espacio",
    scope: "workspace",
    description: "Consulta los recursos que la política le autoriza a ver.",
  },
] as const satisfies readonly WorkspaceAccessRoleDefinition[];

const responsibilityRoles = {
  initiative_coordinator: {
    key: "initiative_coordinator",
    label: "Coordinación de iniciativas",
    scope: "initiative",
    description:
      "Organiza el ingreso, asigna responsables de atención y mantiene el siguiente paso.",
    implementationStatus: "implemented",
  },
  initiative_evaluator: {
    key: "initiative_evaluator",
    label: "Evaluación de iniciativas",
    scope: "initiative",
    description:
      "Revisa una iniciativa asignada usando el estándar vigente y evidencia.",
    implementationStatus: "implemented",
  },
  initiative_approver: {
    key: "initiative_approver",
    label: "Aprobación de iniciativas",
    scope: "initiative",
    description:
      "Registra una decisión de gobierno después de la evaluación correspondiente.",
    implementationStatus: "implemented",
  },
  initiative_mentor: {
    key: "initiative_mentor",
    label: "Mentoría",
    scope: "initiative",
    description:
      "Acompaña una iniciativa asignada con orientación; requiere un plazo explícito y no sustituye la evaluación.",
    implementationStatus: "implemented",
  },
  project_sponsor: {
    key: "project_sponsor",
    label: "Patrocinador del proyecto",
    scope: "project",
    description:
      "Respalda el propósito del proyecto y ayuda a remover bloqueos institucionales.",
    implementationStatus: "implemented",
  },
  project_lead: {
    key: "project_lead",
    label: "Líder del proyecto",
    scope: "project",
    description:
      "Acepta la responsabilidad principal por el avance y la coordinación del proyecto.",
    implementationStatus: "implemented",
  },
  project_contributor: {
    key: "project_contributor",
    label: "Colaborador del proyecto",
    scope: "project",
    description: "Participa en trabajo y compromisos autorizados del proyecto.",
    implementationStatus: "implemented",
  },
  project_observer: {
    key: "project_observer",
    label: "Observador del proyecto",
    scope: "project",
    description: "Acompaña el proyecto con acceso de consulta autorizado.",
    implementationStatus: "implemented",
  },
} as const satisfies Record<
  ResponsibilityRoleKey,
  ResponsibilityRoleDefinition
>;

const projectRoleKeys = [
  "project_sponsor",
  "project_lead",
  "project_contributor",
  "project_observer",
] as const satisfies readonly ResponsibilityRoleKey[];

const initiativeRoleKeysByType: Readonly<
  Record<OrganizationType, readonly ResponsibilityRoleKey[]>
> = {
  personal: [],
  business: ["initiative_coordinator", "initiative_evaluator"],
  institutional: [
    "initiative_coordinator",
    "initiative_evaluator",
    "initiative_approver",
    "initiative_mentor",
  ],
};

const profileLabels: Readonly<Record<OrganizationType, string>> = {
  personal: "Trabajo personal",
  business: "Equipo o empresa",
  institutional: "Institución",
};

function getResponsibilityDefinitions(
  keys: readonly ResponsibilityRoleKey[],
): readonly ResponsibilityRoleDefinition[] {
  return keys.map((key) => responsibilityRoles[key]);
}

/**
 * Returns the built-in role catalog for an organization type. Membership
 * roles stay consistent across types; the type only selects the default
 * initiative responsibility profile. Null represents older unclassified
 * organizations and receives the conservative personal profile.
 */
export function getOrganizationRoleProfile(
  organizationType: OrganizationType | null,
): OrganizationRoleProfile {
  const profileKey = organizationType ?? "unclassified";
  const responsibilityType = organizationType ?? "personal";
  return {
    version: 1,
    organizationType,
    profileKey,
    profileLabel:
      organizationType === null
        ? "Organización sin clasificar"
        : profileLabels[organizationType],
    organizationAccessRoles: organizationAccessRoleDefinitions,
    workspaceAccessRoles: workspaceAccessRoleDefinitions,
    initiativeResponsibilities: getResponsibilityDefinitions(
      initiativeRoleKeysByType[responsibilityType],
    ),
    projectResponsibilities: getResponsibilityDefinitions(projectRoleKeys),
  };
}

export const OrganizationAccessRoleKeys = OrganizationRoles;
export const WorkspaceAccessRoleKeys = WorkspaceRoles;
