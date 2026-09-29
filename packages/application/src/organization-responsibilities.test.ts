import { afterEach, describe, expect, it, vi } from "vitest";

import type { Organization, TenantStore, Workspace } from "./tenancy.js";
import {
  OrganizationResponsibilityService,
  type OrganizationResponsibilityAssignment,
  type OrganizationResponsibilityAuditEvent,
  type OrganizationResponsibilityMember,
  type OrganizationResponsibilityStore,
} from "./organization-responsibilities.js";

afterEach(() => vi.restoreAllMocks());

function setup(
  organizationType: "business" | "institutional" | "personal" = "institutional",
) {
  const organization: Organization = {
    id: "organization-1",
    name: "Aether",
    organizationType,
    timezone: "America/Santiago",
    locale: "es-CL",
    version: 0,
  };
  const workspace: Workspace = {
    id: "workspace-1",
    organizationId: organization.id,
    name: "Producto",
    mode: "team",
    version: 0,
    status: "active",
    archivedAt: null,
    archivedByActorId: null,
  };
  const organizationRoles = new Map([
    ["owner", "owner" as const],
    ["member", "member" as const],
    ["outsider", null],
  ]);
  const workspaceRoles = new Map([
    ["member", "member" as const],
    ["outsider", null],
  ]);
  const members: OrganizationResponsibilityMember[] = [
    {
      actorId: "member",
      actorName: "Ada Lovelace",
      actorEmail: "ada@example.test",
      organizationRole: "member",
      workspaceRole: "member",
    },
  ];
  const initiatives = [
    { id: "initiative-1", title: "Portal de producto", status: "presented" },
  ];
  const assignments = new Map<string, OrganizationResponsibilityAssignment>();
  const auditEvents: OrganizationResponsibilityAuditEvent[] = [];
  const store: OrganizationResponsibilityStore = {
    listMembers: async () => members,
    listInitiatives: async () => initiatives,
    findInitiative: async ({ initiativeId }) =>
      initiatives.find((initiative) => initiative.id === initiativeId) ?? null,
    listAssignments: async ({ organizationId, workspaceId }) =>
      [...assignments.values()].filter(
        (item) =>
          item.organizationId === organizationId &&
          item.workspaceId === workspaceId,
      ),
    findAssignment: async ({ organizationId, assignmentId }) => {
      const assignment = assignments.get(assignmentId);
      return assignment?.organizationId === organizationId ? assignment : null;
    },
    createAssignment: async ({ assignment, auditEvent }) => {
      if (assignments.has(assignment.id)) return "already_assigned";
      if (!organizationRoles.get(assignment.actorId))
        return "member_not_active";
      if (
        [...assignments.values()].some(
          (existing) =>
            existing.organizationId === assignment.organizationId &&
            existing.workspaceId === assignment.workspaceId &&
            existing.actorId === assignment.actorId &&
            existing.roleKey === assignment.roleKey &&
            existing.initiativeId === assignment.initiativeId,
        )
      )
        return "already_assigned";
      const member = members.find(
        (candidate) => candidate.actorId === assignment.actorId,
      );
      assignments.set(assignment.id, {
        ...assignment,
        actorName: member?.actorName ?? assignment.actorName,
        actorEmail: member?.actorEmail ?? assignment.actorEmail,
      });
      auditEvents.push(auditEvent);
      return "created";
    },
    revokeAssignment: async ({ assignmentId, auditEvent }) => {
      const assignment = assignments.get(assignmentId);
      if (!assignment) return "not_found";
      assignments.delete(assignmentId);
      auditEvents.push(auditEvent);
      return "revoked";
    },
    hasActiveAssignment: async ({
      organizationId,
      workspaceId,
      actorId,
      roleKey,
      initiativeId,
    }) =>
      [...assignments.values()].some(
        (item) =>
          item.organizationId === organizationId &&
          item.workspaceId === workspaceId &&
          item.actorId === actorId &&
          item.roleKey === roleKey &&
          (roleKey !== "initiative_mentor" ||
            item.initiativeId === initiativeId),
      ),
  };
  let id = 0;
  const tenancy = {
    listOrganizations: async () => [organization],
    findOrganizationRole: async ({ actorId }: { actorId: string }) =>
      organizationRoles.get(actorId) ?? null,
    findWorkspaceRole: async ({ actorId }: { actorId: string }) =>
      workspaceRoles.get(actorId) ?? null,
    findWorkspace: async () => workspace,
  } as unknown as TenantStore;
  const service = new OrganizationResponsibilityService({
    store,
    tenancy,
    ids: { next: () => `generated-${++id}` },
    clock: { now: () => new Date("2026-09-29T12:00:00.000Z") },
  });
  return { service, store, assignments, auditEvents, organization, workspace };
}

describe("OrganizationResponsibilityService", () => {
  it("assigns initiative roles only within an accessible workspace and audits them", async () => {
    const { service, store, auditEvents } = setup();
    const assignment = await service.assign({
      actorId: "owner",
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      targetActorId: "member",
      roleKey: "initiative_evaluator",
      correlationId: "correlation-1",
    });

    expect(assignment.actorName).toBe("Ada Lovelace");
    expect(
      await store.hasActiveAssignment({
        organizationId: "organization-1",
        workspaceId: "workspace-1",
        actorId: "member",
        roleKey: "initiative_evaluator",
      }),
    ).toBe(true);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.eventType).toBe(
      "organization.responsibility_assigned.v1",
    );
  });

  it("rejects unavailable role types and members without workspace access", async () => {
    const business = setup("business");
    await expect(
      business.service.assign({
        actorId: "owner",
        organizationId: "organization-1",
        workspaceId: "workspace-1",
        targetActorId: "member",
        roleKey: "initiative_approver",
        correlationId: "correlation-1",
      }),
    ).rejects.toMatchObject({
      code: "ROLE_NOT_AVAILABLE",
    });

    const institutional = setup();
    await expect(
      institutional.service.assign({
        actorId: "owner",
        organizationId: "organization-1",
        workspaceId: "workspace-1",
        targetActorId: "outsider",
        roleKey: "initiative_mentor",
        initiativeId: "initiative-1",
        validUntil: "2026-10-30",
        correlationId: "correlation-2",
      }),
    ).rejects.toMatchObject({
      code: "MEMBER_NOT_IN_WORKSPACE",
    });
  });

  it("requires mentor responsibilities to target one initiative and a bounded term", async () => {
    const { service } = setup();
    const common = {
      actorId: "owner",
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      targetActorId: "member",
      correlationId: "correlation-mentor-scope",
    };

    await expect(
      service.assign({ ...common, roleKey: "initiative_mentor" }),
    ).rejects.toMatchObject({ code: "MENTOR_SCOPE_REQUIRED" });
    await expect(
      service.assign({
        ...common,
        roleKey: "initiative_mentor",
        initiativeId: "initiative-1",
        validUntil: "2027-10-01",
      }),
    ).rejects.toMatchObject({ code: "MENTOR_VALIDITY_INVALID" });
    await expect(
      service.assign({
        ...common,
        roleKey: "initiative_evaluator",
        initiativeId: "initiative-1",
      }),
    ).rejects.toMatchObject({ code: "ROLE_SCOPE_INVALID" });
  });

  it("prevents duplicate roles and allows an administrator to revoke them", async () => {
    const { service, assignments, auditEvents } = setup();
    const input = {
      actorId: "owner",
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      targetActorId: "member",
      roleKey: "initiative_mentor" as const,
      initiativeId: "initiative-1",
      validUntil: "2026-10-30",
      correlationId: "correlation-3",
    };
    const assigned = await service.assign(input);
    await expect(service.assign(input)).rejects.toMatchObject({
      code: "ALREADY_ASSIGNED",
    });

    await service.revoke({
      actorId: "owner",
      organizationId: "organization-1",
      assignmentId: assigned.id,
      correlationId: "correlation-4",
    });

    expect(assignments.size).toBe(0);
    expect(auditEvents.map((event) => event.eventType)).toEqual([
      "organization.responsibility_assigned.v1",
      "organization.responsibility_revoked.v1",
    ]);
  });
});
