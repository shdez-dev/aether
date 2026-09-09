import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  ResourceNotFoundError,
  TenantService,
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
});
