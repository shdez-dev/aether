import { describe, expect, it } from "vitest";
import {
  DocumentAccessDeniedError,
  DocumentService,
  DocumentScanService,
  DocumentValidationError,
  TenantService,
  WorkerEventAuthorizationError,
} from "@aether/application";
import {
  InMemoryDocumentObjectStore,
  InMemoryDocumentProjectAccess,
  InMemoryDocumentStore,
} from "./documents.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("document evidence slice", () => {
  it("mantiene el binario en cuarentena, publica sólo contenido verificado y aísla organizaciones", async () => {
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const clock = { now: () => new Date("2026-09-10T12:00:00.000Z") };
    const tenancy = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenancy,
      ids,
      tokens: { generate: () => "x".repeat(43), hash: (value) => value },
      clock,
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@test",
      name: "Org",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Evidence",
      mode: "team",
    });
    const foreign = await tenants.createOrganization({
      actorId: "foreign",
      actorEmail: "foreign@test",
      name: "Foreign",
      timezone: "UTC",
      locale: "es-CL",
    });
    const otherWorkspaceMember = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "other-workspace@test",
      organizationRole: "member",
      workspaceIds: [],
      workspaceRole: "viewer",
      expiresInDays: 7,
    });
    await tenants.acceptInvitation({
      token: otherWorkspaceMember.deliveryToken,
      actorId: "other-workspace-member",
      actorEmail: "other-workspace@test",
    });
    const store = new InMemoryDocumentStore();
    const objects = new InMemoryDocumentObjectStore();
    const initiativeId = ids.next();
    store.addResource("initiative", initiativeId, {
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    const documents = new DocumentService({
      store,
      audit: store,
      objects,
      tenancy,
      ids,
      clock,
      maxBytes: 1_000_000,
      urlTtlSeconds: 300,
    });
    const checksum = "a".repeat(64);
    const started = await documents.beginUpload({
      actorId: "owner",
      correlationId: ids.next(),
      resourceType: "initiative",
      resourceId: initiativeId,
      classification: "confidential",
      fileName: "evidence.pdf",
      contentType: "application/pdf",
      contentLength: 42,
      sha256: checksum,
    });
    expect(started.version.status).toBe("quarantined");
    expect(objects.published.size).toBe(0);
    objects.putQuarantined(started.version.quarantineKey, {
      bytes: 42,
      sha256: checksum,
      contentType: "application/pdf",
    });
    const published = await documents.completeUpload({
      actorId: "owner",
      correlationId: ids.next(),
      documentId: started.document.id,
      versionId: started.version.id,
    });
    expect(published.version.status).toBe("pending_scan");
    const scans = new DocumentScanService({
      store,
      audit: store,
      objects,
      scanner: {
        async scan() {
          return { clean: true, signature: null };
        },
      },
      ids,
      clock,
      retentionDays: { internal: 365, confidential: 1095, restricted: 2555 },
    });
    await expect(
      scans.handle({
        ...store.events[0]!,
        organizationId: foreign.id,
      }),
    ).rejects.toBeInstanceOf(WorkerEventAuthorizationError);
    expect(
      (
        await store.findVersion({
          documentId: started.document.id,
          versionId: started.version.id,
        })
      )?.version.status,
    ).toBe("pending_scan");
    await scans.handle(store.events[0]!);
    const complete = await store.findVersion({
      documentId: started.document.id,
      versionId: started.version.id,
    });
    expect(complete?.version.status).toBe("published");
    const download = await documents.download({
      actorId: "owner",
      correlationId: ids.next(),
      documentId: started.document.id,
      versionId: started.version.id,
    });
    expect(new URL(download.url).searchParams.get("expires")).toBe(
      String(download.expiresAt.getTime()),
    );
    await expect(
      documents.download({
        actorId: "foreign",
        correlationId: ids.next(),
        documentId: started.document.id,
        versionId: started.version.id,
      }),
    ).rejects.toBeInstanceOf(DocumentAccessDeniedError);
    await expect(
      documents.download({
        actorId: "other-workspace-member",
        correlationId: ids.next(),
        documentId: started.document.id,
        versionId: started.version.id,
      }),
    ).rejects.toBeInstanceOf(DocumentAccessDeniedError);
    expect(foreign.id).not.toBe(organization.id);
    expect(store.audits.map((event) => event.eventType)).toEqual([
      "document.upload_started.v1",
      "document.scan_queued.v1",
      "document.published.v1",
      "document.download_url_issued.v1",
    ]);
    const replacement = await documents.beginReplacement({
      actorId: "owner",
      correlationId: ids.next(),
      documentId: started.document.id,
      replacedVersionId: started.version.id,
      fileName: "evidence-v2.pdf",
      contentType: "application/pdf",
      contentLength: 42,
      sha256: "f".repeat(64),
    });
    objects.putQuarantined(replacement.version.quarantineKey, {
      bytes: 42,
      sha256: "f".repeat(64),
      contentType: "application/pdf",
    });
    await documents.completeUpload({
      actorId: "owner",
      correlationId: ids.next(),
      documentId: started.document.id,
      versionId: replacement.version.id,
    });
    await scans.handle(store.events[1]!);
    expect(store.versions.get(started.version.id)?.status).toBe("superseded");
    expect(store.versions.get(replacement.version.id)?.status).toBe(
      "published",
    );
    const restored = await documents.restoreVersion({
      actorId: "owner",
      correlationId: ids.next(),
      documentId: started.document.id,
      versionId: started.version.id,
    });
    expect(restored.version.status).toBe("pending_scan");
    await scans.handle(store.events[2]!);
    expect(store.versions.get(replacement.version.id)?.status).toBe(
      "superseded",
    );
    expect(store.versions.get(restored.version.id)?.sha256).toBe(checksum);
    expect(store.versions.get(restored.version.id)?.status).toBe("published");
    const retained = store.versions.get(started.version.id)!;
    store.versions.set(retained.id, {
      ...retained,
      retentionUntil: new Date("2026-09-09T00:00:00.000Z"),
    });
    await expect(scans.purgeExpired()).resolves.toBe(1);
    expect(store.versions.get(retained.id)?.status).toBe("purged");
    expect(objects.published.size).toBe(2);
  });
  it("rechaza antes de publicar cuando checksum o MIME no coinciden", async () => {
    const ids = {
      next: (() => {
        let n = 0;
        return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      })(),
    };
    const clock = { now: () => new Date("2026-09-10T12:00:00.000Z") };
    const tenancy = new InMemoryTenantStore();
    await tenancy.bootstrapOrganization({
      organization: {
        id: ids.next(),
        name: "Org",
        organizationType: null,
        timezone: "UTC",
        locale: "es",
        version: 0,
      },
      ownerActorId: "owner",
      ownerEmail: "x@test",
    });
    const workspaceId = ids.next();
    await tenancy.createWorkspace({
      id: workspaceId,
      organizationId: [...tenancy.organizations.keys()][0]!,
      name: "W",
      mode: "team",
      version: 0,
      status: "active",
      archivedAt: null,
      archivedByActorId: null,
    });
    const store = new InMemoryDocumentStore();
    const objects = new InMemoryDocumentObjectStore();
    const resourceId = ids.next();
    store.addResource("initiative", resourceId, {
      organizationId: [...tenancy.organizations.keys()][0]!,
      workspaceId,
    });
    const service = new DocumentService({
      store,
      audit: store,
      objects,
      tenancy,
      ids,
      clock,
      maxBytes: 1_000,
      urlTtlSeconds: 60,
    });
    const started = await service.beginUpload({
      actorId: "owner",
      correlationId: ids.next(),
      resourceType: "initiative",
      resourceId,
      classification: "internal",
      fileName: "wrong.pdf",
      contentType: "application/pdf",
      contentLength: 5,
      sha256: "b".repeat(64),
    });
    objects.putQuarantined(started.version.quarantineKey, {
      bytes: 5,
      sha256: "c".repeat(64),
      contentType: "text/plain",
    });
    await expect(
      service.completeUpload({
        actorId: "owner",
        correlationId: ids.next(),
        documentId: started.document.id,
        versionId: started.version.id,
      }),
    ).rejects.toBeInstanceOf(DocumentValidationError);
    expect(objects.published.size).toBe(0);
    expect(
      (
        await store.findVersion({
          documentId: started.document.id,
          versionId: started.version.id,
        })
      )?.version.status,
    ).toBe("rejected");
  });
  it("bloquea extensiones falsas y conserva la evidencia infectada fuera del área publicada", async () => {
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const clock = { now: () => new Date("2026-09-10T12:00:00.000Z") };
    const tenancy = new InMemoryTenantStore();
    const organization = {
      id: ids.next(),
      name: "Org",
      organizationType: null,
      timezone: "UTC",
      locale: "es",
      version: 0,
    };
    await tenancy.bootstrapOrganization({
      organization,
      ownerActorId: "owner",
      ownerEmail: "owner@test",
    });
    const workspaceId = ids.next();
    await tenancy.createWorkspace({
      id: workspaceId,
      organizationId: organization.id,
      name: "W",
      mode: "team",
      version: 0,
      status: "active",
      archivedAt: null,
      archivedByActorId: null,
    });
    const store = new InMemoryDocumentStore();
    const objects = new InMemoryDocumentObjectStore();
    const resourceId = ids.next();
    store.addResource("initiative", resourceId, {
      organizationId: organization.id,
      workspaceId,
    });
    const service = new DocumentService({
      store,
      audit: store,
      objects,
      tenancy,
      ids,
      clock,
      maxBytes: 100,
      urlTtlSeconds: 60,
    });
    await expect(
      service.beginUpload({
        actorId: "owner",
        correlationId: ids.next(),
        resourceType: "initiative",
        resourceId,
        classification: "internal",
        fileName: "disfrazado.png",
        contentType: "application/pdf",
        contentLength: 10,
        sha256: "d".repeat(64),
      }),
    ).rejects.toBeInstanceOf(DocumentValidationError);
    const started = await service.beginUpload({
      actorId: "owner",
      correlationId: ids.next(),
      resourceType: "initiative",
      resourceId,
      classification: "internal",
      fileName: "eicar.txt",
      contentType: "text/plain",
      contentLength: 10,
      sha256: "e".repeat(64),
    });
    objects.putQuarantined(started.version.quarantineKey, {
      bytes: 10,
      sha256: "e".repeat(64),
      contentType: "text/plain",
    });
    await service.completeUpload({
      actorId: "owner",
      correlationId: ids.next(),
      documentId: started.document.id,
      versionId: started.version.id,
    });
    const scans = new DocumentScanService({
      store,
      audit: store,
      objects,
      scanner: {
        async scan() {
          return { clean: false, signature: "Eicar-Test-Signature" };
        },
      },
      ids,
      clock,
      retentionDays: { internal: 1, confidential: 1, restricted: 1 },
    });
    await scans.handle(store.events[0]!);
    expect(
      (
        await store.findVersion({
          documentId: started.document.id,
          versionId: started.version.id,
        })
      )?.version.status,
    ).toBe("rejected");
    expect(objects.published.size).toBe(0);
    expect(store.audits.at(-1)?.eventType).toBe("document.malware_rejected.v1");
  });
  it("impide descargar el documento de un proyecto ajeno dentro del mismo workspace", async () => {
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const clock = { now: () => new Date("2026-09-12T12:00:00.000Z") };
    const tenancy = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenancy,
      ids,
      tokens: { generate: () => "x".repeat(43), hash: (value) => value },
      clock,
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@test",
      name: "Org",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Equipo",
      mode: "team",
    });
    const invitation = await tenants.invite({
      actorId: "owner",
      organizationId: organization.id,
      email: "member@test",
      organizationRole: "member",
      workspaceIds: [workspace.id],
      workspaceRole: "member",
      expiresInDays: 1,
    });
    await tenants.acceptInvitation({
      token: invitation.deliveryToken,
      actorId: "member",
      actorEmail: "member@test",
    });
    const store = new InMemoryDocumentStore();
    const objects = new InMemoryDocumentObjectStore();
    const projectAccess = new InMemoryDocumentProjectAccess();
    const projectId = ids.next();
    store.addResource("project", projectId, {
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    const service = new DocumentService({
      store,
      audit: store,
      objects,
      tenancy,
      projectAccess,
      ids,
      clock,
      maxBytes: 1_000,
      urlTtlSeconds: 60,
    });
    const started = await service.beginUpload({
      actorId: "owner",
      correlationId: ids.next(),
      resourceType: "project",
      resourceId: projectId,
      classification: "internal",
      fileName: "entrega.pdf",
      contentType: "application/pdf",
      contentLength: 10,
      sha256: "f".repeat(64),
    });
    objects.putQuarantined(started.version.quarantineKey, {
      bytes: 10,
      sha256: "f".repeat(64),
      contentType: "application/pdf",
    });
    await service.completeUpload({
      actorId: "owner",
      correlationId: ids.next(),
      documentId: started.document.id,
      versionId: started.version.id,
    });
    await new DocumentScanService({
      store,
      audit: store,
      objects,
      scanner: {
        async scan() {
          return { clean: true, signature: null };
        },
      },
      ids,
      clock,
      retentionDays: { internal: 1, confidential: 1, restricted: 1 },
    }).handle(store.events[0]!);
    await expect(
      service.download({
        actorId: "member",
        correlationId: ids.next(),
        documentId: started.document.id,
        versionId: started.version.id,
      }),
    ).rejects.toBeInstanceOf(DocumentAccessDeniedError);
    projectAccess.grant(projectId, "member");
    await expect(
      service.download({
        actorId: "member",
        correlationId: ids.next(),
        documentId: started.document.id,
        versionId: started.version.id,
      }),
    ).resolves.toEqual(expect.objectContaining({ url: expect.any(String) }));
  });
  it("reubica sólo dentro del mismo workspace y conserva los bloqueos de trazabilidad", async () => {
    let sequence = 0;
    const ids = {
      next: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    };
    const clock = { now: () => new Date("2026-09-17T12:00:00.000Z") };
    const tenancy = new InMemoryTenantStore();
    const tenants = new TenantService({
      store: tenancy,
      ids,
      tokens: { generate: () => "x".repeat(43), hash: (value) => value },
      clock,
    });
    const organization = await tenants.createOrganization({
      actorId: "owner",
      actorEmail: "owner@test",
      name: "Org",
      timezone: "UTC",
      locale: "es-CL",
    });
    const workspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Origen y destino",
      mode: "team",
    });
    const otherWorkspace = await tenants.createWorkspace({
      actorId: "owner",
      organizationId: organization.id,
      name: "Otro espacio",
      mode: "team",
    });
    const store = new InMemoryDocumentStore();
    const sourceId = ids.next();
    const targetId = ids.next();
    const otherWorkspaceTargetId = ids.next();
    store.addResource("initiative", sourceId, {
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    store.addResource("project", targetId, {
      organizationId: organization.id,
      workspaceId: workspace.id,
    });
    store.addResource("initiative", otherWorkspaceTargetId, {
      organizationId: organization.id,
      workspaceId: otherWorkspace.id,
    });
    const service = new DocumentService({
      store,
      audit: store,
      objects: new InMemoryDocumentObjectStore(),
      tenancy,
      ids,
      clock,
      maxBytes: 1_000,
      urlTtlSeconds: 60,
    });
    const started = await service.beginUpload({
      actorId: "owner",
      correlationId: ids.next(),
      resourceType: "initiative",
      resourceId: sourceId,
      classification: "restricted",
      fileName: "registro.pdf",
      contentType: "application/pdf",
      contentLength: 10,
      sha256: "a".repeat(64),
    });

    await expect(
      service.relocate({
        actorId: "owner",
        correlationId: ids.next(),
        documentId: started.document.id,
        resourceType: "project",
        resourceId: targetId,
      }),
    ).resolves.toMatchObject({
      resourceType: "project",
      resourceId: targetId,
      classification: "restricted",
    });
    expect(store.audits.at(-1)).toMatchObject({
      eventType: "document.relocated.v1",
      payload: {
        fromResourceType: "initiative",
        fromResourceId: sourceId,
      },
    });
    await expect(
      service.relocate({
        actorId: "owner",
        correlationId: ids.next(),
        documentId: started.document.id,
        resourceType: "initiative",
        resourceId: otherWorkspaceTargetId,
      }),
    ).rejects.toBeInstanceOf(DocumentAccessDeniedError);
    store.relocationBlockedDocumentIds.add(started.document.id);
    await expect(
      service.relocate({
        actorId: "owner",
        correlationId: ids.next(),
        documentId: started.document.id,
        resourceType: "initiative",
        resourceId: sourceId,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_RELOCATION_BLOCKED" });
  });
});
