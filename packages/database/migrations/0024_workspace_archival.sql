ALTER TABLE workspaces
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  ADD COLUMN archived_at TIMESTAMPTZ NULL,
  ADD COLUMN archived_by_actor_id TEXT NULL,
  ADD CONSTRAINT workspaces_archival_state_check CHECK (
    (status = 'active' AND archived_at IS NULL AND archived_by_actor_id IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL AND archived_by_actor_id IS NOT NULL)
  );

CREATE TABLE workspace_audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'workspace.archived.v1'),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX workspace_audit_events_workspace_idx
  ON workspace_audit_events (workspace_id, occurred_at);

CREATE FUNCTION prevent_archived_workspace_document_write() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM documents
    JOIN workspaces ON workspaces.id = documents.workspace_id
    WHERE documents.id = NEW.document_id AND workspaces.status = 'archived'
  ) THEN
    RAISE EXCEPTION 'Workspace is archived';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_versions_workspace_must_be_active
  BEFORE INSERT OR UPDATE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_archived_workspace_document_write();
