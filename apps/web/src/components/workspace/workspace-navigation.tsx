import {
  ArrowUpRight,
  Boxes,
  House,
  Landmark,
  LogOut,
  PanelsTopLeft,
} from "lucide-react";

export type WorkspaceView =
  "overview" | "initiatives" | "projects" | "organization";

const destinations = [
  { id: "overview", label: "Mi día", icon: House },
  { id: "initiatives", label: "Iniciativas", icon: PanelsTopLeft },
  { id: "projects", label: "Proyectos", icon: Boxes },
  { id: "organization", label: "Organización", icon: Landmark },
] as const;

export function WorkspaceNavigation({
  activeView,
  organizationName,
  onNavigate,
  onLogout,
}: {
  activeView: WorkspaceView;
  organizationName: string;
  onNavigate: (view: WorkspaceView) => void;
  onLogout: () => void;
}) {
  return (
    <aside
      className="workspace-sidebar"
      aria-label="Menú del espacio de trabajo"
    >
      <a
        className="workspace-sidebar__brand"
        href="/workspace"
        aria-label="AETHER, ir a Mi día"
      >
        <svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
          <path
            d="M13 3h14M30 5l7 12M37 23l-7 12M27 37H13M10 35 3 23M3 17l7-12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
          />
        </svg>
        <span>AETHER</span>
      </a>

      <div className="workspace-sidebar__context">
        <span>ESPACIO ACTIVO</span>
        <strong title={organizationName}>{organizationName}</strong>
      </div>

      <nav className="workspace-sidebar__nav" aria-label="Navegación principal">
        <span className="workspace-sidebar__caption">EXPLORAR</span>
        {destinations.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            className={
              activeView === id
                ? "workspace-sidebar__link is-active"
                : "workspace-sidebar__link"
            }
            aria-current={activeView === id ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(id);
            }}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
            {activeView === id ? (
              <span
                className="workspace-sidebar__active-dot"
                aria-hidden="true"
              />
            ) : null}
          </a>
        ))}
      </nav>

      <div className="workspace-sidebar__bottom">
        <a href="/" className="workspace-sidebar__site-link">
          Ver sitio público <ArrowUpRight size={15} aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={onLogout}
          className="workspace-sidebar__logout"
        >
          <LogOut size={17} strokeWidth={1.8} aria-hidden="true" /> Cerrar
          sesión
        </button>
      </div>
    </aside>
  );
}
