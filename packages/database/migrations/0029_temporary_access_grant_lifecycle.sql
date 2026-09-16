ALTER TABLE temporary_access_grants
  ALTER COLUMN approved_by_actor_id DROP NOT NULL,
  ADD COLUMN approved_at TIMESTAMPTZ NULL;

UPDATE temporary_access_grants
SET approved_at = created_at
WHERE approved_by_actor_id IS NOT NULL;

ALTER TABLE temporary_access_grants
  ADD CONSTRAINT temporary_access_grants_approval_state_check CHECK (
    (approved_by_actor_id IS NULL AND approved_at IS NULL)
    OR (approved_by_actor_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  ADD CONSTRAINT temporary_access_grants_workspace_scope_fkey
    FOREIGN KEY (workspace_id, organization_id)
    REFERENCES workspaces(id, organization_id);

CREATE TABLE temporary_access_grant_audit_events (
  id UUID PRIMARY KEY,
  grant_id UUID NOT NULL REFERENCES temporary_access_grants(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'temporary_access_grant.requested.v1',
    'temporary_access_grant.approved.v1',
    'temporary_access_grant.used.v1',
    'temporary_access_grant.expired.v1',
    'temporary_access_grant.revoked.v1'
  )),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (workspace_id, organization_id)
    REFERENCES workspaces(id, organization_id)
);

CREATE INDEX temporary_access_grant_audit_events_timeline_idx
  ON temporary_access_grant_audit_events
  (organization_id, grant_id, occurred_at ASC, id ASC);

CREATE UNIQUE INDEX temporary_access_grant_single_expiration_event_idx
  ON temporary_access_grant_audit_events (grant_id, event_type)
  WHERE event_type = 'temporary_access_grant.expired.v1';

CREATE TRIGGER temporary_access_grant_audit_events_append_only
  BEFORE UPDATE OR DELETE ON temporary_access_grant_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
