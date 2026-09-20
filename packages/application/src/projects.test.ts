import { describe, expect, it } from "vitest";

import { createProject, type Project } from "@aether/domain";

import {
  ProjectService,
  type ProjectAuditStore,
  type ProjectStore,
} from "./projects.js";
import { AccessDeniedError, type TenantStore } from "./tenancy.js";

describe("ProjectService", () => {
  it("revokes execution access from a project lead whose membership is no longer active", async () => {
    const project = createProject({
      id: "project-1",
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      sourceInitiativeId: "initiative-1",
      sourceDecisionId: "decision-1",
      name: "Proyecto protegido",
      objective: "Proteger la ejecución.",
      boundaries: "Sólo el workspace protegido.",
      successCriteria: "Acceso revocado al retirar membresía.",
      nextMilestone: "Validar acceso.",
      sponsorActorId: "sponsor",
      leadActorId: "lead",
      participants: [
        { actorId: "sponsor", role: "sponsor" },
        { actorId: "lead", role: "lead" },
      ],
      createdAt: new Date("2026-09-18T12:00:00.000Z"),
      updatedAt: new Date("2026-09-18T12:00:00.000Z"),
    });
    let storedProject: Project = project;
    const activeRoles = new Map<string, "owner" | "admin" | "member">([
      ["owner", "owner"],
      ["lead", "member"],
    ]);
    const projects: ProjectStore = {
      async create() {},
      async findById(projectId) {
        return projectId === storedProject.id ? storedProject : null;
      },
      async findByInitiative() {
        return null;
      },
      async list() {
        return [];
      },
      async save(input) {
        if (input.expectedVersion !== storedProject.version) return false;
        storedProject = input.project;
        return true;
      },
      async transfer(input) {
        return this.save(input);
      },
    };
    const tenancy = {
      async findWorkspace(workspaceId: string) {
        return ["workspace-1", "workspace-2"].includes(workspaceId)
          ? {
              id: workspaceId,
              organizationId: "organization-1",
              name: "Workspace protegido",
              mode: "team" as const,
              status: "active" as const,
              createdAt: new Date("2026-09-18T12:00:00.000Z"),
              archivedAt: null,
              archivedByActorId: null,
              version: 0,
            }
          : null;
      },
      async findOrganizationRole(input: { actorId: string }) {
        return activeRoles.get(input.actorId) ?? null;
      },
      async findWorkspaceRole(input: { actorId: string }) {
        return activeRoles.has(input.actorId) ? ("member" as const) : null;
      },
    } as TenantStore;
    const audit: ProjectAuditStore = {
      async record() {},
      async list() {
        return [];
      },
    };
    const service = new ProjectService({
      projects,
      execution: {
        async addMilestone() {},
        async addNextAction() {},
        async hasMinimumPlan() {
          return true;
        },
      },
      closures: {} as never,
      documents: {} as never,
      audit,
      decisions: {} as never,
      initiatives: {} as never,
      tenancy,
      ids: { next: () => "event-1" },
      clock: { now: () => new Date("2026-09-18T12:01:00.000Z") },
    });

    await expect(
      service.transferWorkspace({
        actorId: "owner",
        organizationId: "organization-1",
        projectId: "project-1",
        expectedVersion: 0,
        workspaceId: "workspace-2",
        reason: "Cambio aprobado del contexto operativo.",
        correlationId: "correlation-transfer",
      }),
    ).resolves.toMatchObject({ workspaceId: "workspace-2", version: 1 });

    await expect(
      service.changeStatus({
        actorId: "lead",
        organizationId: "organization-1",
        projectId: "project-1",
        expectedVersion: 1,
        status: "active",
        correlationId: "correlation-1",
      }),
    ).resolves.toMatchObject({ status: "active", version: 2 });

    activeRoles.delete("lead");

    await expect(
      service.changeStatus({
        actorId: "lead",
        organizationId: "organization-1",
        projectId: "project-1",
        expectedVersion: 2,
        status: "blocked",
        correlationId: "correlation-2",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(storedProject).toMatchObject({ status: "active", version: 2 });
    await expect(
      service.pause({
        actorId: "owner",
        organizationId: "organization-1",
        projectId: "project-1",
        expectedVersion: 2,
        reason: "Dependencia externa aún no resuelta.",
        responsibleActorId: "owner",
        reviewOn: "2026-10-01",
        correlationId: "correlation-pause",
      }),
    ).resolves.toMatchObject({ status: "paused", version: 3 });
    await expect(
      service.changeStatus({
        actorId: "owner",
        organizationId: "organization-1",
        projectId: "project-1",
        expectedVersion: 3,
        status: "active",
        correlationId: "correlation-resume-without-replan",
      }),
    ).rejects.toMatchObject({ code: "PROJECT_REPLAN_REQUIRED" });
    await expect(
      service.resume({
        actorId: "owner",
        organizationId: "organization-1",
        projectId: "project-1",
        expectedVersion: 3,
        replanNote: "Se ajustó el hito y la próxima acción.",
        correlationId: "correlation-resume",
      }),
    ).resolves.toMatchObject({ status: "active", version: 4 });
    await expect(
      service.changeStatus({
        actorId: "owner",
        organizationId: "organization-1",
        projectId: "project-1",
        expectedVersion: 4,
        status: "cancelled",
        correlationId: "correlation-cancel-without-reason",
      }),
    ).rejects.toMatchObject({ code: "PROJECT_CANCELLATION_REASON_REQUIRED" });
    await expect(
      service.cancel({
        actorId: "owner",
        organizationId: "organization-1",
        projectId: "project-1",
        expectedVersion: 4,
        reason: "El patrocinador retiró el mandato.",
        correlationId: "correlation-cancel",
      }),
    ).resolves.toMatchObject({ status: "cancelled", version: 5 });
  });
});
