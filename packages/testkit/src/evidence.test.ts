import { describe, expect, it } from "vitest";

import { EvidenceService } from "@aether/application";
import type { DocumentVersion, InstitutionalDocument } from "@aether/domain";

import { InMemoryDocumentStore } from "./documents.js";
import { InMemoryEvidenceStore } from "./evidence.js";
import { InMemoryTenantStore } from "./tenancy.js";

describe("evidence references", () => {
  it("relaciona una versión publicada con iniciativa y proyecto", async () => {
    const organizationId = "00000000-0000-4000-8000-000000000101";
    const workspaceId = "00000000-0000-4000-8000-000000000102";
    const initiativeId = "00000000-0000-4000-8000-000000000103";
    const decisionId = "00000000-0000-4000-8000-000000000104";
    const projectId = "00000000-0000-4000-8000-000000000105";
    const documentId = "00000000-0000-4000-8000-000000000106";
    const versionId = "00000000-0000-4000-8000-000000000107";
    const documents = new InMemoryDocumentStore();
    const references = new InMemoryEvidenceStore();
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
      name: "Estrategia",
      mode: "institutional",
      version: 0,
      status: "active",
      archivedAt: null,
      archivedByActorId: null,
    });
    references.setSubject("initiative", initiativeId, {
      organizationId,
      workspaceId,
    });
    references.setSubject("decision", decisionId, {
      organizationId,
      workspaceId,
    });
    references.setSubject("project", projectId, {
      organizationId,
      workspaceId,
    });
    const createdAt = new Date("2026-09-17T15:00:00.000Z");
    const document: InstitutionalDocument = {
      id: documentId,
      organizationId,
      workspaceId,
      resourceType: "initiative",
      resourceId: initiativeId,
      classification: "internal",
      createdByActorId: "owner",
      createdAt,
    };
    const version: DocumentVersion = {
      id: versionId,
      documentId,
      versionNumber: 1,
      originalName: "respaldo.pdf",
      declaredContentType: "application/pdf",
      detectedContentType: "application/pdf",
      byteLength: 10,
      sha256: "b".repeat(64),
      status: "published",
      quarantineKey: "quarantine/x",
      objectKey: "published/x",
      createdAt,
      publishedAt: createdAt,
      rejectedAt: null,
      withdrawnAt: null,
      retentionUntil: null,
      evidenceStatus: "valid",
      supersedesVersionId: null,
      replacedByVersionId: null,
    };
    documents.documents.set(document.id, document);
    documents.versions.set(version.id, version);
    let sequence = 200;
    const service = new EvidenceService({
      references,
      subjects: references,
      documents,
      documentAudit: documents,
      tenancy,
      ids: {
        next: () =>
          `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      },
      clock: { now: () => createdAt },
    });

    for (const [subjectType, subjectId] of [
      ["initiative", initiativeId],
      ["decision", decisionId],
      ["project", projectId],
    ] as const)
      await expect(
        service.attach({
          actorId: "owner",
          organizationId,
          subjectType,
          subjectId,
          documentId,
          documentVersionId: versionId,
          correlationId: "00000000-0000-4000-8000-000000000108",
        }),
      ).resolves.toMatchObject({
        subjectType,
        subjectId,
        documentVersionId: versionId,
      });
  });

  it("preserva la versión histórica y marca inválido el cumplimiento al retirar evidencia", async () => {
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const workspaceId = "00000000-0000-4000-8000-000000000002";
    const evaluationId = "00000000-0000-4000-8000-000000000003";
    const documentId = "00000000-0000-4000-8000-000000000004";
    const versionId = "00000000-0000-4000-8000-000000000005";
    const documents = new InMemoryDocumentStore();
    const references = new InMemoryEvidenceStore();
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
      name: "Evaluación",
      mode: "team",
      version: 0,
      status: "active",
      archivedAt: null,
      archivedByActorId: null,
    });
    references.setSubject("evaluation", evaluationId, {
      organizationId,
      workspaceId,
    });
    const document: InstitutionalDocument = {
      id: documentId,
      organizationId,
      workspaceId,
      resourceType: "evaluation",
      resourceId: evaluationId,
      classification: "internal",
      createdByActorId: "owner",
      createdAt: new Date("2026-09-12T00:00:00.000Z"),
    };
    const version: DocumentVersion = {
      id: versionId,
      documentId,
      versionNumber: 1,
      originalName: "acta.pdf",
      declaredContentType: "application/pdf",
      detectedContentType: "application/pdf",
      byteLength: 10,
      sha256: "a".repeat(64),
      status: "published",
      quarantineKey: "quarantine/x",
      objectKey: "published/x",
      createdAt: document.createdAt,
      publishedAt: document.createdAt,
      rejectedAt: null,
      withdrawnAt: null,
      retentionUntil: null,
      evidenceStatus: "valid",
      supersedesVersionId: null,
      replacedByVersionId: null,
    };
    documents.documents.set(document.id, document);
    documents.versions.set(version.id, version);
    let sequence = 10;
    const service = new EvidenceService({
      references,
      subjects: references,
      documents,
      documentAudit: documents,
      tenancy,
      ids: {
        next: () =>
          `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      },
      clock: { now: () => new Date("2026-09-12T01:00:00.000Z") },
    });
    const reference = await service.attach({
      actorId: "owner",
      organizationId,
      subjectType: "evaluation",
      subjectId: evaluationId,
      documentId,
      documentVersionId: versionId,
      correlationId: "00000000-0000-4000-8000-000000000006",
    });
    documents.versions.set(version.id, {
      ...version,
      status: "withdrawn",
      evidenceStatus: "withdrawn",
      withdrawnAt: new Date("2026-09-12T02:00:00.000Z"),
    });
    const listed = await service.list({
      actorId: "owner",
      organizationId,
      subjectType: "evaluation",
      subjectId: evaluationId,
    });
    expect(listed).toEqual([
      expect.objectContaining({
        id: reference.id,
        documentVersionId: versionId,
        compliance: "invalid",
      }),
    ]);
    expect(documents.audits.at(-1)?.eventType).toBe(
      "document.evidence_linked.v1",
    );
  });
});
