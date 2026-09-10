CREATE TABLE auth_session_audit_events (
  id UUID PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN (
    'auth.session_logged_out.v1',
    'auth.session_revoked.v1',
    'auth.sessions_revoked_others.v1'
  )),
  actor_id TEXT NOT NULL,
  target_session_id UUID REFERENCES auth_sessions(id),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX auth_session_audit_events_actor_occurred_at_idx
  ON auth_session_audit_events (actor_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_auth_session_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'auth session audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auth_session_audit_events_append_only
  BEFORE UPDATE OR DELETE ON auth_session_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_auth_session_audit_mutation();
