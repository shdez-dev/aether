CREATE TABLE organization_membership_audit_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL,
  target_actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'organization.ownership_transferred.v1'),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX organization_membership_audit_events_timeline_idx
  ON organization_membership_audit_events (organization_id, occurred_at ASC, id ASC);

CREATE TRIGGER organization_membership_audit_events_append_only
  BEFORE UPDATE OR DELETE ON organization_membership_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE FUNCTION prevent_removing_last_organization_owner() RETURNS trigger AS $$
BEGIN
  IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR NEW.role <> 'owner')
     AND NOT EXISTS (
       SELECT 1
       FROM organization_memberships
       WHERE organization_id = OLD.organization_id
         AND actor_id <> OLD.actor_id
         AND role = 'owner'
     ) THEN
    RAISE EXCEPTION 'An organization must retain at least one owner';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organization_memberships_retain_owner
  BEFORE UPDATE OF role OR DELETE ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION prevent_removing_last_organization_owner();
