CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('initiative', 'evaluation', 'decision', 'project')),
  resource_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  occurred_at TIMESTAMPTZ NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('succeeded', 'failed')),
  correlation_id UUID NOT NULL,
  causation_id UUID NULL,
  async_event_id UUID NULL REFERENCES outbox_events(event_id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_events_resource_timeline_idx
  ON audit_events (organization_id, resource_type, resource_id, occurred_at ASC, id ASC);
CREATE INDEX audit_events_correlation_idx ON audit_events (correlation_id, occurred_at ASC);

CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE FUNCTION project_audit_event_to_history() RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_events (id, action, resource_type, resource_id, actor_id, organization_id, workspace_id, occurred_at, result, correlation_id, causation_id, async_event_id, payload)
  VALUES (
    NEW.id, NEW.event_type, 'project', NEW.project_id, NEW.actor_id,
    NEW.organization_id, NEW.workspace_id, NEW.occurred_at, 'succeeded',
    NEW.correlation_id, NULL,
    (SELECT event_id FROM outbox_events WHERE correlation_id = NEW.correlation_id AND aggregate_id = NEW.project_id ORDER BY occurred_at ASC LIMIT 1),
    NEW.payload
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER project_audit_event_history
  AFTER INSERT ON project_audit_events
  FOR EACH ROW EXECUTE FUNCTION project_audit_event_to_history();

CREATE FUNCTION initiative_audit_event_to_history() RETURNS trigger AS $$
DECLARE
  event_resource_type TEXT;
  event_resource_id UUID;
BEGIN
  event_resource_type := CASE NEW.event_type
    WHEN 'initiative.evaluated.v1' THEN 'evaluation'
    WHEN 'initiative.decided.v2' THEN 'decision'
    ELSE 'initiative'
  END;
  event_resource_id := CASE event_resource_type
    WHEN 'evaluation' THEN (NEW.payload->>'evaluationId')::uuid
    WHEN 'decision' THEN (NEW.payload->>'decisionId')::uuid
    ELSE NEW.initiative_id
  END;
  INSERT INTO audit_events (id, action, resource_type, resource_id, actor_id, organization_id, workspace_id, occurred_at, result, correlation_id, causation_id, async_event_id, payload)
  VALUES (
    NEW.id, NEW.event_type, event_resource_type, event_resource_id, NEW.actor_id,
    NEW.organization_id, NEW.workspace_id, NEW.occurred_at, 'succeeded',
    NEW.correlation_id, NULL,
    (SELECT event_id FROM outbox_events WHERE correlation_id = NEW.correlation_id AND aggregate_id = NEW.initiative_id ORDER BY occurred_at ASC LIMIT 1),
    NEW.payload
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER initiative_audit_event_history
  AFTER INSERT ON initiative_audit_events
  FOR EACH ROW EXECUTE FUNCTION initiative_audit_event_to_history();

INSERT INTO audit_events (id, action, resource_type, resource_id, actor_id, organization_id, workspace_id, occurred_at, result, correlation_id, causation_id, async_event_id, payload)
SELECT id, event_type,
  CASE WHEN event_type = 'initiative.evaluated.v1' THEN 'evaluation' WHEN event_type = 'initiative.decided.v2' THEN 'decision' ELSE 'initiative' END,
  CASE WHEN event_type = 'initiative.evaluated.v1' THEN (payload->>'evaluationId')::uuid WHEN event_type = 'initiative.decided.v2' THEN (payload->>'decisionId')::uuid ELSE initiative_id END,
  actor_id, organization_id, workspace_id, occurred_at, 'succeeded', correlation_id, NULL,
  (SELECT event_id FROM outbox_events WHERE correlation_id = initiative_audit_events.correlation_id AND aggregate_id = initiative_audit_events.initiative_id ORDER BY occurred_at ASC LIMIT 1), payload
FROM initiative_audit_events;
INSERT INTO audit_events (id, action, resource_type, resource_id, actor_id, organization_id, workspace_id, occurred_at, result, correlation_id, causation_id, async_event_id, payload)
SELECT id, event_type, 'project', project_id, actor_id, organization_id, workspace_id, occurred_at, 'succeeded', correlation_id, NULL,
  (SELECT event_id FROM outbox_events WHERE correlation_id = project_audit_events.correlation_id AND aggregate_id = project_audit_events.project_id ORDER BY occurred_at ASC LIMIT 1), payload
FROM project_audit_events;
