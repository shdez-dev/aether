import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  ResourceNotFoundError,
  TenantService,
  WorkspaceArchivedError,
  assertWorkspaceWritable,
} from "@aether/application";

import { InMemoryTenantStore } from "./tenancy.js";

function createTenantService(now = new Date("2026-09-08T12:00:00.000Z")) {
  let sequence = 0;
  let tokenSequence = 0;
  let currentTime = now;
  const store = new InMemoryTenantStore();
  const service = new TenantService({
    store,
    ids: {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    },
    tokens: {
      generate: () => String(++tokenSequence).padStart(43, "x"),
      hash: (value) => `hash:${value}`,
    },
    clock: { now: () => currentTime },
  });
  return {
    service,
    store,
    setTime: (value: Date) => {
      currentTime = value;
    },
  };
}

describe("TenantService", () => {
  it("audita el inicio del ciclo de vida sin exponer correo ni token de invitación", async () => {
    const { service, store } = createTenantService();
    const organization = await service.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Auditoría",
      timezone: "UTC",
      locale: "es-CL",
      correlationId: "00000000-0000-4000-8000-000000000110",
    });
    const workspace = await service.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Equipo",
      mode: "institutional",
      correlationId: "00000000-0000-4000-8000-000000000111",
    });
    const invitation = await service.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "member@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "viewer",
      expiresInDays: 7,
      correlationId: "00000000-0000-4000-8000-000000000112",
    });
    await service.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "member",
      actorEmail: "member@example.test",
      correlationId: "00000000-0000-4000-8000-000000000113",
    });

    expect(store.organizationMembershipAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "organization.created.v1" }),
        expect.objectContaining({
          eventType: "organization.invitation_issued.v1",
          payload: {
            invitationId: invitation.invitation.id,
            organizationRole: "member",
            workspaceCount: 1,
          },
        }),
        expect.objectContaining({
          eventType: "organization.membership_activated.v1",
        }),
      ]),
    );
    expect(store.workspaceAuditEvents).toEqual([
      expect.objectContaining({
        workspaceId: workspace.id,
        eventType: "workspace.created.v1",
        payload: { mode: "institutional" },
      }),
    ]);
    expect(
      JSON.stringify(store.organizationMembershipAuditEvents),
    ).not.toContain("member@example.test");
    expect(
      JSON.stringify(store.organizationMembershipAuditEvents),
    ).not.toContain(invitation.deliveryToken);
  });

  it("rechaza, revoca y vence invitaciones sin conceder acceso ni duplicar aceptación", async () => {
    const { service, store, setTime } = createTenantService();
    const organization = await service.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Ciclo de invitaciones",
      timezone: "UTC",
      locale: "es-CL",
    });
    const accepted = await service.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "accepted@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    await service.acceptInvitation({
      token: accepted.deliveryToken,
      actorId: "accepted",
      actorEmail: "accepted@example.test",
    });
    await expect(
      service.acceptInvitation({
        token: accepted.deliveryToken,
        actorId: "accepted",
        actorEmail: "accepted@example.test",
      }),
    ).resolves.toMatchObject({ id: accepted.invitation.id });

    const rejected = await service.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "rejected@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    await service.rejectInvitation({
      token: rejected.deliveryToken,
      actorId: "rejected",
      actorEmail: "rejected@example.test",
    });
    await expect(
      service.acceptInvitation({
        token: rejected.deliveryToken,
        actorId: "rejected",
        actorEmail: "rejected@example.test",
      }),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID_OR_EXPIRED" });

    const revoked = await service.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "revoked@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    await service.revokeInvitation({
      actorId: "owner",
      organizationId: organization.id,
      invitationId: revoked.invitation.id,
      correlationId: "00000000-0000-4000-8000-000000000114",
    });
    await expect(
      service.acceptInvitation({
        token: revoked.deliveryToken,
        actorId: "revoked",
        actorEmail: "revoked@example.test",
      }),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID_OR_EXPIRED" });

    const expired = await service.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "expired@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 1,
    });
    setTime(new Date("2026-09-10T12:00:00.000Z"));
    await expect(
      service.acceptInvitation({
        token: expired.deliveryToken,
        actorId: "expired",
        actorEmail: "expired@example.test",
      }),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID_OR_EXPIRED" });
    expect(
      store.organizationMembershipAuditEvents.map((event) => event.eventType),
    ).toEqual(
      expect.arrayContaining([
        "organization.invitation_rejected.v1",
        "organization.invitation_revoked.v1",
        "organization.invitation_expired.v1",
      ]),
    );
    expect(
      store.organizationMembershipAuditEvents.filter(
        (event) => event.eventType === "organization.membership_activated.v1",
      ),
    ).toHaveLength(1);
  });

  it("gestiona equipos dentro de un workspace sin convertirlos en permisos implícitos", async () => {
    const { service } = createTenantService();
    const organization = await service.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "A",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await service.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Equipo",
      mode: "team",
    });
    const invitation = await service.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "viewer@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    await service.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "viewer",
      actorEmail: "viewer@example.test",
    });
    const team = await service.createTeam({
      actorId: "owner",
      organizationId: organization.id,
      workspaceId: workspace.id,
      name: "Método",
      memberActorIds: ["owner", "viewer", "viewer"],
      correlationId: "00000000-0000-4000-8000-000000000096",
    });
    expect(team.memberActorIds).toEqual(["owner", "viewer"]);
    await expect(
      service.listTeams({
        actorId: "viewer",
        organizationId: organization.id,
        workspaceId: workspace.id,
      }),
    ).resolves.toEqual([team]);
    await expect(
      service.createTeam({
        actorId: "viewer",
        organizationId: organization.id,
        workspaceId: workspace.id,
        name: "No permitido",
        memberActorIds: [],
        correlationId: "00000000-0000-4000-8000-000000000095",
      }),
    ).rejects.toMatchObject({ action: "team:create" });
  });

  it("aplica la matriz de permisos a operaciones de tenencia permitidas y denegadas", async () => {
    const { service } = createTenantService();
    const organization = await service.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "A",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await service.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Operaciones",
      mode: "team",
    });
    const roles = [
      {
        actorId: "organization-admin",
        organizationRole: "admin" as const,
        workspaceRole: "viewer" as const,
      },
      {
        actorId: "workspace-admin",
        organizationRole: "member" as const,
        workspaceRole: "admin" as const,
      },
      {
        actorId: "workspace-member",
        organizationRole: "member" as const,
        workspaceRole: "member" as const,
      },
      {
        actorId: "workspace-viewer",
        organizationRole: "member" as const,
        workspaceRole: "viewer" as const,
      },
    ];
    for (const role of roles) {
      const invitation = await service.invite({
        actorId: "owner",
        organizationId: organization.id,
        email: `${role.actorId}@example.test`,
        organizationRole: role.organizationRole,
        workspaceIds: [workspace.id],
        workspaceRole: role.workspaceRole,
        expiresInDays: 7,
      });
      await service.acceptInvitation({
        token: invitation.deliveryToken,
        actorId: role.actorId,
        actorEmail: `${role.actorId}@example.test`,
      });
    }

    await expect(
      service.createWorkspace({
        actorId: "organization-admin",
        organizationId: organization.id,
        name: "Permitido",
        mode: "team",
      }),
    ).resolves.toMatchObject({ organizationId: organization.id });
    await expect(
      service.invite({
        actorId: "organization-admin",
        organizationId: organization.id,
        email: "new-member@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "viewer",
        expiresInDays: 7,
      }),
    ).resolves.toBeDefined();
    await expect(
      service.getWorkspace({
        actorId: "workspace-viewer",
        organizationId: organization.id,
        workspaceId: workspace.id,
      }),
    ).resolves.toMatchObject({ id: workspace.id });

    for (const actorId of [
      "workspace-admin",
      "workspace-member",
      "workspace-viewer",
    ]) {
      await expect(
        service.createWorkspace({
          actorId,
          organizationId: organization.id,
          name: "Denegado",
          mode: "team",
        }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(
        service.invite({
          actorId,
          organizationId: organization.id,
          email: `${actorId}-invite@example.test`,
          organizationRole: "member",
          workspaceIds: [],
          workspaceRole: "viewer",
          expiresInDays: 7,
        }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
    }

    await expect(
      service.archiveWorkspace({
        actorId: "workspace-member",
        organizationId: organization.id,
        workspaceId: workspace.id,
        correlationId: "00000000-0000-4000-8000-000000000097",
      }),
    ).rejects.toMatchObject({ action: "workspace:archive" });
    await expect(
      service.archiveWorkspace({
        actorId: "workspace-admin",
        organizationId: organization.id,
        workspaceId: workspace.id,
        correlationId: "00000000-0000-4000-8000-000000000098",
      }),
    ).resolves.toBeUndefined();
  });

  it("archiva un workspace con autorización, conserva lectura y bloquea nuevas escrituras", async () => {
    const { service, store } = createTenantService();
    const organization = await service.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "A",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await service.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Archivo",
      mode: "team",
    });
    await service.archiveWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      workspaceId: workspace.id,
      correlationId: "00000000-0000-4000-8000-000000000098",
    });
    await expect(
      service.getWorkspace({
        actorId: "owner",
        organizationId: organization.id,
        workspaceId: workspace.id,
      }),
    ).resolves.toMatchObject({
      status: "archived",
      archivedByActorId: "owner",
    });
    await expect(
      assertWorkspaceWritable(store, workspace.id),
    ).rejects.toBeInstanceOf(WorkspaceArchivedError);
  });

  it("aísla workspaces entre organizaciones y concede acceso sólo tras aceptar una invitación válida", async () => {
    const { service } = createTenantService();
    const organizationA = await service.createOrganization({
      actorId: "owner-a",
      actorEmail: "owner-a@example.test",
      name: "A",
      timezone: "UTC",
      locale: "es-CL",
    });
    const organizationB = await service.createOrganization({
      actorId: "owner-b",
      actorEmail: "owner-b@example.test",
      name: "B",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspaceA = await service.createWorkspace({
      actorId: "owner-a",
      organizationId: organizationA.id,
      name: "A workspace",
      mode: "team",
    });
    const workspaceB = await service.createWorkspace({
      actorId: "owner-b",
      organizationId: organizationB.id,
      name: "B workspace",
      mode: "team",
    });
    await expect(
      service.createWorkspace({
        actorId: "guest",
        organizationId: organizationA.id,
        name: "blocked",
        mode: "team",
      }),
    ).rejects.toMatchObject({ action: "workspace:create" });
    const invitation = await service.invite({
      actorId: "owner-a",
      organizationId: organizationA.id,
      email: "guest@example.test",
      organizationRole: "member",
      workspaceIds: [workspaceA.id],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    await service.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "guest",
      actorEmail: "guest@example.test",
    });
    await expect(
      service.getWorkspace({
        actorId: "guest",
        organizationId: organizationA.id,
        workspaceId: workspaceA.id,
      }),
    ).resolves.toMatchObject({ id: workspaceA.id });
    await expect(
      service.getWorkspace({
        actorId: "guest",
        organizationId: organizationA.id,
        workspaceId: workspaceB.id,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      service.capabilities({
        actorId: "guest",
        organizationId: organizationA.id,
        workspaceId: workspaceB.id,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      service.getWorkspace({
        actorId: "guest",
        organizationId: organizationB.id,
        workspaceId: workspaceB.id,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("transfiere propiedad de forma explícita, conserva un responsable y deja auditoría", async () => {
    const { service, store } = createTenantService();
    const organization = await service.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "A",
      timezone: "UTC",
      locale: "es-CL",
    });
    const invitation = await service.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "next-owner@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await service.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "next-owner",
      actorEmail: "next-owner@example.test",
    });

    await service.transferOwnership({
      actorId: "owner",
      organizationId: organization.id,
      targetActorId: "next-owner",
      correlationId: "00000000-0000-4000-8000-000000000099",
    });

    await expect(
      service.capabilities({
        actorId: "next-owner",
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({ canManageOrganization: true });
    await expect(
      service.transferOwnership({
        actorId: "owner",
        organizationId: organization.id,
        targetActorId: "next-owner",
        correlationId: "00000000-0000-4000-8000-000000000100",
      }),
    ).rejects.toMatchObject({
      code: "ACTOR_MUST_BE_OWNER",
    });
    expect(store.ownershipTransfers).toEqual([
      expect.objectContaining({
        organizationId: organization.id,
        actorId: "owner",
        targetActorId: "next-owner",
      }),
    ]);
  });

  it("suspende y revoca una membresía sin borrar su autoría ni mantener acceso", async () => {
    const { service } = createTenantService();
    const organization = await service.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "A",
      timezone: "UTC",
      locale: "es-CL",
    });
    const invitation = await service.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "member@example.test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await service.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "member",
      actorEmail: "member@example.test",
    });
    await service.changeMembershipStatus({
      actorId: "owner",
      organizationId: organization.id,
      targetActorId: "member",
      status: "suspended",
      correlationId: "00000000-0000-4000-8000-000000000101",
    });
    await expect(
      service.capabilities({
        actorId: "member",
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({ canReadOrganization: false });
    await expect(service.listOrganizations("member")).resolves.toEqual([]);
    await service.changeMembershipStatus({
      actorId: "owner",
      organizationId: organization.id,
      targetActorId: "member",
      status: "revoked",
      correlationId: "00000000-0000-4000-8000-000000000102",
    });
  });

  it("resuelve políticas heredadas, permite overrides acotados y conserva auditoría", async () => {
    const { service, store } = createTenantService();
    const organization = await service.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Políticas",
      timezone: "UTC",
      locale: "es-CL",
      policy: { dataResidencyRegion: "cl", retentionDays: 365 },
      correlationId: "00000000-0000-4000-8000-000000000103",
    });
    const workspace = await service.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Operación",
      mode: "institutional",
    });
    await expect(
      service.getEffectivePolicy({
        actorId: "owner",
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({
      dataResidencyRegion: { value: "cl", origin: "organization" },
      retentionDays: { value: 365, origin: "organization" },
      workspaceOverride: null,
    });
    await service.setWorkspacePolicyOverride({
      actorId: "owner",
      organizationId: organization.id,
      workspaceId: workspace.id,
      dataResidencyRegion: "eu",
      retentionDays: null,
      correlationId: "00000000-0000-4000-8000-000000000104",
    });
    await expect(
      service.getEffectivePolicy({
        actorId: "owner",
        organizationId: organization.id,
        workspaceId: workspace.id,
      }),
    ).resolves.toMatchObject({
      dataResidencyRegion: { value: "eu", origin: "workspace" },
      retentionDays: { value: 365, origin: "organization" },
      workspaceOverride: { dataResidencyRegion: "eu", retentionDays: null },
    });
    const memberInvitation = await service.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "member@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await service.acceptInvitation({
      token: memberInvitation.deliveryToken,
      actorId: "member",
      actorEmail: "member@example.test",
    });
    await expect(
      service.updateOrganizationPolicy({
        actorId: "member",
        organizationId: organization.id,
        dataResidencyRegion: "us",
        retentionDays: 30,
        correlationId: "00000000-0000-4000-8000-000000000105",
      }),
    ).rejects.toMatchObject({ action: "organization-policy:manage" });
    await service.clearWorkspacePolicyOverride({
      actorId: "owner",
      organizationId: organization.id,
      workspaceId: workspace.id,
      correlationId: "00000000-0000-4000-8000-000000000106",
    });
    expect(store.policyAuditEvents.map((event) => event.eventType)).toEqual([
      "organization.policy_configured.v1",
      "workspace.policy_override_set.v1",
      "workspace.policy_override_cleared.v1",
    ]);
  });
});
