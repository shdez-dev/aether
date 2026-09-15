ALTER TABLE team_audit_events
  DROP CONSTRAINT team_audit_events_event_type_check;

ALTER TABLE team_audit_events
  ADD CONSTRAINT team_audit_events_event_type_check CHECK (
    event_type IN ('team.created.v1', 'team.members_replaced.v1')
  );
