import type { DocumentVersionAccess } from "./documents.js";
import type { DurableDomainEvent } from "./outbox.js";

/**
 * Política de confianza para trabajos asíncronos. Los eventos de la outbox no
 * llevan una sesión de usuario: el worker sólo puede actuar como sistema sobre
 * el tenant, agregado y versión exactos que el evento durable declaró.
 */
export class WorkerEventAuthorizationError extends Error {}

export function assertDocumentScanEventScope(input: {
  event: DurableDomainEvent;
  current: DocumentVersionAccess;
}): void {
  const { event, current } = input;
  if (
    event.eventType !== "document.scan_requested.v1" ||
    event.organizationId !== current.document.organizationId ||
    event.aggregateType !== "document_version" ||
    event.aggregateId !== current.version.id ||
    event.payload.documentId !== current.document.id ||
    event.payload.versionId !== current.version.id
  )
    throw new WorkerEventAuthorizationError(
      "Document scan event is outside its authorized tenant or version scope",
    );
}
