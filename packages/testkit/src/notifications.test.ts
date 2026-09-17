import { describe, expect, it } from "vitest";

import { NotificationService, TenantService } from "@aether/application";

import { FixedClock } from "./fixed-clock.js";
import { nextTestId } from "./ids.js";
import { InMemoryNotificationStore } from "./notifications.js";
import { InMemoryDocumentProjectAccess } from "./documents.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("notifications", () => {
  it("deduplica por destinatario y evento sin modificar la notificación original", async () => {
    const organizationId = nextTestId();
    const workspaceId = nextTestId();
    const store = new InMemoryNotificationStore();
    const tenancy = new InMemoryTenantStore();
    await tenancy.bootstrapOrganization({
      organization: {
        id: organizationId,
        name: "Aether",
        organizationType: null,
        timezone: "UTC",
        locale: "es-CL",
        version: 0,
      },
      ownerActorId: "owner",
      ownerEmail: "owner@example.test",
    });
    await tenancy.createWorkspace({
      id: workspaceId,
      organizationId,
      name: "Operaciones",
      mode: "institutional",
      version: 0,
      status: "active",
      archivedAt: null,
      archivedByActorId: null,
    });
    const service = new NotificationService({
      store,
      tenancy,
      ids: { next: nextTestId },
      clock: new FixedClock(new Date("2026-09-17T12:00:00.000Z")),
    });
    const input = {
      organizationId,
      workspaceId,
      recipientActorId: "owner",
      eventKey: "comment.mentioned.v1:comment-1:owner",
      resourceType: "project" as const,
      resourceId: nextTestId(),
      title: "Te mencionaron en una conversación",
    };

    const first = await service.notify(input);
    const duplicate = await service.notify(input);

    expect(duplicate).toEqual(first);
    await expect(
      service.inbox({ actorId: "owner", organizationId }),
    ).resolves.toEqual([first]);
    await expect(
      service.read({ actorId: "owner", notificationId: first.id }),
    ).resolves.toMatchObject({ id: first.id, readAt: expect.any(Date) });
    await service.setEmailPreference({
      actorId: "owner",
      organizationId,
      emailEnabled: false,
    });
    await expect(
      store.getPreference({ actorId: "owner", organizationId }),
    ).resolves.toMatchObject({ emailEnabled: false });
  });

  it("oculta la notificación de proyecto al perder la participación", async () => {
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const tenancy = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenancy,
      ids,
      tokens: { generate: () => "x".repeat(43), hash: (value) => value },
      clock: new FixedClock(new Date("2026-09-17T12:00:00.000Z")),
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Aether",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Operaciones",
      mode: "institutional",
    });
    const invitation = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "member@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "member",
      actorEmail: "member@example.test",
    });
    const projects = new InMemoryDocumentProjectAccess();
    const projectId = ids.next();
    projects.grant(projectId, "member");
    const service = new NotificationService({
      store: new InMemoryNotificationStore(),
      tenancy,
      projects,
      ids,
      clock: new FixedClock(new Date("2026-09-17T12:00:00.000Z")),
    });
    const notification = await service.notify({
      organizationId: organization.id,
      workspaceId: workspace.id,
      recipientActorId: "member",
      eventKey: `project.updated.v1:${projectId}:member`,
      resourceType: "project",
      resourceId: projectId,
      title: "Actualización disponible",
    });
    await expect(
      service.inbox({ actorId: "member", organizationId: organization.id }),
    ).resolves.toEqual([notification]);

    projects.participants.delete(`${projectId}:member`);

    await expect(
      service.inbox({ actorId: "member", organizationId: organization.id }),
    ).resolves.toEqual([]);
  });
});
