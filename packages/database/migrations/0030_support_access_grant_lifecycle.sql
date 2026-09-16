ALTER TABLE support_access_grants
  ALTER COLUMN approved_by_actor_id DROP NOT NULL,
  ADD COLUMN approved_at TIMESTAMPTZ NULL;

UPDATE support_access_grants
SET approved_at = created_at
WHERE approved_by_actor_id IS NOT NULL;

ALTER TABLE support_access_grants
  ADD CONSTRAINT support_access_grants_approval_state_check CHECK (
    (approved_by_actor_id IS NULL AND approved_at IS NULL)
    OR (approved_by_actor_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  ADD CONSTRAINT support_access_grants_id_organization_key
    UNIQUE (id, organization_id);

CREATE TABLE support_access_grant_audit_events (
  id UUID PRIMARY KEY,
  grant_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'support_access_grant.requested.v1',
    'support_access_grant.approved.v1',
    'support_access_grant.used.v1',
    'support_access_grant.expired.v1',
    'support_access_grant.revoked.v1'
  )),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (grant_id, organization_id)
    REFERENCES support_access_grants(id, organization_id)
);

CREATE INDEX support_access_grant_audit_events_timeline_idx
  ON support_access_grant_audit_events
  (organization_id, grant_id, occurred_at ASC, id ASC);

CREATE UNIQUE INDEX support_access_grant_single_expiration_event_idx
  ON support_access_grant_audit_events (grant_id, event_type)
  WHERE event_type = 'support_access_grant.expired.v1';

CREATE TRIGGER support_access_grant_audit_events_append_only
  BEFORE UPDATE OR DELETE ON support_access_grant_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
