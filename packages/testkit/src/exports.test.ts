import { describe, expect, it } from "vitest";
import { ExportService } from "@aether/application";
import { InMemoryExportJobStore } from "./exports.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("export jobs", () => {
  it("crea y lista una exportación de auditoría solicitada por gestión", async () => {
    const organizationId = "00000000-0000-4000-8000-000000000201";
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
    const store = new InMemoryExportJobStore();
    const service = new ExportService({
      store,
      tenancy,
      ids: { next: () => "00000000-0000-4000-8000-000000000202" },
      clock: { now: () => new Date("2026-09-17T16:00:00.000Z") },
    });
    const job = await service.request({
      actorId: "owner",
      organizationId,
      scope: "organization_audit",
    });
    expect(job).toMatchObject({ status: "requested", objectKey: null });
    await expect(
      service.list({ actorId: "owner", organizationId }),
    ).resolves.toEqual([job]);
  });
});
