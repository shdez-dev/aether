CREATE TABLE document_binaries (
  version_id UUID PRIMARY KEY REFERENCES document_versions(id),
  quarantine_key TEXT NOT NULL UNIQUE,
  object_key TEXT NULL UNIQUE
);
INSERT INTO document_binaries (version_id, quarantine_key, object_key)
SELECT id, quarantine_key, object_key FROM document_versions;
ALTER TABLE document_versions DROP COLUMN quarantine_key;
ALTER TABLE document_versions DROP COLUMN object_key;
