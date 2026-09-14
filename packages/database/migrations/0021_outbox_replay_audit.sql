CREATE TABLE outbox_replays (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES outbox_events(event_id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  replayed_by_actor_id TEXT NOT NULL,
  correlation_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  replayed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX outbox_replays_event_idx ON outbox_replays (event_id, replayed_at DESC);
CREATE TRIGGER outbox_replays_append_only
  BEFORE UPDATE OR DELETE ON outbox_replays
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
CREATE INDEX outbox_dead_letters_organization_idx
  ON outbox_dead_letters (organization_id, failed_at DESC);

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_known_event_type_check
  CHECK (event_type IN (
    'document.scan_requested.v1',
    'project.created.v1',
    'project.created_from_initiative.v1',
    'project.status_changed.v1',
    'project.milestone_added.v1',
    'project.next_action_added.v1',
    'project.deliverable_accepted.v1',
    'project.closed.v1'
  ));

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_schema_version_check CHECK (schema_version = 1);
