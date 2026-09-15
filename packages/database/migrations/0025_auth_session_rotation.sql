ALTER TABLE auth_session_audit_events
  DROP CONSTRAINT auth_session_audit_events_action_check;

ALTER TABLE auth_session_audit_events
  ADD CONSTRAINT auth_session_audit_events_action_check CHECK (action IN (
    'auth.session_logged_out.v1',
    'auth.session_revoked.v1',
    'auth.sessions_revoked_others.v1',
    'auth.session_rotated.v1'
  ));
