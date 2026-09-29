ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_organization_id_id_unique UNIQUE (organization_id, id);

ALTER TABLE initiatives
  ADD CONSTRAINT initiatives_organization_workspace_id_unique
    UNIQUE (organization_id, workspace_id, id);

CREATE TABLE organization_responsibility_assignments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  initiative_id UUID NULL,
  role_key TEXT NOT NULL CHECK (role_key IN (
    'initiative_coordinator',
    'initiative_evaluator',
    'initiative_approver',
    'initiative_mentor'
  )),
  assigned_by_actor_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NULL,
  revoked_by_actor_id TEXT NULL,
  revoked_at TIMESTAMPTZ NULL,
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id),
  FOREIGN KEY (organization_id, workspace_id, initiative_id)
    REFERENCES initiatives(organization_id, workspace_id, id),
  FOREIGN KEY (organization_id, actor_id)
    REFERENCES organization_memberships(organization_id, actor_id),
  CHECK ((revoked_at IS NULL) = (revoked_by_actor_id IS NULL)),
  CHECK (
    (role_key = 'initiative_mentor' AND initiative_id IS NOT NULL AND valid_until IS NOT NULL)
    OR (role_key <> 'initiative_mentor' AND initiative_id IS NULL AND valid_until IS NULL)
  )
);

CREATE UNIQUE INDEX organization_responsibility_assignments_active_unique
  ON organization_responsibility_assignments
    (organization_id, workspace_id, actor_id, role_key,
     COALESCE(initiative_id::text, 'workspace'))
  WHERE revoked_at IS NULL AND role_key <> 'initiative_mentor';
CREATE INDEX organization_responsibility_assignments_actor_idx
  ON organization_responsibility_assignments
    (organization_id, workspace_id, actor_id, role_key)
  WHERE revoked_at IS NULL;

CREATE TABLE organization_responsibility_audit_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  target_actor_id TEXT NOT NULL,
  initiative_id UUID NULL,
  valid_until TIMESTAMPTZ NULL,
  role_key TEXT NOT NULL CHECK (role_key IN (
    'initiative_coordinator',
    'initiative_evaluator',
    'initiative_approver',
    'initiative_mentor'
  )),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'organization.responsibility_assigned.v1',
    'organization.responsibility_revoked.v1'
  )),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id),
  FOREIGN KEY (organization_id, workspace_id, initiative_id)
    REFERENCES initiatives(organization_id, workspace_id, id)
);

CREATE INDEX organization_responsibility_audit_events_timeline_idx
  ON organization_responsibility_audit_events
    (organization_id, workspace_id, occurred_at ASC, id ASC);

CREATE TRIGGER organization_responsibility_audit_events_append_only
  BEFORE UPDATE OR DELETE ON organization_responsibility_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
