CREATE TABLE documents (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('initiative', 'evaluation', 'decision', 'project')),
  resource_id UUID NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('internal', 'confidential', 'restricted')),
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX documents_resource_idx ON documents (organization_id, resource_type, resource_id, created_at ASC);

CREATE TABLE document_versions (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  original_name TEXT NOT NULL,
  declared_content_type TEXT NOT NULL CHECK (declared_content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')),
  detected_content_type TEXT NULL CHECK (detected_content_type IS NULL OR detected_content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')),
  byte_length BIGINT NOT NULL CHECK (byte_length > 0),
  sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('quarantined', 'published', 'rejected')),
  quarantine_key TEXT NOT NULL UNIQUE,
  object_key TEXT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ NULL,
  rejected_at TIMESTAMPTZ NULL,
  UNIQUE (document_id, version_number)
);
CREATE INDEX document_versions_document_idx ON document_versions (document_id, version_number DESC);

CREATE TABLE document_audit_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('document.upload_started.v1', 'document.published.v1', 'document.rejected.v1', 'document.download_url_issued.v1')),
  document_id UUID NOT NULL REFERENCES documents(id),
  version_id UUID NOT NULL REFERENCES document_versions(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_id TEXT NOT NULL,
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX document_audit_events_document_idx ON document_audit_events (document_id, occurred_at ASC, id ASC);
CREATE TRIGGER document_audit_events_append_only BEFORE UPDATE OR DELETE ON document_audit_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

ALTER TABLE audit_events DROP CONSTRAINT audit_events_resource_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_resource_type_check CHECK (resource_type IN ('initiative', 'evaluation', 'decision', 'project', 'document'));
CREATE FUNCTION document_audit_event_to_history() RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_events (id, action, resource_type, resource_id, actor_id, organization_id, workspace_id, occurred_at, result, correlation_id, causation_id, async_event_id, payload)
  VALUES (NEW.id, NEW.event_type, 'document', NEW.document_id, NEW.actor_id, NEW.organization_id, NEW.workspace_id, NEW.occurred_at, 'succeeded', NEW.correlation_id, NULL, NULL, NEW.payload);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER document_audit_event_history AFTER INSERT ON document_audit_events FOR EACH ROW EXECUTE FUNCTION document_audit_event_to_history();
