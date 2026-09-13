CREATE TABLE security_audit_events (
  id UUID PRIMARY KEY, actor_id TEXT NULL, action TEXT NOT NULL,
  method TEXT NOT NULL, path TEXT NOT NULL, status_code INTEGER NOT NULL,
  correlation_id UUID NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX security_audit_events_timeline_idx ON security_audit_events (occurred_at DESC);

CREATE OR REPLACE FUNCTION verify_audit_integrity_chain(target_organization UUID)
RETURNS BOOLEAN AS $$
DECLARE item RECORD; prior TEXT := NULL;
BEGIN
  FOR item IN SELECT * FROM audit_events WHERE organization_id = target_organization ORDER BY occurred_at, id LOOP
    IF item.previous_hash IS DISTINCT FROM prior OR item.event_hash IS DISTINCT FROM md5(coalesce(prior, '') || item.id::text || item.action || item.resource_id::text || item.occurred_at::text || item.correlation_id::text) THEN RETURN FALSE; END IF;
    prior := item.event_hash;
  END LOOP;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
