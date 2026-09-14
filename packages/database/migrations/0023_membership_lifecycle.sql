ALTER TABLE organization_memberships
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  ADD COLUMN status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE organization_membership_audit_events
  DROP CONSTRAINT organization_membership_audit_events_event_type_check;
ALTER TABLE organization_membership_audit_events
  ADD CONSTRAINT organization_membership_audit_events_event_type_check CHECK (
    event_type IN (
      'organization.ownership_transferred.v1',
      'organization.membership_activated.v1',
      'organization.member_responsibilities_reassigned.v1',
      'organization.membership_suspended.v1',
      'organization.membership_revoked.v1'
    )
  );

CREATE FUNCTION prevent_owner_membership_deactivation() RETURNS trigger AS $$
BEGIN
  IF OLD.role = 'owner' AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'Transfer ownership before changing an owner membership status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organization_memberships_owner_remains_active
  BEFORE UPDATE OF status ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION prevent_owner_membership_deactivation();
