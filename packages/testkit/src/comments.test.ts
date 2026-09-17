import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  CommentService,
  NotificationService,
  TenantService,
} from "@aether/application";

import { InMemoryCommentStore } from "./comments.js";
import {
  InMemoryDocumentProjectAccess,
  InMemoryDocumentStore,
} from "./documents.js";
import { FixedClock } from "./fixed-clock.js";
import { InMemoryNotificationStore } from "./notifications.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("comments", () => {
  it("hereda la visibilidad del proyecto para comentar, mencionar y resolver", async () => {
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const clock = new FixedClock(new Date("2026-09-17T14:00:00.000Z"));
    const tenancy = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenancy,
      ids,
      tokens: { generate: () => "x".repeat(43), hash: (value) => value },
      clock,
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
    const projectId = ids.next();
    const resources = new InMemoryDocumentStore();
    resources.addResource("project", projectId, {
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    const projects = new InMemoryDocumentProjectAccess();
    const notifications = new NotificationService({
      store: new InMemoryNotificationStore(),
      tenancy,
      projects,
      ids,
      clock,
    });
    const store = new InMemoryCommentStore();
    const comments = new CommentService({
      store,
      resources,
      tenancy,
      projects,
      notifications,
      ids,
      clock,
    });
    const command = {
      actorId: "owner",
      resourceType: "project" as const,
      resourceId: projectId,
      body: "Revisar el hito antes de cerrar.",
      mentionedActorIds: ["member"],
      correlationId: ids.next(),
    };

    await expect(comments.create(command)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    projects.grant(projectId, "member");
    const comment = await comments.create(command);

    await expect(
      comments.list({
        actorId: "member",
        resourceType: "project",
        resourceId: projectId,
      }),
    ).resolves.toEqual([comment]);
    await expect(
      notifications.inbox({
        actorId: "member",
        organizationId: organization.id,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      comments.resolve({
        actorId: "member",
        commentId: comment.id,
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject({ resolvedByActorId: "member" });
    await expect(
      comments.resolve({
        actorId: "member",
        commentId: comment.id,
        reopen: true,
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject({ resolvedAt: null, resolvedByActorId: null });
    await expect(
      comments.edit({
        actorId: "owner",
        commentId: comment.id,
        body: "Hito revisado.",
        correlationId: ids.next(),
      }),
    ).resolves.toMatchObject({
      body: "Hito revisado.",
      editedAt: expect.any(Date),
    });
    await expect(
      comments.delete({
        actorId: "owner",
        commentId: comment.id,
        correlationId: ids.next(),
      }),
    ).resolves.toBeUndefined();
    expect(store.audits.map((event) => event.eventType)).toEqual([
      "comment.created.v1",
      "comment.resolved.v1",
      "comment.reopened.v1",
      "comment.edited.v1",
      "comment.deleted.v1",
    ]);

    projects.participants.delete(`${projectId}:member`);
    await expect(
      comments.list({
        actorId: "member",
        resourceType: "project",
        resourceId: projectId,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
