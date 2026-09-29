import {
  Boxes,
  Clock3,
  House,
  ListTodo,
  LogOut,
  PanelsTopLeft,
  Settings2,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";

export type WorkspaceView =
  | "overview"
  | "my-work"
  | "initiatives"
  | "initiative-new"
  | "initiative-edit"
  | "projects"
  | "recent"
  | "settings"
  | "profile"
  | "organization"
  | "organization-new";

const personalDestinations = [
  { id: "overview", label: "Mi día", icon: House },
] as const;
const workDestinations = [
  { id: "my-work", label: "Mis tareas", icon: ListTodo },
] as const;
const spaceDestinations = [
  { id: "initiatives", label: "Iniciativas", icon: PanelsTopLeft },
  { id: "projects", label: "Proyectos", icon: Boxes },
  { id: "recent", label: "Recientes", icon: Clock3 },
] as const;

function NavigationLinks({
  destinations,
  activeView,
  onNavigate,
}: {
  destinations: ReadonlyArray<{
    id: WorkspaceView;
    label: string;
    icon: typeof House;
  }>;
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
}) {
  return destinations.map(({ id, label, icon: Icon }) => (
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
      <span className="workspace-sidebar__label">{label}</span>
      {activeView === id ? (
        <span className="workspace-sidebar__active-dot" aria-hidden="true" />
      ) : null}
    </a>
  ));
}

export function WorkspaceNavigation({
  activeView,
  contextSwitcher,
  onNavigate,
  onLogout,
}: {
  activeView: WorkspaceView;
  contextSwitcher: ReactNode;
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

      {contextSwitcher}

      <nav className="workspace-sidebar__nav" aria-label="Navegación principal">
        <div className="workspace-sidebar__group">
          <span className="workspace-sidebar__caption">TU TRABAJO</span>
          <NavigationLinks
            destinations={personalDestinations}
            activeView={activeView}
            onNavigate={onNavigate}
          />
          <NavigationLinks
            destinations={workDestinations}
            activeView={activeView}
            onNavigate={onNavigate}
          />
        </div>
        <div className="workspace-sidebar__group">
          <span className="workspace-sidebar__caption">ESPACIO</span>
          <NavigationLinks
            destinations={spaceDestinations}
            activeView={activeView}
            onNavigate={onNavigate}
          />
        </div>
      </nav>

      <div className="workspace-sidebar__bottom">
        <a
          href="#profile"
          className={
            activeView === "profile"
              ? "workspace-sidebar__utility is-active"
              : "workspace-sidebar__utility"
          }
          aria-label="Perfil"
          title="Perfil"
          aria-current={activeView === "profile" ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onNavigate("profile");
          }}
        >
          <UserRound size={19} strokeWidth={1.8} aria-hidden="true" />
        </a>
        <a
          href="#settings"
          className={
            activeView === "settings"
              ? "workspace-sidebar__utility is-active"
              : "workspace-sidebar__utility"
          }
          aria-label="Configuración"
          title="Configuración"
          aria-current={activeView === "settings" ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onNavigate("settings");
          }}
        >
          <Settings2 size={19} strokeWidth={1.8} aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={onLogout}
          className="workspace-sidebar__utility"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <LogOut size={19} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
