CREATE TABLE export_jobs (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id), requested_by_actor_id TEXT NOT NULL,
 scope TEXT NOT NULL CHECK (scope IN ('organization_audit')), status TEXT NOT NULL CHECK (status IN ('requested','processing','completed','failed','expired')), object_key TEXT NULL, expires_at TIMESTAMPTZ NULL, requested_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ NULL, error_code TEXT NULL, UNIQUE (organization_id, requested_by_actor_id, id)
);
CREATE INDEX export_jobs_requester_idx ON export_jobs (organization_id, requested_by_actor_id, requested_at DESC);
