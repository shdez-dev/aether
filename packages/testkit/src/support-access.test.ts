import { describe, expect, it } from "vitest";

import {
  SupportAccessGrantError,
  SupportAccessService,
  TenantService,
} from "@aether/application";

import {
  InMemorySupportAccessGrantStore,
  InMemorySupportOperatorDirectory,
} from "./support-access.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("SupportAccessService", () => {
  it("requiere aprobación separada, audita cada diagnóstico y revoca inmediatamente", async () => {
    let now = new Date("2026-09-15T18:00:00.000Z");
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const tenantStore = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenantStore,
      ids,
      tokens: { generate: () => "s".repeat(43), hash: (value) => value },
      clock: { now: () => now },
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@example.test",
      name: "Support JIT",
      timezone: "UTC",
      locale: "es-CL",
    });
    const store = new InMemorySupportAccessGrantStore();
    store.addOrganization(organization.id, {
      workspaces: { active: 2, archived: 1 },
      memberships: { active: 3, suspended: 1, revoked: 0 },
      delivery: { pendingOutboxEvents: 1, deadLetters: 0 },
      policyConfigured: true,
    });
    const eligibleOperators = new Set(["support-operator"]);
    const service = new SupportAccessService({
      store,
      operators: new InMemorySupportOperatorDirectory(eligibleOperators),
      tenancy: tenantStore,
      ids,
      clock: { now: () => now },
    });

    const requested = await service.request({
      actorId: "support-operator",
      organizationId: organization.id,
      reason: "Investigar atraso de entrega",
      expiresInMinutes: 30,
      correlationId: ids.next(),
    });
    expect(service.status(requested)).toBe("pending");
    await expect(
      service.diagnose({
        actorId: "support-operator",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "SUPPORT_ACCESS_DENIED" });
    await expect(
      service.approve({
        actorId: "support-operator",
        organizationId: organization.id,
        grantId: requested.id,
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({
      code: "SUPPORT_ACCESS_SEPARATION_OF_DUTIES",
    });

    const approved = await service.approve({
      actorId: "owner",
      organizationId: organization.id,
      grantId: requested.id,
      correlationId: ids.next(),
    });
    expect(service.status(approved)).toBe("active");
    await expect(
      service.diagnose({
        actorId: "support-operator",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).resolves.toEqual({
      organizationId: organization.id,
      generatedAt: now,
      workspaces: { active: 2, archived: 1 },
      memberships: { active: 3, suspended: 1, revoked: 0 },
      delivery: { pendingOutboxEvents: 1, deadLetters: 0 },
      policyConfigured: true,
    });
    eligibleOperators.delete("support-operator");
    await expect(
      service.diagnose({
        actorId: "support-operator",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "SUPPORT_OPERATOR_NOT_ELIGIBLE" });
    eligibleOperators.add("support-operator");

    await service.revoke({
      actorId: "support-operator",
      organizationId: organization.id,
      grantId: approved.id,
      reason: "Diagnóstico terminado",
      correlationId: ids.next(),
    });
    await expect(
      service.diagnose({
        actorId: "support-operator",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "SUPPORT_ACCESS_DENIED" });
    expect(store.auditEvents.map((event) => event.eventType)).toEqual([
      "support_access_grant.requested.v1",
      "support_access_grant.approved.v1",
      "support_access_grant.used.v1",
      "support_access_grant.revoked.v1",
    ]);

    const expiring = await service.request({
      actorId: "support-operator",
      organizationId: organization.id,
      reason: "Verificación corta",
      expiresInMinutes: 1,
      correlationId: ids.next(),
    });
    await service.approve({
      actorId: "owner",
      organizationId: organization.id,
      grantId: expiring.id,
      correlationId: ids.next(),
    });
    now = new Date("2026-09-15T18:02:00.000Z");
    await expect(
      service.diagnose({
        actorId: "support-operator",
        organizationId: organization.id,
        correlationId: ids.next(),
      }),
    ).rejects.toMatchObject({ code: "SUPPORT_ACCESS_DENIED" });
    expect(
      store.auditEvents.filter(
        (event) =>
          event.grantId === expiring.id &&
          event.eventType === "support_access_grant.expired.v1",
      ),
    ).toHaveLength(1);
  });

  it("rechaza operadores no elegibles y duraciones mayores a una hora", async () => {
    const store = new InMemorySupportAccessGrantStore();
    const organizationId = "00000000-0000-4000-8000-000000000001";
    store.addOrganization(organizationId);
    const service = new SupportAccessService({
      store,
      operators: new InMemorySupportOperatorDirectory(new Set(["support"])),
      tenancy: new InMemoryTenantStore(),
      ids: { next: () => crypto.randomUUID() },
      clock: { now: () => new Date("2026-09-15T18:00:00.000Z") },
    });
    await expect(
      service.request({
        actorId: "unknown",
        organizationId,
        reason: "Intento",
        expiresInMinutes: 30,
        correlationId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SUPPORT_OPERATOR_NOT_ELIGIBLE" });
    await expect(
      service.request({
        actorId: "support",
        organizationId,
        reason: "Duración excesiva",
        expiresInMinutes: 61,
        correlationId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(SupportAccessGrantError);
  });
});
