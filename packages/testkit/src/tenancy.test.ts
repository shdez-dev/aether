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
  const store = new InMemoryTenantStore();
  const service = new TenantService({
    store,
    ids: {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    },
    tokens: {
      generate: () => "x".repeat(43),
      hash: (value) => `hash:${value}`,
    },
    clock: { now: () => now },
  });
  return { service, store };
}

describe("TenantService", () => {
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
    ).rejects.toBeInstanceOf(AccessDeniedError);
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
    ).rejects.toBeInstanceOf(AccessDeniedError);
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
});
