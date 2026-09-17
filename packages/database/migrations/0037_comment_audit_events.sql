CREATE TABLE comment_audit_events (
  id UUID PRIMARY KEY,
  comment_id UUID NOT NULL REFERENCES comments(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('comment.created.v1', 'comment.edited.v1', 'comment.resolved.v1', 'comment.reopened.v1', 'comment.deleted.v1')),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX comment_audit_events_comment_idx ON comment_audit_events (comment_id, occurred_at ASC);
CREATE TRIGGER comment_audit_events_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON comment_audit_events
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE FUNCTION prevent_comment_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Comment audit events are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER comment_audit_events_append_only
  BEFORE UPDATE OR DELETE ON comment_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_comment_audit_event_mutation();
