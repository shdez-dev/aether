ALTER TABLE organization_membership_audit_events
  DROP CONSTRAINT organization_membership_audit_events_event_type_check;

ALTER TABLE organization_membership_audit_events
  ADD CONSTRAINT organization_membership_audit_events_event_type_check CHECK (
    event_type IN (
      'organization.created.v1',
      'organization.invitation_issued.v1',
      'organization.ownership_transferred.v1',
      'organization.membership_activated.v1',
      'organization.member_responsibilities_reassigned.v1',
      'organization.membership_suspended.v1',
      'organization.membership_revoked.v1'
    )
  );

ALTER TABLE workspace_audit_events
  DROP CONSTRAINT workspace_audit_events_event_type_check;

ALTER TABLE workspace_audit_events
  ADD CONSTRAINT workspace_audit_events_event_type_check CHECK (
    event_type IN ('workspace.created.v1', 'workspace.archived.v1')
  );

CREATE TRIGGER workspace_audit_events_append_only
  BEFORE UPDATE OR DELETE ON workspace_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
