CREATE TABLE outbox_events (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  aggregate_id UUID NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  correlation_id UUID NOT NULL,
  causation_id UUID NULL,
  schema_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  last_error TEXT NULL,
  processed_at TIMESTAMPTZ NULL,
  UNIQUE (aggregate_id, aggregate_version, event_type)
);
CREATE INDEX outbox_events_claim_idx ON outbox_events (status, available_at, occurred_at);

CREATE TABLE outbox_consumptions (
  consumer TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES outbox_events(event_id),
  processed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (consumer, event_id)
);
CREATE TABLE outbox_dead_letters (
  event_id UUID PRIMARY KEY REFERENCES outbox_events(event_id),
  event_type TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  attempts INTEGER NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL,
  last_error TEXT NOT NULL,
  payload JSONB NOT NULL
);
