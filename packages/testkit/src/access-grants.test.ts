import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  TemporaryAccessGrantError,
  TemporaryAccessGrantService,
  TenantService,
} from "@aether/application";

import { InMemoryTemporaryAccessGrantStore } from "./access-grants.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("TemporaryAccessGrantService", () => {
  it("solicita, aprueba, usa y revoca un grant exacto con separación de funciones", async () => {
    let now = new Date("2026-09-15T12:00:00.000Z");
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const tenancyStore = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenancyStore,
      ids,
      tokens: { generate: () => "x".repeat(43), hash: (value) => value },
      clock: { now: () => now },
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Acceso temporal",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Diagnóstico",
      mode: "institutional",
    });
    const invitation = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "requester@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "viewer",
      expiresInDays: 1,
    });
    await tenants.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "requester",
      actorEmail: "requester@example.test",
    });
    const store = new InMemoryTemporaryAccessGrantStore();
    const projectId = ids.next();
    store.addResource({
      resourceType: "project",
      resourceId: projectId,
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    const service = new TemporaryAccessGrantService({
      store,
      resources: store,
      tenancy: tenancyStore,
      ids,
      clock: { now: () => now },
    });

    const requested = await service.request({
      actorId: "requester",
      organizationId: organization.id,
      workspaceId: workspace.id,
      resourceType: "project",
      resourceId: projectId,
      action: "read",
      granteeActorId: "external-reviewer",
      reason: "Revisión puntual del proyecto",
      expiresInMinutes: 60,
      correlationId: ids.next(),
    });
    expect(service.status(requested)).toBe("pending");
    await expect(
      service.authorize({
        actorId: "external-reviewer",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "project",
        resourceId: projectId,
        action: "read",
        correlationId: ids.next(),
      }),
    ).resolves.toBe(false);
    await expect(
      service.approve({
        actorId: "requester",
        organizationId: organization.id,
        grantId: requested.id,
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "GRANT_SEPARATION_OF_DUTIES" });

    const approved = await service.approve({
      actorId: "owner",
      organizationId: organization.id,
      grantId: requested.id,
      correlationId: ids.next(),
    });
    expect(service.status(approved)).toBe("active");
    await expect(
      service.authorize({
        actorId: "external-reviewer",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "project",
        resourceId: projectId,
        action: "read",
        correlationId: ids.next(),
      }),
    ).resolves.toBe(true);
    await expect(
      service.authorize({
        actorId: "external-reviewer",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "project",
        resourceId: projectId,
        action: "contribute",
        correlationId: ids.next(),
      }),
    ).resolves.toBe(false);
    const externalInvitation = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "external-reviewer@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "viewer",
      expiresInDays: 1,
    });
    await tenants.acceptInvitation({
      token: externalInvitation.deliveryToken,
      actorId: "external-reviewer",
      actorEmail: "external-reviewer@example.test",
    });
    await tenants.changeMembershipStatus({
      actorId: "owner",
      organizationId: organization.id,
      targetActorId: "external-reviewer",
      status: "revoked",
      correlationId: ids.next(),
    });
    await expect(
      service.authorize({
        actorId: "external-reviewer",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "project",
        resourceId: projectId,
        action: "read",
        correlationId: ids.next(),
      }),
    ).resolves.toBe(false);

    const revoked = await service.revoke({
      actorId: "external-reviewer",
      organizationId: organization.id,
      grantId: approved.id,
      reason: "Revisión concluida",
      correlationId: ids.next(),
    });
    expect(service.status(revoked)).toBe("revoked");
    await expect(
      service.authorize({
        actorId: "external-reviewer",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "project",
        resourceId: projectId,
        action: "read",
        correlationId: ids.next(),
      }),
    ).resolves.toBe(false);
    expect(store.auditEvents.map((event) => event.eventType)).toEqual([
      "temporary_access_grant.requested.v1",
      "temporary_access_grant.approved.v1",
      "temporary_access_grant.used.v1",
      "temporary_access_grant.revoked.v1",
    ]);

    const expiring = await service.request({
      actorId: "requester",
      organizationId: organization.id,
      workspaceId: workspace.id,
      resourceType: "project",
      resourceId: projectId,
      action: "read",
      granteeActorId: "external-reviewer",
      reason: "Segunda revisión",
      expiresInMinutes: 1,
      correlationId: ids.next(),
    });
    await service.approve({
      actorId: "owner",
      organizationId: organization.id,
      grantId: expiring.id,
      correlationId: ids.next(),
    });
    now = new Date("2026-09-15T12:02:00.000Z");
    await expect(
      service.authorize({
        actorId: "external-reviewer",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "project",
        resourceId: projectId,
        action: "read",
        correlationId: ids.next(),
      }),
    ).resolves.toBe(false);
    expect(
      store.auditEvents.filter(
        (event) =>
          event.grantId === expiring.id &&
          event.eventType === "temporary_access_grant.expired.v1",
      ),
    ).toHaveLength(1);
  });

  it("rechaza recursos de otro scope y aprobadores que no son owner", async () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    let sequence = 100;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const tenancyStore = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenancyStore,
      ids,
      tokens: { generate: () => "y".repeat(43), hash: (value) => value },
      clock: { now: () => now },
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "A",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "A",
      mode: "team",
    });
    const store = new InMemoryTemporaryAccessGrantStore();
    const service = new TemporaryAccessGrantService({
      store,
      resources: store,
      tenancy: tenancyStore,
      ids,
      clock: { now: () => now },
    });
    store.addResource({
      resourceType: "project",
      resourceId: ids.next(),
      organizationId: ids.next(),
      workspaceId: ids.next(),
    });
    await expect(
      service.request({
        actorId: "owner",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "project",
        resourceId: [...store.resources.keys()][0]!.split(":")[1]!,
        action: "read",
        granteeActorId: "reviewer",
        reason: "Scope ajeno",
        expiresInMinutes: 60,
        correlationId: ids.next(),
      }),
    ).rejects.toBeInstanceOf(TemporaryAccessGrantError);

    const projectId = ids.next();
    store.addResource({
      resourceType: "project",
      resourceId: projectId,
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    await expect(
      service.request({
        actorId: "owner",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "project",
        resourceId: projectId,
        action: "read",
        granteeActorId: "reviewer",
        reason: "Duración inválida",
        expiresInMinutes: 481,
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "GRANT_INVALID_REQUEST" });
    const requested = await service.request({
      actorId: "owner",
      organizationId: organization.id,
      workspaceId: workspace.id,
      resourceType: "project",
      resourceId: projectId,
      action: "read",
      granteeActorId: "reviewer",
      reason: "Revisión",
      expiresInMinutes: 60,
      correlationId: ids.next(),
    });
    await expect(
      service.approve({
        actorId: "reviewer",
        organizationId: organization.id,
        grantId: requested.id,
        correlationId: ids.next(),
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
