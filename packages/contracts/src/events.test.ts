import { describe, expect, it } from "vitest";

import { DurableEventEnvelopeSchema } from "./events.js";

const envelope = {
  eventId: "00000000-0000-4000-8000-000000000001",
  eventType: "document.scan_requested.v1",
  occurredAt: "2026-09-13T12:00:00.000Z",
  aggregateId: "00000000-0000-4000-8000-000000000002",
  aggregateType: "document_version",
  aggregateVersion: 1,
  organizationId: "00000000-0000-4000-8000-000000000003",
  correlationId: "00000000-0000-4000-8000-000000000004",
  causationId: null,
  schemaVersion: 1,
  payload: {
    documentId: "00000000-0000-4000-8000-000000000005",
    versionId: "00000000-0000-4000-8000-000000000006",
  },
};

describe("durable event contracts", () => {
  it("accepts the versioned document scan contract", () => {
    expect(DurableEventEnvelopeSchema.parse(envelope)).toMatchObject(envelope);
  });
  it("rejects unknown event types and malformed document-scan payloads", () => {
    expect(
      DurableEventEnvelopeSchema.safeParse({
        ...envelope,
        eventType: "document.future.v1",
      }).success,
    ).toBe(false);
    expect(
      DurableEventEnvelopeSchema.safeParse({ ...envelope, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      DurableEventEnvelopeSchema.safeParse({
        ...envelope,
        payload: { documentId: envelope.payload.documentId },
      }).success,
    ).toBe(false);
  });
});
