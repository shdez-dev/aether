import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  InitiativeService,
  InitiativeVersionConflictError,
  TenantService,
} from "@aether/application";

import {
  InMemoryInitiativeAuditStore,
  InMemoryInitiativeStore,
} from "./initiatives.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("initiative vertical slice", () => {
  it("autoriza creador, reviewer y decision maker de forma explícita y auditable", async () => {
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const tenantStore = new InMemoryTenantStore();
    const tokens = {
      generate: () => `token-${++sequence}`.padEnd(43, "x"),
      hash: (value: string) => `hash:${value}`,
    };
    const clock = { now: () => new Date("2026-09-09T12:00:00.000Z") };
    const tenants = new TenantService({
      store: tenantStore,
      ids,
      tokens,
      clock,
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Org",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Ideas",
      mode: "team",
    });
    const authorInvite = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "author@example.test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "member",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: authorInvite.deliveryToken,
      actorId: "author",
      actorEmail: "author@example.test",
    });
    const reviewerInvite = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "reviewer@example.test",
      organizationRole: "admin",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: reviewerInvite.deliveryToken,
      actorId: "reviewer",
      actorEmail: "reviewer@example.test",
    });

    const audit = new InMemoryInitiativeAuditStore();
    const initiatives = new InitiativeService({
      store: new InMemoryInitiativeStore(),
      audit,
      tenancy: tenantStore,
      ids,
      clock,
    });
    const created = await initiatives.create({
      actorId: "author",
      organizationId: organization.id,
      workspaceId: workspace.id,
      correlationId: ids.next(),
      title: "Reducir tiempos",
      problemStatement: "Proceso lento",
      expectedOutcome: "Menos tiempo",
      classification: "internal",
    });
    const edited = await initiatives.edit({
      actorId: "author",
      organizationId: organization.id,
      initiativeId: created.id,
      correlationId: ids.next(),
      expectedVersion: 0,
      title: "Reducir tiempos de respuesta",
      problemStatement: "Proceso lento",
      expectedOutcome: "Menos tiempo",
      classification: "internal",
    });
    await expect(
      initiatives.present({
        actorId: "author",
        organizationId: organization.id,
        initiativeId: created.id,
        correlationId: ids.next(),
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(InitiativeVersionConflictError);
    const presented = await initiatives.present({
      actorId: "author",
      organizationId: organization.id,
      initiativeId: created.id,
      correlationId: ids.next(),
      expectedVersion: edited.version,
    });
    const reviewing = await initiatives.startReview({
      actorId: "reviewer",
      organizationId: organization.id,
      initiativeId: created.id,
      correlationId: ids.next(),
      expectedVersion: presented.version,
    });
    await expect(
      initiatives.decide({
        actorId: "reviewer",
        organizationId: organization.id,
        initiativeId: created.id,
        correlationId: ids.next(),
        expectedVersion: reviewing.version,
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    const decided = await initiatives.decide({
      actorId: "owner",
      organizationId: organization.id,
      initiativeId: created.id,
      correlationId: ids.next(),
      expectedVersion: reviewing.version,
      decision: "approved",
    });
    expect(decided.status).toBe("approved");
    expect(
      (
        await initiatives.auditTrail({
          actorId: "owner",
          organizationId: organization.id,
          initiativeId: created.id,
        })
      ).map((event) => event.eventType),
    ).toEqual([
      "initiative.created.v1",
      "initiative.edited.v1",
      "initiative.presented.v1",
      "initiative.review_started.v1",
      "initiative.decided.v1",
    ]);
  });
});
