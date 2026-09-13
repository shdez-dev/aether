ALTER TABLE audit_events ADD COLUMN previous_hash TEXT NULL;
ALTER TABLE audit_events ADD COLUMN event_hash TEXT NULL;

CREATE OR REPLACE FUNCTION seal_audit_event() RETURNS trigger AS $$
DECLARE prior TEXT;
BEGIN
  SELECT event_hash INTO prior FROM audit_events
    WHERE organization_id = NEW.organization_id
    ORDER BY occurred_at DESC, id DESC LIMIT 1;
  NEW.previous_hash := prior;
  NEW.event_hash := md5(coalesce(prior, '') || NEW.id::text || NEW.action || NEW.resource_id::text || NEW.occurred_at::text || NEW.correlation_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_integrity_chain
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION seal_audit_event();

UPDATE audit_events
SET event_hash = md5(id::text || action || resource_id::text || occurred_at::text || correlation_id::text)
WHERE event_hash IS NULL;
