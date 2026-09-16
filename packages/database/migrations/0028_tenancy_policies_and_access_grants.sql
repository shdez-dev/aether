CREATE TABLE organization_policies (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id),
  data_residency_region TEXT NOT NULL CHECK (char_length(data_residency_region) BETWEEN 2 AND 64),
  retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_by_actor_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_id_organization_key UNIQUE (id, organization_id);

CREATE TABLE workspace_policy_overrides (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id),
  organization_id UUID NOT NULL,
  data_residency_region TEXT NULL CHECK (data_residency_region IS NULL OR char_length(data_residency_region) BETWEEN 2 AND 64),
  retention_days INTEGER NULL CHECK (retention_days IS NULL OR retention_days BETWEEN 1 AND 3650),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_by_actor_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id)
);

CREATE TABLE tenancy_policy_audit_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'organization.policy_configured.v1',
    'organization.policy_updated.v1',
    'workspace.policy_override_set.v1',
    'workspace.policy_override_cleared.v1'
  )),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id),
  CHECK ((event_type LIKE 'organization.%' AND workspace_id IS NULL)
    OR (event_type LIKE 'workspace.%' AND workspace_id IS NOT NULL))
);

CREATE INDEX tenancy_policy_audit_events_scope_idx
  ON tenancy_policy_audit_events (organization_id, workspace_id, occurred_at ASC, id ASC);

CREATE TRIGGER tenancy_policy_audit_events_append_only
  BEFORE UPDATE OR DELETE ON tenancy_policy_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE TABLE temporary_access_grants (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('workspace', 'initiative', 'evaluation', 'decision', 'project', 'document')),
  resource_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'contribute')),
  grantee_actor_id TEXT NOT NULL,
  requested_by_actor_id TEXT NOT NULL,
  approved_by_actor_id TEXT NOT NULL CHECK (approved_by_actor_id <> requested_by_actor_id),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '8 hours'),
  revoked_at TIMESTAMPTZ NULL,
  revoked_by_actor_id TEXT NULL,
  CHECK ((revoked_at IS NULL) = (revoked_by_actor_id IS NULL))
);

CREATE INDEX temporary_access_grants_active_idx
  ON temporary_access_grants (organization_id, workspace_id, grantee_actor_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE support_access_grants (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  support_actor_id TEXT NOT NULL,
  requested_by_actor_id TEXT NOT NULL,
  approved_by_actor_id TEXT NOT NULL CHECK (approved_by_actor_id <> requested_by_actor_id),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '1 hour'),
  revoked_at TIMESTAMPTZ NULL,
  revoked_by_actor_id TEXT NULL,
  CHECK ((revoked_at IS NULL) = (revoked_by_actor_id IS NULL))
);

CREATE INDEX support_access_grants_active_idx
  ON support_access_grants (organization_id, support_actor_id, expires_at)
  WHERE revoked_at IS NULL;
