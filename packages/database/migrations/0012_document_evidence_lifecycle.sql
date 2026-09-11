ALTER TABLE document_versions DROP CONSTRAINT document_versions_status_check;
ALTER TABLE document_versions ADD CONSTRAINT document_versions_status_check CHECK (status IN ('quarantined', 'pending_scan', 'published', 'rejected', 'withdrawn', 'superseded', 'purged'));
ALTER TABLE document_versions ADD COLUMN withdrawn_at TIMESTAMPTZ NULL;
ALTER TABLE document_versions ADD COLUMN retention_until TIMESTAMPTZ NULL;
ALTER TABLE document_versions ADD COLUMN evidence_status TEXT NOT NULL DEFAULT 'pending' CHECK (evidence_status IN ('pending', 'valid', 'withdrawn', 'replaced'));
ALTER TABLE document_versions ADD COLUMN supersedes_version_id UUID NULL REFERENCES document_versions(id);
ALTER TABLE document_versions ADD COLUMN replaced_by_version_id UUID NULL UNIQUE REFERENCES document_versions(id);

ALTER TABLE document_audit_events DROP CONSTRAINT document_audit_events_event_type_check;
ALTER TABLE document_audit_events ADD CONSTRAINT document_audit_events_event_type_check CHECK (event_type IN ('document.upload_started.v1', 'document.scan_queued.v1', 'document.published.v1', 'document.rejected.v1', 'document.malware_rejected.v1', 'document.withdrawn.v1', 'document.replaced.v1', 'document.purged.v1', 'document.download_url_issued.v1'));
CREATE INDEX document_versions_retention_idx ON document_versions (retention_until) WHERE retention_until IS NOT NULL AND status IN ('published', 'withdrawn', 'superseded');
