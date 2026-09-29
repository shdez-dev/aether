"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  FolderOpen,
  Lightbulb,
  Plus,
  Sprout,
} from "lucide-react";
import type { InitiativeResponse, ProjectResponse } from "@aether/contracts";
import { initiativeStatusLabel } from "../../initiatives";
import { projectStatusLabel } from "../../lib/constants/project-status";
import type { WorkspaceView } from "./workspace-navigation";

type DailyBriefProps = {
  organizationName: string;
  workspaceName: string;
  initiatives: InitiativeResponse[];
  projects: ProjectResponse[];
  taskCount: number;
  loading: boolean;
  children: ReactNode;
  onNavigate: (view: WorkspaceView) => void;
  onCreateInitiative: () => void;
  onOpenInitiative: (initiative: InitiativeResponse) => void;
  onOpenProject: (project: ProjectResponse) => void;
};

export function DailyBrief({
  organizationName,
  workspaceName,
  initiatives,
  projects,
  loading,
  children,
  onNavigate,
  onCreateInitiative,
  onOpenInitiative,
  onOpenProject,
}: DailyBriefProps) {
  const [collection, setCollection] = useState<"initiatives" | "projects">(
    "initiatives",
  );
  const drafts = initiatives.filter((item) => item.status === "draft").length;
  const reviewing = initiatives.filter((item) =>
    ["presented", "under_review", "returned"].includes(item.status),
  ).length;
  const activeProjects = projects.filter(
    (item) => item.status === "active",
  ).length;
  const isEmpty = !initiatives.length && !projects.length;
  const recent = (
    collection === "initiatives"
      ? initiatives.map((item) => ({
          id: item.id,
          title: item.title,
          status: initiativeStatusLabel(item.status),
          updatedAt: item.updatedAt,
          open: () => onOpenInitiative(item),
        }))
      : projects.map((item) => ({
          id: item.id,
          title: item.name,
          status: projectStatusLabel(item.status),
          updatedAt: item.updatedAt,
          open: () => onOpenProject(item),
        }))
  )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 4);
  const today = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <section
      className="daily-desk"
      id="overview"
      aria-label="Resumen del espacio activo"
    >
      <header className="day-header">
        <div>
          <p className="day-date">
            <CalendarDays size={16} aria-hidden="true" />
            {today}
          </p>
          <h1>
            Mi día<span aria-hidden="true">.</span>
          </h1>
          <p>Despeja lo pendiente. Dale espacio a lo que viene.</p>
        </div>
        <div className="day-header-actions">
          <button
            className="day-button day-button--primary"
            type="button"
            onClick={onCreateInitiative}
          >
            <Plus size={18} aria-hidden="true" /> Nueva iniciativa
          </button>
        </div>
      </header>

      <div className="day-layout">
        <div className="day-main">
          {children}
          <section
            className="day-panel day-recent"
            aria-labelledby="recent-title"
          >
            <div className="day-panel-heading">
              <div>
                <p className="day-eyebrow">CONTINÚA DONDE IBAS</p>
                <h2 id="recent-title">A mano</h2>
              </div>
              <button
                className="day-button day-button--quiet"
                type="button"
                onClick={() => onNavigate(collection)}
              >
                Ver {collection === "initiatives" ? "iniciativas" : "proyectos"}
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </div>
            <div
              className="day-collections"
              role="group"
              aria-label="Tipo de trabajo"
            >
              <button
                type="button"
                aria-pressed={collection === "initiatives"}
                onClick={() => setCollection("initiatives")}
              >
                Iniciativas <span>{loading ? "—" : initiatives.length}</span>
              </button>
              <button
                type="button"
                aria-pressed={collection === "projects"}
                onClick={() => setCollection("projects")}
              >
                Proyectos <span>{loading ? "—" : projects.length}</span>
              </button>
            </div>
            {loading ? (
              <p className="day-inline-state" role="status">
                Cargando el trabajo de tu espacio…
              </p>
            ) : recent.length ? (
              <ul className="day-recent-list">
                {recent.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={item.open}
                      aria-label={`Abrir ${collection === "initiatives" ? "iniciativa" : "proyecto"}: ${item.title}`}
                    >
                      <span className="day-resource-icon" aria-hidden="true">
                        {collection === "initiatives" ? (
                          <Lightbulb size={20} />
                        ) : (
                          <FolderOpen size={20} />
                        )}
                      </span>
                      <span className="day-resource-copy">
                        <strong>{item.title}</strong>
                        <small>
                          Actualizado el{" "}
                          {new Intl.DateTimeFormat("es-CL", {
                            day: "numeric",
                            month: "short",
                          }).format(new Date(item.updatedAt))}
                        </small>
                      </span>
                      <span className="day-badge">{item.status}</span>
                      <ArrowUpRight size={17} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="day-recent-empty">
                <FolderOpen size={26} strokeWidth={1.5} aria-hidden="true" />
                <div>
                  <h3>
                    {collection === "initiatives"
                      ? "Aquí empieza tu próximo avance"
                      : "Tus proyectos tendrán su lugar aquí"}
                  </h3>
                  <p>
                    {collection === "initiatives"
                      ? "Las iniciativas de este espacio aparecerán aquí, con las últimas actualizadas primero."
                      : "Cuando una iniciativa se convierta en proyecto, podrás retomarlo desde este espacio."}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="day-aside" aria-label="Contexto del espacio">
          <section className="day-space" aria-labelledby="space-title">
            <p className="day-eyebrow">TU ESPACIO COMPARTIDO</p>
            <h2 id="space-title">{workspaceName}</h2>
            <p className="day-space-org">{organizationName}</p>
            <div className="day-space-stats" aria-busy={loading}>
              <button type="button" onClick={() => onNavigate("initiatives")}>
                <span>
                  <Lightbulb size={17} aria-hidden="true" />
                  Iniciativas
                </span>
                <strong>{loading ? "—" : initiatives.length}</strong>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => onNavigate("projects")}>
                <span>
                  <FolderOpen size={17} aria-hidden="true" />
                  Proyectos activos
                </span>
                <strong>{loading ? "—" : activeProjects}</strong>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </div>
            {!loading && initiatives.length > 0 ? (
              <p className="day-space-note">
                {drafts} en borrador · {reviewing} en revisión o seguimiento
              </p>
            ) : null}
          </section>

          <section className="day-guide" aria-labelledby="guide-title">
            <span className="day-guide-symbol" aria-hidden="true">
              <Sprout size={28} strokeWidth={1.5} />
            </span>
            <p className="day-eyebrow">DE UNA IDEA A UN CAMBIO</p>
            <h2 id="guide-title">
              {isEmpty
                ? "Todo empieza con una buena pregunta."
                : "La próxima mejora puede empezar contigo."}
            </h2>
            <p>
              ¿Qué podría funcionar mejor? Una iniciativa le da un lugar a esa
              idea para que tu equipo pueda evaluarla.
            </p>
            <ol>
              <li>
                <span>01</span>Describe la necesidad
              </li>
              <li>
                <span>02</span>Define el resultado que buscas
              </li>
              <li>
                <span>03</span>Compártela para su evaluación
              </li>
            </ol>
            <button
              type="button"
              className="day-button day-button--secondary"
              onClick={onCreateInitiative}
            >
              Empezar un borrador
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </section>
        </aside>
      </div>
    </section>
  );
}
